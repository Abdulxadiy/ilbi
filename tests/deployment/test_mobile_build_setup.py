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


if __name__ == '__main__':
    unittest.main()
