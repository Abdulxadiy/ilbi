"""Current-source verification rejects stale APK claims without rebuilding binaries."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'mobile-app/scripts'))
import verify_apk
sys.path.pop(0)


class MobileApkSourceVerificationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.app = self.repo / 'mobile-app'
        (self.app / 'src').mkdir(parents=True)
        (self.app / 'src/entry.ts').write_text('export const value = 1;')
        (self.app / 'package.json').write_text(json.dumps({'name': 'fixture', 'version': '1.0.0', 'dependencies': {'expo': '~58.0.19'}, 'scripts': {'test': 'old'}}))
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=ILBI test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture')
        self.commit = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, check=True, capture_output=True, text=True).stdout

    def test_docs_and_host_helper_scripts_do_not_make_an_unchanged_runtime_stale(self):
        package = json.loads((self.app / 'package.json').read_text())
        package['scripts']['test'] = 'new helper'
        (self.app / 'package.json').write_text(json.dumps(package))
        (self.app / 'BUILD_START_HERE.md').write_text('Instructions')
        self.assertEqual(verify_apk.runtime_changes(self.app, self.commit), [])

    def test_runtime_edits_and_new_untracked_routes_invalidate_the_existing_apk(self):
        (self.app / 'src/entry.ts').write_text('export const value = 2;')
        (self.app / 'src/new.ts').write_text('new route')
        self.assertEqual(verify_apk.runtime_changes(self.app, self.commit), ['mobile-app/src/entry.ts', 'mobile-app/src/new.ts'])

    def test_dependency_changes_require_a_new_package_even_if_app_version_stays_the_same(self):
        package = json.loads((self.app / 'package.json').read_text())
        package['dependencies']['expo-notifications'] = '~58.1.6'
        (self.app / 'package.json').write_text(json.dumps(package))
        self.assertEqual(verify_apk.runtime_changes(self.app, self.commit), ['mobile-app/package.json'])

    def test_install_and_build_hooks_cannot_be_ignored_as_check_helpers(self):
        package = json.loads((self.app / 'package.json').read_text())
        package['scripts']['postinstall'] = 'node generate-native-assets.js'
        (self.app / 'package.json').write_text(json.dumps(package))
        self.assertEqual(verify_apk.runtime_changes(self.app, self.commit), ['mobile-app/package.json'])

    def test_changed_install_patch_inputs_invalidate_an_existing_apk_without_version_changes(self):
        (self.app / 'vendor').mkdir()
        (self.app / 'scripts').mkdir()
        (self.app / 'vendor/guard.json').write_text('{"synthetic":"changed mitigation"}')
        (self.app / 'scripts/patch-toolchain.cjs').write_text('// synthetic changed build hook')
        self.assertEqual(verify_apk.runtime_changes(self.app, self.commit), [
            'mobile-app/scripts/patch-toolchain.cjs', 'mobile-app/vendor/guard.json',
        ])


if __name__ == '__main__':
    unittest.main()
