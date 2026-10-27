"""Backend-only activation/rollback safety with real files and a Docker model."""
import copy
import contextlib
import fcntl
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('mobile_backend_activation', ROOT / 'ops/deploy_mobile_backend.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
OLD = 'ghcr.io/fixture/ilbi/backend:sha-' + 'a' * 40
NEW = 'ghcr.io/fixture/ilbi/backend:sha-' + 'b' * 40
OLD_ID = 'sha256:' + 'c' * 64
NEW_ID = 'sha256:' + 'd' * 64


class DockerModel:
    def __init__(self, root, archive):
        self.root, self.archive = root, archive
        self.images = {
            OLD: {'id': OLD_ID, 'user': '1000:1000', 'revision': 'a' * 40},
            NEW: {'id': NEW_ID, 'user': '1000:1000', 'revision': 'b' * 40},
        }
        self.states = {name: {'id': name + '-original', 'service': name, 'image_id': OLD_ID,
                             'reference': OLD, 'running': True} for name in MODULE.WRITERS}
        self.states['bot'].update(reference='unchanged-bot-image', image_id='unchanged-bot-id')
        self.calls, self.failures = [], set()
        self.log = None
        self.migration_running = False
        self.database_migrated = False
        self.retag_during_backup = False
        self.health_failures = {}
        self.health_probes = []

    def __call__(self, argv, label, timeout=90):
        self.calls.append((list(argv), label))
        if label == 'Bounded candidate migrations':
            self.migration_running = True
        if label == 'Backend health verification':
            image = self.states['ilbi']['reference']
            self.health_probes.append((image, timeout))
            failures = self.health_failures.get(image, 0)
            if failures is None or failures > 0:
                if failures is not None:
                    self.health_failures[image] -= 1
                raise MODULE.ActivationError('Synthetic strict readiness failure.')
        if label in self.failures:
            self.failures.remove(label)
            raise MODULE.ActivationError('Synthetic operational failure.')
        if argv[:3] == ['docker', 'image', 'inspect']:
            if argv[-1] not in self.images:
                raise MODULE.ActivationError('Image absent.')
            return json.dumps(self.images[argv[-1]])
        if argv[:2] == ['docker', 'inspect']:
            return '\n'.join(json.dumps(row) for row in self.states.values())
        if argv[:2] == ['docker', 'ps']:
            return 'owned-migration-container' if self.migration_running else ''
        if argv[:3] == ['docker', 'rm', '-f']:
            self.migration_running = False
            return ''
        if argv[:2] == ['python3', 'scripts/data_backup.py']:
            if self.retag_during_backup:
                self.images[NEW]['id'] = 'sha256:' + 'f' * 64
            return json.dumps({'archive': str(self.archive), 'sha256': MODULE.sha256(self.archive)})
        if argv[0] != './ops/compose.sh':
            raise AssertionError(argv)
        operation = argv[1]
        if operation == 'ps':
            return '\n'.join(row['id'] for row in self.states.values())
        if operation == 'stop':
            for name in argv[4:]:
                self.states[name]['running'] = False
        elif operation == 'up':
            image = MODULE.image_line((self.root / '.env.production').read_bytes())[1]
            for name in argv[8:]:
                self.states[name].update(id=name + '-new', running=True, reference=image,
                                         image_id=self.images[image]['id'])
        elif operation == 'start':
            self.states['bot']['running'] = True
        elif operation == 'run':
            self.database_migrated = True
            self.migration_running = False
        elif operation != 'exec':
            raise AssertionError(argv)
        return ''


class FakeClock:
    def __init__(self):
        self.now = 0
        self.delays = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.delays.append(seconds)
        self.now += seconds


class MobileBackendActivationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='ilbi-backend-activation-')
        self.base = Path(self.folder.name)
        self.root = self.base / 'deployment'
        self.root.mkdir()
        self.environment = self.root / '.env.production'
        self.original = f'PUBLIC_HOST=fixture.invalid\nILBI_BACKEND_IMAGE={OLD}\nPRIVATE_VALUE=synthetic-keep\n'.encode()
        self.environment.write_bytes(self.original)
        self.environment.chmod(0o600)
        for name in ('docker-compose.prod.yml', 'ops/compose.sh', 'ilbi/.env.production',
                     'telegram_bot_sms/.env.production', 'VERSION', 'frontend/keep.txt'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic preserved source: ' + name)
        self.archive = self.base / 'synthetic.tar.gpg'
        self.archive.write_bytes(b'synthetic encrypted archive')
        self.archive.chmod(0o600)
        self.report = self.base / 'rehearsal.json'
        self.report_data = {'image': NEW, 'image_id': NEW_ID, 'previous_image': OLD,
                            'archive': str(self.archive), 'archive_sha256': MODULE.sha256(self.archive),
                            'restored': True, 'migrations_verified': True}
        self.write_report()
        self.model = DockerModel(self.root, self.archive)
        self.clock = FakeClock()
        self.deployment = MODULE.Deployment(self.root, NEW, OLD, NEW_ID, self.model,
                                           clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.logs = self.base / 'private-logs'

    def tearDown(self):
        self.folder.cleanup()

    def write_report(self):
        self.report.write_text(json.dumps(self.report_data))
        self.report.chmod(0o600)

    def assert_no_mutation(self):
        self.assertEqual(self.environment.read_bytes(), self.original)
        self.assertFalse(any(label in {'Stop previous writers', 'Fresh stopped-writer backup',
                                       'Bounded candidate migrations'} for _, label in self.model.calls))

    def test_plan_reads_only_loaded_images_and_container_metadata(self):
        result = self.deployment.check()
        self.assertEqual(result['image'], NEW)
        self.assert_no_mutation()
        self.assertFalse(self.logs.exists())
        self.assertFalse((self.root / '.operations.lock').exists())

    def test_loaded_image_id_revision_and_user_must_match_reviewed_candidate(self):
        for key, bad in [('id', 'sha256:' + 'f' * 64), ('revision', 'e' * 40), ('revision', None), ('user', '0:0')]:
            with self.subTest(key=key):
                before = copy.deepcopy(self.model.images[NEW])
                self.model.images[NEW][key] = bad
                with self.assertRaises(MODULE.ActivationError):
                    self.deployment.check()
                self.model.images[NEW] = before
                self.assert_no_mutation()

    def test_unlabelled_previous_image_remains_available_for_activation_and_rollback(self):
        self.model.images[OLD]['revision'] = None
        self.deployment.check()
        self.model.health_failures[NEW] = None
        with self.assertRaisesRegex(MODULE.ActivationError, 'previous backend image and running states restored'):
            self.deployment.activate(self.report, self.logs)
        self.assertEqual(self.environment.read_bytes(), self.original)
        self.assertTrue(all(row['running'] for row in self.model.states.values()))
        self.assertTrue(all(self.model.states[name]['image_id'] == OLD_ID for name in MODULE.BACKENDS))

    def test_missing_rollback_image_is_rejected_without_pulling(self):
        del self.model.images[OLD]
        with self.assertRaises(MODULE.ActivationError):
            self.deployment.check()
        self.assert_no_mutation()
        self.assertFalse(any('pull' in argv for argv, _ in self.model.calls))

    def test_running_image_drift_or_changed_root_env_is_rejected(self):
        self.model.states['celery_worker']['image_id'] = 'drift'
        with self.assertRaises(MODULE.ActivationError):
            self.deployment.check()
        self.model.states['celery_worker']['image_id'] = OLD_ID
        self.environment.write_bytes(MODULE.image_bytes(self.original, NEW))
        with self.assertRaises(MODULE.ActivationError):
            self.deployment.check()
        self.assertFalse(any(label == 'Stop previous writers' for _, label in self.model.calls))

    def test_activation_changes_only_backend_env_entry_and_uses_bounded_migrations(self):
        protected = self.deployment.protected_files()
        bot = copy.deepcopy(self.model.states['bot'])
        result = self.deployment.activate(self.report, self.logs)
        self.assertTrue(result['activated'])
        self.assertEqual(self.environment.read_bytes(), MODULE.image_bytes(self.original, NEW))
        self.assertEqual(self.environment.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.deployment.protected_files(), protected)
        self.assertEqual(self.model.states['bot'], bot)
        self.assertTrue(self.model.database_migrated)
        labels = [label for _, label in self.model.calls]
        self.assertLess(labels.index('Stop previous writers'), labels.index('Fresh stopped-writer backup'))
        self.assertLess(labels.index('Fresh stopped-writer backup'), labels.index('Bounded candidate migrations'))
        migration = next(argv for argv, label in self.model.calls if label == 'Bounded candidate migrations')
        self.assertIn('PGOPTIONS=-c lock_timeout=10000 -c statement_timeout=120000', migration)
        self.assertEqual(migration[-4:], ['ilbi', 'manage.py', 'migrate', '--noinput'])
        self.assertTrue(all(self.model.states[name]['reference'] == NEW for name in MODULE.BACKENDS))
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in self.logs.iterdir()))
        self.assertEqual(self.logs.stat().st_mode & 0o777, 0o700)

    def test_originally_stopped_worker_and_bot_remain_stopped(self):
        self.model.states['celery_worker']['running'] = False
        self.model.states['bot']['running'] = False
        self.deployment.activate(self.report, self.logs)
        self.assertFalse(self.model.states['celery_worker']['running'])
        self.assertEqual(self.model.states['celery_worker']['reference'], OLD)
        self.assertFalse(self.model.states['bot']['running'])
        self.assertFalse(any(label == 'Resume unchanged bot' for _, label in self.model.calls))

    def assert_failure_rolls_back_images_only(self, failure):
        if failure == 'Backend health verification':
            self.model.health_failures[NEW] = None
        else:
            self.model.failures.add(failure)
        with self.assertRaisesRegex(MODULE.ActivationError, 'previous backend image and running states restored'):
            self.deployment.activate(self.report, self.logs)
        self.assertEqual(self.environment.read_bytes(), self.original)
        self.assertTrue(all(row['running'] for row in self.model.states.values()))
        self.assertTrue(all(self.model.states[name]['reference'] == OLD for name in MODULE.BACKENDS))
        self.assertFalse(self.model.migration_running)
        commands = [argv for argv, _ in self.model.calls]
        self.assertFalse(any('restore' in argv or '--fake' in argv or 'zero' in argv for argv in commands))

    def test_backup_failure_restores_original_running_states(self):
        self.assert_failure_rolls_back_images_only('Fresh stopped-writer backup')

    def test_failed_migration_is_stopped_before_previous_images_resume(self):
        self.assert_failure_rolls_back_images_only('Bounded candidate migrations')
        labels = [label for _, label in self.model.calls]
        self.assertLess(labels.index('Stop own migration container'), labels.index('Restore previous backend'))

    def test_failed_health_keeps_additive_schema_and_restores_previous_images(self):
        self.assert_failure_rolls_back_images_only('Backend health verification')
        self.assertTrue(self.model.database_migrated)
        self.assertEqual(sum(image == NEW for image, _ in self.model.health_probes), 30)
        self.assertLessEqual(self.clock.now, 60)

    def test_transient_strict_readiness_recovers_without_image_rollback(self):
        self.model.health_failures[NEW] = 2
        result = self.deployment.activate(self.report, self.logs)
        self.assertTrue(result['activated'])
        self.assertEqual([image for image, _ in self.model.health_probes], [NEW, NEW, NEW])
        self.assertEqual(self.clock.delays, [2, 2])
        self.assertTrue(all(0 < timeout <= 10 for _, timeout in self.model.health_probes))
        self.assertFalse(any(label == 'Restore previous backend' for _, label in self.model.calls))

    def test_persistent_new_failure_allows_bounded_old_readiness_recovery(self):
        self.model.health_failures.update({NEW: None, OLD: 2})
        with self.assertRaisesRegex(MODULE.ActivationError, 'previous backend image and running states restored'):
            self.deployment.activate(self.report, self.logs)
        self.assertEqual(self.environment.read_bytes(), self.original)
        self.assertEqual(sum(image == NEW for image, _ in self.model.health_probes), 30)
        self.assertEqual(sum(image == OLD for image, _ in self.model.health_probes), 3)
        self.assertEqual(self.clock.now, 64)
        self.assertTrue(self.model.database_migrated)

    def test_persistent_old_and_new_unreadiness_still_requires_manual_attention(self):
        self.model.health_failures.update({NEW: None, OLD: None})
        with self.assertRaisesRegex(MODULE.ActivationError, 'rollback needs manual attention'):
            self.deployment.activate(self.report, self.logs)
        self.assertEqual(self.environment.read_bytes(), self.original)
        self.assertEqual(self.clock.now, 120)

    def test_target_retagged_during_backup_is_rejected_before_migration(self):
        self.model.retag_during_backup = True
        with self.assertRaisesRegex(MODULE.ActivationError, 'previous backend image and running states restored'):
            self.deployment.activate(self.report, self.logs)
        self.assertFalse(self.model.database_migrated)
        self.assertEqual(self.environment.read_bytes(), self.original)
        self.assertTrue(all(row['running'] for row in self.model.states.values()))

    def test_reviewed_repository_rename_keeps_exact_ci_reference(self):
        renamed = NEW.replace('/fixture/ilbi/', '/fixture/renamed-ilbi/')
        self.model.images[renamed] = self.model.images.pop(NEW)
        self.deployment = MODULE.Deployment(self.root, renamed, OLD, NEW_ID, self.model,
                                           clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.report_data['image'] = renamed
        self.write_report()
        result = self.deployment.activate(self.report, self.logs)
        self.assertEqual(result['image'], renamed)
        self.assertEqual(MODULE.image_line(self.environment.read_bytes())[1], renamed)
        self.assertFalse(any('tag' in argv for argv, _ in self.model.calls))

    def test_rehearsal_must_match_image_archive_and_successful_results(self):
        for field, bad in [('image_id', OLD_ID), ('archive_sha256', 'f' * 64),
                           ('restored', False), ('migrations_verified', False)]:
            with self.subTest(field=field):
                before = self.report_data[field]
                self.report_data[field] = bad
                self.write_report()
                with self.assertRaises(MODULE.ActivationError):
                    self.deployment.activate(self.report, self.logs)
                self.report_data[field] = before
                self.assert_no_mutation()

    def test_real_operations_lock_prevents_parallel_activation(self):
        lock = self.root / '.operations.lock'
        with lock.open('w') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(MODULE.ActivationError, 'Another deployment'):
                self.deployment.activate(self.report, self.logs)
        self.assert_no_mutation()

    def test_state_changed_after_plan_is_rejected_before_writers_stop(self):
        self.deployment.check()
        (self.root / 'ilbi/.env.production').write_text('synthetic concurrently changed env')
        with self.assertRaisesRegex(MODULE.ActivationError, 'changed after the plan'):
            self.deployment.activate(self.report, self.logs)
        self.assert_no_mutation()

    def test_world_readable_metadata_is_rejected(self):
        self.report.chmod(0o644)
        with self.assertRaises(MODULE.ActivationError):
            self.deployment.activate(self.report, self.logs)
        self.assert_no_mutation()

    def test_unsafe_environment_symlink_cannot_be_replaced(self):
        self.environment.unlink()
        real = self.base / 'owner-env'
        real.write_bytes(self.original)
        self.environment.symlink_to(real)
        with self.assertRaises(MODULE.ActivationError):
            MODULE.atomic_private(self.environment, b'must not replace')
        self.assertEqual(real.read_bytes(), self.original)

    def test_external_failure_output_stays_private_and_out_of_console_exception(self):
        runner = MODULE.Runner(self.root)
        log_path = self.base / 'private-command.log'
        fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        console = io.StringIO()
        with os.fdopen(fd, 'w') as log, contextlib.redirect_stdout(console), contextlib.redirect_stderr(console):
            runner.log = log
            with self.assertRaises(MODULE.ActivationError) as raised:
                runner([sys.executable, '-c', 'import sys; print("synthetic-private-error"); sys.exit(2)'],
                       'Synthetic safe operation')
        self.assertNotIn('synthetic-private-error', str(raised.exception) + console.getvalue())
        self.assertIn('synthetic-private-error', log_path.read_text())
        self.assertEqual(log_path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
