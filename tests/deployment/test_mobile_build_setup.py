"""Verify local signing preparation preserves an established identity and private files."""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'mobile-app/scripts'
sys.path.insert(0, str(SCRIPTS))
import build_apk
import prepare_signing
sys.path.pop(0)


class MobileBuildSetupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.key = self.folder / 'fixture-key.p12'
        self.key.write_bytes(b'explicit non-signing fixture')
        self.record = self.folder / 'record.json'
        self.record.write_text(json.dumps({'keystore': str(self.key), 'alias': 'fixture', 'storePassword': 'fixture-only'}))

    def test_protected_eas_mapping_is_idempotent_and_preserves_ios_credentials(self):
        target = self.folder / 'credentials.json'
        target.write_text(json.dumps({'ios': {'fixture': 'preserved'}}))
        prepare_signing.prepare(self.record, target)
        prepare_signing.prepare(self.record, target)
        actual = json.loads(target.read_text())
        self.assertEqual(actual['ios'], {'fixture': 'preserved'})
        self.assertEqual(actual['android']['keystore']['keyAlias'], 'fixture')
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.folder / '.credentials.json.part').exists())

    def test_different_existing_signing_configuration_is_not_overwritten(self):
        target = self.folder / 'credentials.json'
        target.write_text(json.dumps({'android': {'keystore': {'keyAlias': 'existing'}}}))
        previous = target.read_bytes()
        with self.assertRaisesRegex(ValueError, 'cannot be silently replaced'):
            prepare_signing.prepare(self.record, target)
        self.assertEqual(target.read_bytes(), previous)

    def test_isolated_cng_source_excludes_local_credentials_env_and_generated_native_folders(self):
        source = self.folder / 'source'
        source.mkdir()
        for name in ['src', 'assets', 'node_modules', 'android']:
            (source / name).mkdir()
        (source / 'src/entry.ts').write_text('export const fixture = true;')
        for name in ['App.tsx', 'app.json', 'package.json', 'credentials.json', '.env']:
            (source / name).write_text(name)
        target = self.folder / 'build/mobile-app'
        build_apk.copy_project(source, target)
        self.assertTrue((target / 'src/entry.ts').exists())
        self.assertTrue((target / 'node_modules').is_symlink())
        for name in ['credentials.json', '.env', 'android']:
            self.assertFalse((target / name).exists())

    def test_signer_pin_rejects_accidental_replacement_before_build(self):
        public = {'schema': 1, 'applicationId': 'uz.ilbi.mobile', 'signerSha256': 'a' * 64}
        build_apk.validate_signer('a' * 64, public)
        with self.assertRaisesRegex(ValueError, 'Restore the existing key'):
            build_apk.validate_signer('b' * 64, public)

    def test_complete_stable_build_tools_are_selected_over_partial_downloads(self):
        sdk = self.folder / 'sdk'
        for version, names in [('37.0.0', ['aapt2', 'apksigner', 'zipalign']), ('38.0.0', ['aapt2']), ('39.0.0-rc1', ['aapt2', 'apksigner', 'zipalign'])]:
            folder = sdk / 'build-tools' / version
            folder.mkdir(parents=True)
            for name in names:
                (folder / name).write_text('fixture')
        self.assertEqual(build_apk.select_build_tools(sdk).name, '37.0.0')
        with self.assertRaisesRegex(ValueError, 'Complete Android build-tools'):
            build_apk.select_build_tools(self.folder / 'missing-sdk')


if __name__ == '__main__':
    unittest.main()
