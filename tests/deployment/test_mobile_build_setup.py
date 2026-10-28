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
        for name in ['src', 'assets', 'node_modules', 'android', 'scripts', 'vendor']:
            (source / name).mkdir()
        (source / 'src/entry.ts').write_text('export const fixture = true;')
        for name in ['App.tsx', 'app.json', 'package.json', 'credentials.json', '.env']:
            (source / name).write_text(name)
        (source / 'app.json').write_text(json.dumps({'expo': {}}))
        (source / 'scripts/patch-toolchain.cjs').write_text('// synthetic reviewed install hook')
        (source / 'vendor/guard.json').write_text('{"synthetic":true}')
        (source / 'scripts/private-helper.json').write_text('{"synthetic_private":"must stay on host"}')
        target = self.folder / 'build/mobile-app'
        build_apk.copy_project(source, target)
        self.assertTrue((target / 'src/entry.ts').exists())
        self.assertTrue((target / 'node_modules').is_symlink())
        self.assertEqual((target / 'scripts/patch-toolchain.cjs').read_bytes(), (source / 'scripts/patch-toolchain.cjs').read_bytes())
        self.assertTrue((target / 'vendor/guard.json').exists())
        self.assertFalse((target / 'scripts/private-helper.json').exists())
        for name in ['credentials.json', '.env', 'android']:
            self.assertFalse((target / name).exists())

    def firebase_source(self, config=None):
        source = self.folder / 'firebase-source'
        source.mkdir()
        (source / 'node_modules').mkdir()
        app = {'expo': {'android': {'package': 'uz.ilbi.mobile', 'googleServicesFile': './google-services.json'}}}
        (source / 'app.json').write_text(json.dumps(config or app))
        client = {'project_info': {'project_id': 'ilbi-fixture'}, 'client': [{'client_info': {'android_client_info': {'package_name': 'uz.ilbi.mobile'}}}]}
        (source / 'google-services.json').write_text(json.dumps(client))
        return source

    def test_only_declared_public_firebase_client_enters_cng(self):
        source = self.firebase_source()
        (source / 'service-account.json').write_text('{"private_key":"fixture-only"}')
        target = self.folder / 'firebase-build'
        build_apk.copy_project(source, target)
        self.assertEqual((source / 'google-services.json').read_bytes(), (target / 'google-services.json').read_bytes())
        self.assertFalse((target / 'service-account.json').exists())

    def test_firebase_service_account_cannot_be_renamed_as_client_config(self):
        source = self.firebase_source()
        (source / 'google-services.json').write_text(json.dumps({'type': 'service_account', 'private_key': 'fixture-only'}))
        with self.assertRaisesRegex(ValueError, 'private Firebase service account'):
            build_apk.copy_project(source, self.folder / 'bad-private-build')

    def test_firebase_package_must_match_ilbi(self):
        source = self.firebase_source()
        client = json.loads((source / 'google-services.json').read_text())
        client['client'][0]['client_info']['android_client_info']['package_name'] = 'another.app'
        (source / 'google-services.json').write_text(json.dumps(client))
        with self.assertRaisesRegex(ValueError, 'does not match'):
            build_apk.copy_project(source, self.folder / 'bad-package-build')

    def test_external_firebase_path_and_symlink_are_rejected(self):
        source = self.firebase_source()
        config = json.loads((source / 'app.json').read_text())
        config['expo']['android']['googleServicesFile'] = '../private.json'
        (source / 'app.json').write_text(json.dumps(config))
        with self.assertRaisesRegex(ValueError, 'app-local'):
            build_apk.copy_project(source, self.folder / 'bad-external-build')
        config['expo']['android']['googleServicesFile'] = './google-services.json'
        (source / 'app.json').write_text(json.dumps(config))
        (source / 'google-services.json').rename(source / 'original.json')
        (source / 'google-services.json').symlink_to(source / 'original.json')
        with self.assertRaisesRegex(ValueError, 'bounded regular'):
            build_apk.copy_project(source, self.folder / 'bad-symlink-build')

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
