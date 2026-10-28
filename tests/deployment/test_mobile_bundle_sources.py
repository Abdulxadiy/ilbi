"""Prevent publishing a correctly signed APK that contains another build's UI."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'mobile-app/scripts'))
from bundle_sources import verify_bundle_sources, verify_source_record
sys.path.pop(0)


class BundledSourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name)
        self.layout = self.project / 'src/app/_layout.tsx'
        self.layout.parent.mkdir(parents=True)
        self.layout.write_text('export const layout = "new UI";')
        generated = self.project / 'android/app/build/generated'
        self.mapping = generated / 'sourcemaps/react/release/index.android.bundle.map'
        self.mapping.parent.mkdir(parents=True)
        self.bundle = generated / 'assets/react/release/index.android.bundle'
        self.bundle.parent.mkdir(parents=True)
        self.bundle.write_bytes(b'actual generated Hermes')
        self.apk = self.project / 'app.apk'
        with zipfile.ZipFile(self.apk, 'w') as archive:
            archive.writestr('assets/index.android.bundle', self.bundle.read_bytes())
        self.write_map(self.layout.read_text())

    def write_map(self, content):
        self.mapping.write_text(json.dumps({'sources': ['/other-copy/mobile-app/src/app/_layout.tsx'], 'sourcesContent': [content]}))

    def test_matching_source_and_packaged_payload_are_bound_to_the_record(self):
        record = verify_bundle_sources(self.project, self.apk)
        verify_source_record(self.project, record, self.bundle.read_bytes())

    def test_stale_router_context_is_rejected_even_when_the_apk_exists(self):
        self.write_map('export const layout = "old UI";')
        with self.assertRaisesRegex(ValueError, 'Stale bundled'):
            verify_bundle_sources(self.project, self.apk)

    def test_generated_router_context_is_not_mistaken_for_a_source_file(self):
        mapping = json.loads(self.mapping.read_text())
        mapping['sources'].append('/copy/mobile-app/src/app?ctx=generated')
        mapping['sourcesContent'].append('generated context')
        self.mapping.write_text(json.dumps(mapping))
        verify_bundle_sources(self.project, self.apk)

    def test_packager_cannot_put_an_older_payload_beside_a_new_source_map(self):
        self.bundle.write_bytes(b'new generated Hermes')
        with self.assertRaisesRegex(ValueError, 'Packaged JavaScript differs'):
            verify_bundle_sources(self.project, self.apk)

    def test_artifact_verification_rejects_legacy_records_and_modified_source(self):
        with self.assertRaisesRegex(ValueError, 'predates'):
            verify_source_record(self.project, {}, self.bundle.read_bytes())
        record = verify_bundle_sources(self.project, self.apk)
        self.layout.write_text('edited after build')
        with self.assertRaisesRegex(ValueError, 'no longer matches'):
            verify_source_record(self.project, record, self.bundle.read_bytes())

    def test_source_record_cannot_traverse_outside_application_sources(self):
        record = verify_bundle_sources(self.project, self.apk)
        record['bundledSources']['src/../../private'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Invalid bundled'):
            verify_source_record(self.project, record, self.bundle.read_bytes())


if __name__ == '__main__':
    unittest.main()
