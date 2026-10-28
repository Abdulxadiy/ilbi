"""Real tiny Docker/OCI tar fixtures; no Docker daemon, extraction or credentials."""
import copy
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('backend_artifact', ROOT / 'ops/verify_mobile_backend_artifact.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CANDIDATE = 'a' * 40
SOURCE = 'b' * 40
IMAGE = 'ghcr.io/fixture/ilbi/backend:sha-' + CANDIDATE


def encoded(value):
    return json.dumps(value, separators=(',', ':')).encode()


def raw_layer(value):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        info = tarfile.TarInfo('synthetic-file')
        info.size = len(value)
        archive.addfile(info, io.BytesIO(value))
    return output.getvalue()


class BackendArtifactTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='ilbi-oci-test-')
        self.root = Path(self.folder.name)
        self.archive = self.root / 'mobile-backend-image.tar.gz'
        self.metadata = self.root / 'mobile-backend-image.json'
        self.make_export()

    def tearDown(self):
        self.folder.cleanup()

    def make_export(self, *, config_edit=None, manifest_edit=None, index_edit=None,
                    legacy_edit=None, files_edit=None, layer_values=None):
        blobs = {}
        def blob(data, media_type):
            digest = 'sha256:' + hashlib.sha256(data).hexdigest()
            blobs['blobs/sha256/' + digest.split(':')[1]] = data
            return {'mediaType': media_type, 'digest': digest, 'size': len(data)}
        values = layer_values or [raw_layer(b'first layer'), raw_layer(b'second layer')]
        layers = [blob(value, MODULE.RAW_LAYER) for value in values]
        config = {'os': 'linux', 'architecture': 'amd64',
                  'config': {'User': '1000:1000', 'Env': ['SYNTHETIC_SECRET=must-never-be-output'],
                             'Labels': {'org.opencontainers.image.revision': CANDIDATE,
                                        'org.opencontainers.image.source': 'https://github.com/Fixture/ilbi'}},
                  'rootfs': {'type': 'layers', 'diff_ids': [layer['digest'] for layer in layers]}}
        if config_edit:
            config_edit(config)
        config_descriptor = blob(encoded(config), MODULE.OCI_CONFIG)
        manifest = {'schemaVersion': 2, 'mediaType': MODULE.OCI_MANIFEST,
                    'config': config_descriptor, 'layers': layers}
        if manifest_edit:
            manifest_edit(manifest)
        manifest_descriptor = blob(encoded(manifest), MODULE.OCI_MANIFEST)
        manifest_descriptor['annotations'] = {'io.containerd.image.name': IMAGE,
            'org.opencontainers.image.ref.name': 'sha-' + CANDIDATE}
        index = {'schemaVersion': 2, 'mediaType': MODULE.OCI_INDEX, 'manifests': [manifest_descriptor]}
        if index_edit:
            index_edit(index)
        path = lambda digest: 'blobs/sha256/' + digest.split(':')[1]
        legacy = [{'Config': path(config_descriptor['digest']), 'RepoTags': [IMAGE],
                   'Layers': [path(layer['digest']) for layer in layers],
                   'LayerSources': {layer['digest']: copy.deepcopy(layer) for layer in layers}}]
        if legacy_edit:
            legacy_edit(legacy)
        blob(encoded({'historical': 'another hash-checked blob'}), 'unused')
        files = [('oci-layout', encoded({'imageLayoutVersion': '1.0.0'})),
                 ('index.json', encoded(index)), ('manifest.json', encoded(legacy)),
                 ('repositories', encoded({IMAGE.rsplit(':', 1)[0]: {IMAGE.rsplit(':', 1)[1]:
                                          layers[-1]['digest'].split(':')[1]}})), *blobs.items()]
        if files_edit:
            files_edit(files)
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, data in files:
                if isinstance(data, tarfile.TarInfo):
                    archive.addfile(data)
                else:
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
        self.record = {'candidate_commit': CANDIDATE, 'backend_source': SOURCE, 'image': IMAGE,
                       'deployed': False, 'docker_image_id': config_descriptor['digest'],
                       'digest': 'sha256:' + 'c' * 64,
                       'digest_reference': IMAGE.split(':sha-')[0] + '@sha256:' + 'c' * 64,
                       'archive': self.archive.name, 'archive_bytes': self.archive.stat().st_size,
                       'archive_sha256': MODULE.checksum(self.archive)}
        self.write_metadata()
        self.manifest_id = manifest_descriptor['digest']
        self.config_id = config_descriptor['digest']

    def write_metadata(self):
        self.metadata.write_bytes(encoded(self.record))

    def verify(self):
        return MODULE.verify(self.archive, self.metadata, CANDIDATE, SOURCE, IMAGE)

    def test_valid_export_has_distinct_portable_and_containerd_identities_without_config_disclosure(self):
        result = self.verify()
        self.assertEqual(result['portable_config_digest'], self.config_id)
        self.assertEqual(result['containerd_expected_image_id'], self.manifest_id)
        self.assertNotEqual(self.config_id, self.manifest_id)
        self.assertEqual(result['layer_count'], 2)
        self.assertEqual(result['verified_blob_count'], 5)
        self.assertFalse(result['archive_extracted'] or result['loaded_host_verified'] or result['server_modified'])
        self.assertNotIn('must-never-be-output', json.dumps(result))
        self.assertEqual(set(path.name for path in self.root.iterdir()), {self.archive.name, self.metadata.name})

    def test_exact_metadata_source_candidate_reference_and_size_are_required(self):
        for key, bad in [('candidate_commit', 'd' * 40), ('backend_source', 'd' * 40),
                         ('image', IMAGE.replace('/ilbi/', '/other/')), ('archive_bytes', 1),
                         ('archive_sha256', 'd' * 64), ('docker_image_id', 'sha256:' + 'd' * 64),
                         ('archive', '../mobile-backend-image.tar.gz')]:
            with self.subTest(key=key):
                before = self.record[key]
                self.record[key] = bad
                self.write_metadata()
                with self.assertRaises(MODULE.VerificationError):
                    self.verify()
                self.record[key] = before

    def test_hash_checked_archive_still_rejects_a_blob_with_wrong_content_address(self):
        def corrupt(files):
            for index, (name, value) in enumerate(files):
                if name.startswith('blobs/'):
                    files[index] = (name, b'not the hashed original content')
                    break
        self.make_export(files_edit=corrupt)
        with self.assertRaisesRegex(MODULE.VerificationError, 'blob content hash'):
            self.verify()

    def test_unsafe_unknown_duplicate_and_link_archive_members_are_rejected(self):
        for path in ('../outside', '/absolute', 'unexpected-private-config', 'index.json'):
            with self.subTest(path=path):
                self.make_export(files_edit=lambda files: files.append((path, b'{}')))
                with self.assertRaises(MODULE.VerificationError):
                    self.verify()
        link = tarfile.TarInfo('blobs/sha256/' + 'e' * 64)
        link.type, link.linkname = tarfile.SYMTYPE, '/private/target'
        self.make_export(files_edit=lambda files: files.append((link.name, link)))
        with self.assertRaises(MODULE.VerificationError):
            self.verify()

    def test_config_revision_platform_user_and_source_are_verified(self):
        edits = [lambda c: c['config']['Labels'].update({'org.opencontainers.image.revision': 'd' * 40}),
                 lambda c: c['config'].update(User='0:0'), lambda c: c.update(architecture='arm64'),
                 lambda c: c['config']['Labels'].update({'org.opencontainers.image.source': 'https://github.com/other/project'})]
        for edit in edits:
            with self.subTest(edit=edits.index(edit)):
                self.make_export(config_edit=edit)
                with self.assertRaises(MODULE.VerificationError):
                    self.verify()

    def test_single_exact_index_tag_and_descriptor_size_are_required(self):
        edits = [lambda i: i['manifests'].append(copy.deepcopy(i['manifests'][0])),
                 lambda i: i['manifests'][0]['annotations'].update({'io.containerd.image.name': 'other-image'}),
                 lambda i: i['manifests'][0].update(size=1)]
        for edit in edits:
            with self.subTest(edit=edits.index(edit)):
                self.make_export(index_edit=edit)
                with self.assertRaises(MODULE.VerificationError):
                    self.verify()

    def test_layer_order_and_raw_uncompressed_media_type_are_required(self):
        self.make_export(config_edit=lambda c: c['rootfs']['diff_ids'].reverse())
        with self.assertRaisesRegex(MODULE.VerificationError, 'Ordered uncompressed'):
            self.verify()
        self.make_export(manifest_edit=lambda m: m['layers'][0].update(mediaType=MODULE.RAW_LAYER + '+gzip'))
        with self.assertRaisesRegex(MODULE.VerificationError, 'media type'):
            self.verify()
        self.make_export(layer_values=[b'not a tar header'.ljust(1024, b'x')])
        with self.assertRaisesRegex(MODULE.VerificationError, 'tar header'):
            self.verify()

    def test_docker_manifest_must_match_the_verified_oci_chain(self):
        self.make_export(legacy_edit=lambda legacy: legacy[0].update(RepoTags=['wrong-image']))
        with self.assertRaisesRegex(MODULE.VerificationError, 'Docker and OCI'):
            self.verify()

    def test_docker_repository_mapping_cannot_point_the_tag_at_an_unrelated_layer(self):
        def wrong_mapping(files):
            files[:] = [(name, encoded({IMAGE.rsplit(':', 1)[0]: {IMAGE.rsplit(':', 1)[1]: 'f' * 64}})
                         if name == 'repositories' else value) for name, value in files]
        self.make_export(files_edit=wrong_mapping)
        with self.assertRaisesRegex(MODULE.VerificationError, 'final-layer mapping'):
            self.verify()

    def test_json_memory_is_bounded_before_archive_metadata_is_parsed(self):
        def oversized_index(files):
            files[:] = [(name, b' ' * (MODULE.MAX_JSON + 1) if name == 'index.json' else value)
                        for name, value in files]
        self.make_export(files_edit=oversized_index)
        with self.assertRaisesRegex(MODULE.VerificationError, 'JSON exceeds'):
            self.verify()

    def test_extended_header_payload_is_rejected_before_unbounded_allocation(self):
        header = tarfile.TarInfo('extended-metadata')
        header.type, header.size = tarfile.XHDTYPE, MODULE.MAX_CONTENTS + 1
        self.archive.write_bytes(header.tobuf() + bytes(1024))
        # Use a plain tar fixture with a deliberately impossible PAX payload.
        plain = self.archive.with_suffix('')
        self.archive.rename(plain)
        self.archive = plain
        self.record.update(archive=plain.name, archive_bytes=plain.stat().st_size,
                           archive_sha256=MODULE.checksum(plain))
        self.write_metadata()
        with self.assertRaisesRegex(MODULE.VerificationError, 'extended headers'):
            self.verify()

    def test_symlink_archive_is_rejected_without_following_it(self):
        original = self.root / 'original.tar.gz'
        self.archive.rename(original)
        self.archive.symlink_to(original)
        with self.assertRaises(MODULE.VerificationError):
            self.verify()

    def test_cli_output_is_sanitized_private_and_never_overwrites_existing_identity(self):
        output = self.root / 'identity.json'
        command = [sys.executable, str(ROOT / 'ops/verify_mobile_backend_artifact.py'),
                   '--archive', str(self.archive), '--metadata', str(self.metadata),
                   '--expected-candidate-commit', CANDIDATE, '--expected-backend-source', SOURCE,
                   '--expected-image-reference', IMAGE, '--output', str(output)]
        success = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(success.returncode, 0, success.stderr)
        self.assertNotIn('must-never-be-output', success.stdout + success.stderr)
        previous = output.read_bytes()
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        again = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(again.returncode, 0)
        self.assertEqual(output.read_bytes(), previous)


if __name__ == '__main__':
    unittest.main()
