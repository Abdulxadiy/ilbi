"""Local candidate boundaries: immutable objects, preserved web, no secret copying."""
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('mobile_candidate', ROOT / 'ops/prepare_mobile_backend_candidate.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MobileBackendCandidateTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='ilbi-candidate-test-')
        self.root = Path(self.folder.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.command('init', '-q')
        for name in ('Dockerfile', 'entrypoint.sh', 'pyproject.toml', 'uv.lock', 'manage.py', 'healthcheck.py'):
            self.write('ilbi/' + name, 'unchanged runtime\n')
        self.write('ilbi/apps/base.py', 'original backend\n')
        self.write('frontend/login.html', 'original web design\n')
        self.write('ops/compose.sh', '#!/bin/sh\noriginal compose\n')
        self.base = self.commit()
        (self.repo / 'ilbi').rename(self.repo / 'backend')
        self.write('backend/apps/base.py', 'reviewed backend\n')
        self.write('backend/apps/notifications/new.py', 'new notification code\n')
        self.write('mobile-app/tests/contracts/support.json', '{"synthetic":"public contract"}\n')
        self.write('frontend/login.html', 'unrelated feature branch design\n')
        self.source = self.commit()
        for name in ('mobile_push.compose.yml', 'check_mobile_backend_readiness.py'):
            shutil.copyfile(ROOT / 'ops' / name, self.repo / 'ops' / name)
        self.destination = self.root / 'candidate'

    def tearDown(self):
        self.folder.cleanup()

    def command(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def write(self, name, value):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def commit(self):
        self.command('add', '-A')
        self.command('-c', 'user.name=Candidate fixture', '-c', 'user.email=fixture@invalid.example', 'commit', '-qm', 'fixture')
        return self.command('rev-parse', 'HEAD')

    def test_candidate_uses_committed_backend_and_preserves_original_web_without_private_inputs(self):
        self.write('backend/apps/base.py', 'uncommitted work must not ship\n')
        self.write('backend/.env.production', 'synthetic private value\n')
        self.write('firebase-keys/private.json', 'synthetic private key\n')
        manifest = MODULE.prepare(self.repo, self.base, self.source, self.destination)
        self.assertEqual((self.destination / 'ilbi/apps/base.py').read_text(), 'reviewed backend\n')
        self.assertEqual((self.destination / 'frontend/login.html').read_text(), 'original web design\n')
        self.assertFalse((self.destination / 'backend').exists())
        self.assertFalse((self.destination / 'firebase-keys').exists())
        self.assertFalse((self.destination / 'ilbi/.env.production').exists())
        self.assertEqual((self.destination / 'mobile-app/tests/contracts/support.json').read_text(),
                         '{"synthetic":"public contract"}\n')
        self.assertEqual(len(manifest['shared_contract_fixtures']), 1)
        self.assertEqual(len(manifest['files']), 2)
        self.assertFalse((self.destination / 'docker-compose.mobile-push.yml').exists())

    def test_changed_dependency_boundary_fails_before_creating_a_worktree(self):
        self.write('backend/uv.lock', 'unreviewed dependency change\n')
        source = self.commit()
        with self.assertRaisesRegex(ValueError, 'Runtime/dependency boundary changed'):
            MODULE.prepare(self.repo, self.base, source, self.destination)
        self.assertFalse(self.destination.exists())

    def test_existing_destination_is_preserved(self):
        self.destination.mkdir()
        sentinel = self.destination / 'owner-work'
        sentinel.write_text('keep')
        with self.assertRaisesRegex(ValueError, 'Destination already exists'):
            MODULE.prepare(self.repo, self.base, self.source, self.destination)
        self.assertEqual(sentinel.read_text(), 'keep')

    def test_deletions_are_not_silently_treated_as_additive_changes(self):
        (self.repo / 'backend/apps/base.py').unlink()
        source = self.commit()
        with self.assertRaisesRegex(ValueError, 'Deletion/symlink'):
            MODULE.prepare(self.repo, self.base, source, self.destination)
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
