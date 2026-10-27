#!/usr/bin/env python3
"""Create a LOCAL main-layout review worktree from immutable Git objects. Never deploys."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


COMPOSE_WRAPPER = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
compose_args=(--env-file .env.production -f docker-compose.prod.yml)
# The separately staged activation file persists across ordinary deployments.
if [[ -f docker-compose.mobile-push.yml ]]; then
    compose_args+=(-f docker-compose.mobile-push.yml)
fi
exec docker compose "${compose_args[@]}" "$@"
'''


def prepare(repo, base, source, destination):
    for value in (base, source):
        if not re.fullmatch(r'[a-f0-9]{40}', value):
            raise ValueError('Use full immutable 40-character commit SHAs.')
        git(repo, 'cat-file', '-e', value + '^{commit}')
    if destination.exists():
        raise ValueError('Destination already exists; existing work is never replaced.')
    # The operational boundary stays unchanged. A dependency/image-entrypoint
    # upgrade must be reviewed explicitly rather than omitted from this candidate.
    for name in ('Dockerfile', 'entrypoint.sh', 'pyproject.toml', 'uv.lock', 'manage.py', 'healthcheck.py'):
        if git(repo, 'show', f'{base}:ilbi/{name}') != git(repo, 'show', f'{source}:backend/{name}'):
            raise ValueError(f'Runtime/dependency boundary changed: {name}; review separately.')
    excluded = {'.env.production.example', 'README_TESTS.md', 'docker-compose.test.yml'}
    paths = git(repo, 'diff', '--name-only', '--no-renames', f'{base}:ilbi', f'{source}:backend').decode().splitlines()
    changes = []
    for name in paths:
        if name in excluded:
            continue
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or path.parts[0] not in ('api', 'apps', 'config', 'tests'):
            raise ValueError(f'Unexpected backend boundary: {name}; review explicitly.')
        entry = git(repo, 'ls-tree', source, f'backend/{name}').decode().strip()
        if not entry or entry.split()[0] not in ('100644', '100755'):
            raise ValueError(f'Deletion/symlink is not an additive candidate: {name}')
        content = git(repo, 'show', f'{source}:backend/{name}')
        changes.append((name, content))
    fixtures = []
    for name in git(repo, 'ls-tree', '-r', '--name-only', source, '--', 'mobile-app/tests/contracts').decode().splitlines():
        if not re.fullmatch(r'mobile-app/tests/contracts/[A-Za-z0-9_-]+\.json', name):
            raise ValueError('Unexpected shared contract fixture; review explicitly.')
        fixtures.append((name, git(repo, 'show', f'{source}:{name}')))
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', '-C', str(repo), 'worktree', 'add', '--detach', str(destination), base], check=True)
    for name, content in changes:
        target = destination / 'ilbi' / name
        for parent in (target, *target.parents):
            if parent == destination:
                break
            if parent.is_symlink():
                raise ValueError(f'Candidate path is a symlink: {name}')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    # Backend wire-contract tests intentionally compare these committed public
    # mobile fixtures. Include them without copying the mobile runtime or keys.
    for name, content in fixtures:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (destination / 'ops/compose.sh').write_text(COMPOSE_WRAPPER)
    (destination / 'ops/compose.sh').chmod(0o755)
    for name in ('mobile_push.compose.yml', 'check_mobile_backend_readiness.py'):
        # These are reviewed preparation tools; never copy local credentials.
        (destination / 'ops' / name).write_bytes((repo / 'ops' / name).read_bytes())
    (destination / 'ops/check_mobile_backend_readiness.py').chmod(0o755)
    manifest = {
        'production_base': base, 'backend_source': source,
        'layout': 'Original ilbi/ backend; frontend, bot, desktop and platform version unchanged.',
        'activation': 'FCM override remains inactive under ops/ until separately staged.',
        'files': [{'path': 'ilbi/' + name, 'sha256': hashlib.sha256(content).hexdigest()} for name, content in changes],
        'excluded_nonruntime_paths': sorted(excluded),
        'shared_contract_fixtures': [
            {'path': name, 'sha256': hashlib.sha256(content).hexdigest()} for name, content in fixtures
        ],
        'additional_operations_files': [
            {'path': name, 'sha256': hashlib.sha256((destination / name).read_bytes()).hexdigest()}
            for name in ('ops/compose.sh', 'ops/mobile_push.compose.yml', 'ops/check_mobile_backend_readiness.py')
        ],
    }
    (destination / 'ops/mobile-backend-candidate.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    manifest = prepare(repo, args.base, args.source, args.destination.resolve())
    print(json.dumps({'destination': str(args.destination.resolve()), 'backend_files': len(manifest['files']),
                      'base': args.base, 'source': args.source, 'deployed': False}, indent=2))


if __name__ == '__main__':
    main()
