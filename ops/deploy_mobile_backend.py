#!/usr/bin/env python3
"""Activate a preloaded, reviewed backend image. Default is a read-only plan.

The operator separately restores a verified backup and rehearses migrations first.
This tool never pulls images, publishes APKs, changes frontend/bot images, restores
the production database, or reverses additive migrations.
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import tempfile
import uuid
from pathlib import Path

BACKENDS = ('ilbi', 'celery_worker', 'celery_beat')
WRITERS = (*BACKENDS, 'bot')
IMAGE = re.compile(r'ghcr\.io/[a-z0-9_/-]+/backend:sha-([a-f0-9]{40})\Z')
IMAGE_ID = re.compile(r'sha256:[a-f0-9]{64}\Z')
IMAGE_FORMAT = '{"id":{{json .Id}},"user":{{json .Config.User}},"revision":{{if .Config.Labels}}{{json (index .Config.Labels "org.opencontainers.image.revision")}}{{else}}null{{end}}}'
CONTAINER_FORMAT = '{"id":{{json .Id}},"image_id":{{json .Image}},"reference":{{json .Config.Image}},"running":{{json .State.Running}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}'


class ActivationError(Exception):
    """Safe operational message; never forward arbitrary tool output."""


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def image_line(data):
    matches = list(re.finditer(rb'(?m)^ILBI_BACKEND_IMAGE=([^\r\n]*)', data))
    if len(matches) != 1:
        raise ActivationError('Exactly one unquoted ILBI_BACKEND_IMAGE entry is required.')
    try:
        value = matches[0].group(1).decode('ascii')
    except UnicodeDecodeError:
        raise ActivationError('Invalid backend image entry.') from None
    if not IMAGE.fullmatch(value):
        raise ActivationError('The configured backend image must use an immutable GHCR commit tag.')
    return matches[0], value


def image_bytes(data, image):
    match, _ = image_line(data)
    return data[:match.start(1)] + image.encode('ascii') + data[match.end(1):]


def atomic_private(path, data):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid():
        raise ActivationError('Refusing an unsafe environment file.')
    fd, temporary = tempfile.mkstemp(prefix='.mobile-backend-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        Path(temporary).unlink(missing_ok=True)


def private_file(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ActivationError('A private regular file is required.')
    info = path.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ActivationError('Private deployment metadata must be owner-only.')
    return path


class Runner:
    def __init__(self, root):
        self.root = Path(root)
        self.log = None

    def __call__(self, argv, label, timeout=90):
        try:
            result = subprocess.run(argv, cwd=self.root, capture_output=True, text=True,
                                    check=False, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise ActivationError(f'{label} could not complete; inspect the private deployment log.') from None
        if self.log:
            self.log.write(f'\n[{label}] exit={result.returncode}\n{result.stdout}\n{result.stderr}\n')
            self.log.flush()
        if result.returncode:
            raise ActivationError(f'{label} failed; inspect the private deployment log.')
        return result.stdout


class Deployment:
    def __init__(self, root, image, expected_current_image, expected_image_id, runner=None):
        self.root = Path(root).resolve()
        self.image, self.previous, self.image_id = image, expected_current_image, expected_image_id
        self.run = runner or Runner(self.root)
        self.environment = self.root / '.env.production'
        self.original = None
        self.states = None
        self.old_image_id = None
        self.fingerprints = None
        self.run_id = uuid.uuid4().hex
        self.migration_name = 'ilbi-mobile-migrate-' + self.run_id[:16]
        if not IMAGE.fullmatch(image) or not IMAGE.fullmatch(expected_current_image) or not IMAGE_ID.fullmatch(expected_image_id):
            raise ActivationError('Exact immutable backend image references and a verified sha256 engine image ID are required.')
        # An explicit reviewed ref/verified-engine-ID pair authorizes a repository
        # rename; never retag a CI image to pretend it came from the old repo.
        if image == expected_current_image:
            raise ActivationError('Use a new reviewed backend image.')

    def compose(self, *argv, label='Compose operation', timeout=90):
        return self.run(['./ops/compose.sh', *argv], label, timeout)

    def inspected_image(self, image):
        try:
            result = json.loads(self.run(['docker', 'image', 'inspect', '--format', IMAGE_FORMAT, image], 'Inspect loaded image'))
            if not IMAGE_ID.fullmatch(result['id']):
                raise ValueError
            return result
        except (ValueError, KeyError, TypeError):
            raise ActivationError('Loaded image metadata is invalid.') from None

    def containers(self):
        ids = self.compose('ps', '-aq', *WRITERS, label='Inspect writer container IDs').split()
        if not ids:
            raise ActivationError('Existing backend containers were not found.')
        output = self.run(['docker', 'inspect', '--format', CONTAINER_FORMAT, *ids], 'Inspect writer state')
        try:
            rows = [json.loads(line) for line in output.splitlines() if line.strip()]
            result = {row['service']: row for row in rows}
            if len(result) != len(rows) or not set(BACKENDS).issubset(result) or not set(result).issubset(WRITERS):
                raise ValueError
            return result
        except (ValueError, KeyError, TypeError):
            raise ActivationError('Writer container state is ambiguous.') from None

    def protected_files(self):
        paths = ('docker-compose.prod.yml', 'ops/compose.sh', 'ilbi/.env.production',
                 'telegram_bot_sms/.env.production', 'VERSION', 'docker-compose.mobile-push.yml')
        return {name: sha256(self.root / name) if (self.root / name).is_file() else None for name in paths}

    def check(self):
        private_file(self.environment)
        data = self.environment.read_bytes()
        if image_line(data)[1] != self.previous:
            raise ActivationError('Configured backend changed; refusing activation.')
        target, previous = self.inspected_image(self.image), self.inspected_image(self.previous)
        if target['id'] != self.image_id or target.get('revision') != IMAGE.fullmatch(self.image).group(1):
            raise ActivationError('Loaded target image ID or OCI revision does not match the reviewed candidate.')
        if target.get('user') not in ('1000', '1000:1000'):
            raise ActivationError('The reviewed backend image must run as user1000.')
        states = self.containers()
        for service in BACKENDS:
            row = states[service]
            if row['reference'] != self.previous or row['image_id'] != previous['id']:
                raise ActivationError('Existing backend container/image drift detected.')
        if self.original is not None and (data != self.original or states != self.states or self.protected_files() != self.fingerprints):
            raise ActivationError('Deployment state changed after the plan; refusing activation.')
        self.original, self.states, self.old_image_id = data, states, previous['id']
        self.fingerprints = self.protected_files()
        return {'image': self.image, 'image_id': self.image_id, 'previous_image': self.previous,
                'running_writers': [name for name in WRITERS if self.states.get(name, {}).get('running')]}

    def rehearsal(self, report_path):
        try:
            report = json.loads(private_file(report_path).read_text())
            if report.get('image') != self.image or report.get('image_id') != self.image_id or report.get('previous_image') != self.previous:
                raise ValueError
            if report.get('restored') is not True or report.get('migrations_verified') is not True:
                raise ValueError
            archive = private_file(report['archive'])
            if not archive.is_absolute() or sha256(archive) != report['archive_sha256']:
                raise ValueError
        except (ValueError, KeyError, TypeError, OSError):
            raise ActivationError('A successful matching private backup/migration rehearsal report is required.') from None
        return report

    def clean_migration_container(self):
        # Only remove this invocation's explicitly named/labelled one-off container.
        output = self.run(['docker', 'ps', '-aq', '--filter', f'name=^/{self.migration_name}$',
                           '--filter', f'label=io.ilbi.mobile-deploy={self.run_id}'], 'Find own migration container')
        for container in output.split():
            self.run(['docker', 'rm', '-f', container], 'Stop own migration container')

    def resume(self, image, *, rollback=False):
        expected_id = self.old_image_id if rollback else self.image_id
        if self.inspected_image(image)['id'] != expected_id:
            raise ActivationError('Loaded backend image changed before service start.')
        running = [name for name in BACKENDS if self.states[name]['running']]
        if running:
            self.compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '300', *running,
                         label='Restore previous backend' if rollback else 'Start reviewed backend', timeout=360)
        if self.states.get('bot', {}).get('running'):
            self.compose('start', '--wait', '--wait-timeout', '90', 'bot', label='Resume unchanged bot', timeout=120)
        current = self.containers()
        for name, before in self.states.items():
            after = current.get(name)
            if not after or after['running'] != before['running']:
                raise ActivationError('Writer running states were not preserved.')
            if name == 'bot':
                if after['id'] != before['id'] or after['image_id'] != before['image_id']:
                    raise ActivationError('Bot container changed unexpectedly.')
            elif before['running'] and (after['reference'] != image or after['image_id'] != (self.old_image_id if rollback else self.image_id)):
                raise ActivationError('Backend image verification failed after start.')
        if self.states['ilbi']['running']:
            self.compose('exec', '-T', '--interactive=false', 'ilbi', 'python', '-B', 'healthcheck.py',
                         label='Backend health verification', timeout=90)

    def activate(self, report_path, log_directory):
        # The plan is repeated under the same lock used by ordinary backup/deploy.
        lock_path = self.root / '.operations.lock'
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'rb') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ActivationError('Another deployment or backup is running.') from None
            plan = self.check()
            self.rehearsal(report_path)
            folder = Path(log_directory).absolute()
            if folder.is_symlink() or folder.resolve().is_relative_to(self.root):
                raise ActivationError('Private logs must be outside the deployment directory.')
            folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            if folder.stat().st_uid != os.getuid() or stat.S_IMODE(folder.stat().st_mode) & 0o077:
                raise ActivationError('Deployment log directory must be owner-only.')
            log_path = folder / f'mobile-backend-{self.run_id}.log'
            log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(log_fd, 'w', encoding='utf-8') as log:
                self.run.log = log
                touched = False
                try:
                    # Check once more immediately before stopping any writer.
                    self.check()
                    touched = True
                    if plan['running_writers']:
                        self.compose('stop', '--timeout', '45', *plan['running_writers'], label='Stop previous writers', timeout=240)
                    backup = json.loads(self.run(['python3', 'scripts/data_backup.py', 'create',
                        '--config', '/etc/ilbi-backup/config.json', '--output-dir', '/srv/ilbi-backups',
                        '--passphrase-file', '/etc/ilbi-backup/passphrase', '--writers-stopped'], 'Fresh stopped-writer backup', 900))
                    archive = private_file(backup['archive'])
                    if sha256(archive) != backup['sha256']:
                        raise ActivationError('Fresh backup checksum did not match.')
                    if self.environment.read_bytes() != self.original or self.protected_files() != self.fingerprints:
                        raise ActivationError('Deployment files changed before migration.')
                    if self.inspected_image(self.image)['id'] != self.image_id or self.inspected_image(self.previous)['id'] != self.old_image_id:
                        raise ActivationError('Loaded images changed before migration.')
                    atomic_private(self.environment, image_bytes(self.original, self.image))
                    self.compose('run', '--rm', '--no-deps', '-T', '--name', self.migration_name,
                        '--label', f'io.ilbi.mobile-deploy={self.run_id}', '--entrypoint', 'python',
                        '-e', 'PGOPTIONS=-c lock_timeout=10000 -c statement_timeout=120000',
                        'ilbi', 'manage.py', 'migrate', '--noinput', label='Bounded candidate migrations', timeout=1200)
                    self.clean_migration_container()
                    self.resume(self.image)
                    if self.protected_files() != self.fingerprints:
                        raise ActivationError('Protected deployment files changed unexpectedly.')
                    result = {**plan, 'activated': True, 'backup_archive': str(archive),
                              'backup_sha256': backup['sha256'], 'private_log': str(log_path)}
                    log.write('\nVerified result:\n' + json.dumps(result, sort_keys=True) + '\n')
                    log.flush()
                    return result
                except BaseException:
                    if touched:
                        try:
                            self.clean_migration_container()
                            self.compose('stop', '--timeout', '45', *self.states,
                                         label='Stop writers before image rollback', timeout=240)
                            if self.inspected_image(self.previous)['id'] != self.old_image_id:
                                raise ActivationError('Previous loaded image changed.')
                            current = self.environment.read_bytes()
                            if image_line(current)[1] not in (self.image, self.previous):
                                raise ActivationError('Environment image changed externally.')
                            atomic_private(self.environment, image_bytes(current, self.previous))
                            self.resume(self.previous, rollback=True)
                        except BaseException:
                            raise ActivationError('Activation failed and image rollback needs manual attention. Inspect the private log; keep database migrations and backups.') from None
                        raise ActivationError('Activation failed; previous backend image and running states restored. Additive schema and backups retained. Inspect the private log.') from None
                    raise
                finally:
                    self.run.log = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--image', required=True)
    parser.add_argument('--expected-current-image', required=True)
    parser.add_argument('--expected-image-id', required=True,
                        help='Exact engine image ID derived from the verified CI archive; loaded .Id must match.')
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--plan', action='store_true')
    actions.add_argument('--activate', action='store_true')
    parser.add_argument('--rehearsal-report', type=Path)
    parser.add_argument('--log-directory', type=Path, default=Path.home() / '.local/share/ilbi-deployments')
    args = parser.parse_args()
    if args.activate and not args.rehearsal_report:
        parser.error('--activate requires --rehearsal-report from a successful isolated rehearsal.')
    try:
        deployment = Deployment(args.root, args.image, args.expected_current_image, args.expected_image_id)
        if args.activate:
            def interrupted(_signum, _frame):
                raise ActivationError('Deployment interrupted.')
            signal.signal(signal.SIGTERM, interrupted)
            result = deployment.activate(args.rehearsal_report, args.log_directory)
        else:
            result = {**deployment.check(), 'activated': False}
        print(json.dumps(result, indent=2, sort_keys=True))
    except ActivationError as exc:
        raise SystemExit(str(exc)) from None
    except (OSError, ValueError):
        # Even malformed JSON/files or arbitrary subprocess failures stay private.
        raise SystemExit('Backend activation did not complete. Inspect the private deployment log and running state; no database rollback is performed.') from None


if __name__ == '__main__':
    main()
