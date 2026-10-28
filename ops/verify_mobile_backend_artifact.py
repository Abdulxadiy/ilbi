#!/usr/bin/env python3
"""Verify the current CI Docker/OCI export without extraction, Docker or secrets output."""
import argparse
import gzip
import hashlib
import json
import os
import re
import stat
import tarfile
from pathlib import Path

MAX_JSON = 1024 * 1024
MAX_JSON_MEMORY = 16 * MAX_JSON
MAX_ARCHIVE = 8 * 1024**3
MAX_CONTENTS = 32 * 1024**3
MAX_MEMBERS = 1024
SHA = re.compile(r'[a-f0-9]{64}\Z')
DIGEST = re.compile(r'sha256:[a-f0-9]{64}\Z')
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
IMAGE = re.compile(r'ghcr\.io/([a-z0-9_-]+)/([a-z0-9_.-]+)/backend:sha-([a-f0-9]{40})\Z')
BLOB = re.compile(r'blobs/sha256/([a-f0-9]{64})\Z')
OCI_INDEX = 'application/vnd.oci.image.index.v1+json'
OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json'
OCI_CONFIG = 'application/vnd.oci.image.config.v1+json'
RAW_LAYER = 'application/vnd.oci.image.layer.v1.tar'


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def regular_file(path, maximum):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= maximum,
            'Input must be a nonempty bounded regular file, not a symlink.')
    return path


def checksum(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON keys are not supported.')
        result[key] = value
    return result


def json_value(data):
    require(len(data) <= MAX_JSON, 'JSON metadata exceeds the supported limit.')
    try:
        return json.loads(data, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, RecursionError):
        raise VerificationError('Invalid bounded JSON metadata.') from None


def scan_archive(path):
    """Hash every blob in a single bounded streaming pass; retain only small JSON."""
    records, small = {}, {}
    total = retained = 0
    # Parse fixed-size outer headers ourselves. TarFile otherwise consumes PAX/
    # GNU extended-header payloads before exposing a member and its size limit.
    with (gzip.open(path, 'rb') if path.name.endswith('.gz') else path.open('rb')) as archive:
        while True:
            header = archive.read(512)
            require(len(header) == 512, 'Truncated outer tar header.')
            if header == bytes(512):
                padding = 512
                while chunk := archive.read(1024 * 1024):
                    padding += len(chunk)
                    require(padding <= MAX_JSON and not chunk.strip(b'\0'), 'Unsupported tar trailer.')
                require(padding >= 1024, 'Missing tar end markers.')
                break
            member = tarfile.TarInfo.frombuf(header, 'utf-8', 'surrogateescape')
            require(member.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE),
                    'Only regular files/directories are supported; extended headers and links are rejected.')
            name = member.name
            require(name not in records and len(records) < MAX_MEMBERS, 'Duplicate/excessive archive members.')
            require(name in ('index.json', 'oci-layout', 'manifest.json', 'repositories', 'blobs', 'blobs/sha256')
                    or BLOB.fullmatch(name), 'Unsupported or unsafe archive path.')
            if member.isdir():
                require(name in ('blobs', 'blobs/sha256') and member.size == 0, 'Unexpected archive directory.')
                records[name] = {'directory': True}
                continue
            total += member.size
            require(0 <= member.size <= MAX_CONTENTS and total <= MAX_CONTENTS, 'Archive contents exceed the supported limit.')
            require(name not in ('blobs', 'blobs/sha256'), 'Blob directories cannot be regular files.')
            blob = BLOB.fullmatch(name)
            if not blob:
                require(member.size <= MAX_JSON, 'Archive JSON exceeds the supported limit.')
            digest, first, saved = hashlib.sha256(), b'', bytearray()
            count = 0
            while count < member.size:
                chunk = archive.read(min(1024 * 1024, member.size - count))
                require(bool(chunk), 'Truncated archive member.')
                count += len(chunk)
                digest.update(chunk)
                if len(first) < 512:
                    first += chunk[:512 - len(first)]
                if member.size <= MAX_JSON:
                    saved.extend(chunk)
            padding = archive.read(-member.size % 512)
            require(len(padding) == -member.size % 512 and not padding.strip(b'\0'), 'Invalid tar member padding.')
            value = digest.hexdigest()
            if blob:
                require(value == blob.group(1), 'A blob content hash does not match its filename.')
            records[name] = {'sha256': value, 'size': count, 'first': first}
            if not blob or saved.lstrip().startswith((b'{', b'[')):
                retained += len(saved)
                require(retained <= MAX_JSON_MEMORY, 'Too much small JSON metadata.')
                small[name] = bytes(saved)
    return records, small


def descriptor(value, records, media_type):
    require(isinstance(value, dict) and value.get('mediaType') == media_type,
            'Unsupported OCI descriptor media type.')
    digest = value.get('digest')
    require(isinstance(digest, str) and DIGEST.fullmatch(digest), 'Unsupported OCI descriptor digest.')
    name = 'blobs/sha256/' + digest.split(':')[1]
    require(name in records and records[name].get('size') == value.get('size') and type(value.get('size')) is int,
            'Missing blob or mismatched descriptor size.')
    return name


def verify(archive, metadata, expected_candidate_commit, expected_backend_source, expected_image_reference):
    require(bool(COMMIT.fullmatch(expected_candidate_commit)) and bool(COMMIT.fullmatch(expected_backend_source)),
            'Expected candidate/source must be full immutable commit SHAs.')
    reference = IMAGE.fullmatch(expected_image_reference)
    require(reference is not None and reference.group(3) == expected_candidate_commit,
            'Expected image must be the exact candidate commit reference.')
    archive = regular_file(archive, MAX_ARCHIVE)
    metadata = json_value(regular_file(metadata, MAX_JSON).read_bytes())
    require(isinstance(metadata, dict), 'CI metadata must be an object.')
    require(metadata.get('candidate_commit') == expected_candidate_commit
            and metadata.get('backend_source') == expected_backend_source
            and metadata.get('image') == expected_image_reference and metadata.get('deployed') is False,
            'CI metadata does not identify the exact expected candidate/source/image.')
    name = metadata.get('archive')
    require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.tar(?:\.gz)?', name)
            and name == archive.name, 'Archive filename does not match bounded CI metadata.')
    require(type(metadata.get('archive_bytes')) is int and metadata['archive_bytes'] == archive.stat().st_size,
            'Archive byte count does not match CI metadata.')
    require(isinstance(metadata.get('archive_sha256'), str) and SHA.fullmatch(metadata['archive_sha256'])
            and checksum(archive) == metadata['archive_sha256'], 'Archive SHA256 does not match CI metadata.')
    published = metadata.get('digest')
    require(isinstance(published, str) and DIGEST.fullmatch(published)
            and metadata.get('digest_reference') == expected_image_reference.split(':sha-')[0] + '@' + published,
            'Published registry identity metadata is inconsistent.')
    portable_id = metadata.get('docker_image_id')
    require(isinstance(portable_id, str) and DIGEST.fullmatch(portable_id), 'CI config image ID is invalid.')
    records, small = scan_archive(archive)
    require(all(name in small for name in ('oci-layout', 'index.json', 'manifest.json', 'repositories')), 'Required OCI/Docker export metadata is missing.')
    require(json_value(small['oci-layout']) == {'imageLayoutVersion': '1.0.0'}, 'Unsupported OCI layout version.')
    index = json_value(small['index.json'])
    require(isinstance(index, dict) and index.get('schemaVersion') == 2 and index.get('mediaType') == OCI_INDEX,
            'Unsupported OCI index.')
    entries = index.get('manifests')
    require(isinstance(entries, list) and len(entries) == 1, 'Exactly one tagged OCI image is required.')
    entry = entries[0]
    manifest_name = descriptor(entry, records, OCI_MANIFEST)
    annotations = entry.get('annotations', {})
    require(isinstance(annotations, dict) and annotations.get('io.containerd.image.name') == expected_image_reference
            and annotations.get('org.opencontainers.image.ref.name') == 'sha-' + expected_candidate_commit,
            'OCI index tag does not match the reviewed image.')
    if 'platform' in entry:
        require(entry['platform'] == {'os': 'linux', 'architecture': 'amd64'}, 'Unsupported OCI index platform.')
    require(manifest_name in small, 'OCI manifest is not bounded JSON.')
    manifest = json_value(small[manifest_name])
    require(isinstance(manifest, dict) and manifest.get('schemaVersion') == 2 and manifest.get('mediaType') == OCI_MANIFEST,
            'Unsupported OCI manifest.')
    config_name = descriptor(manifest.get('config'), records, OCI_CONFIG)
    require('sha256:' + records[config_name]['sha256'] == portable_id and config_name in small,
            'Archive config digest does not match CI metadata.')
    config = json_value(small[config_name])
    require(isinstance(config, dict) and (config.get('os'), config.get('architecture')) == ('linux', 'amd64'),
            'Only the reviewed linux/amd64 image is supported.')
    runtime = config.get('config', {})
    require(isinstance(runtime, dict) and runtime.get('User') in ('1000', '1000:1000'), 'Image must run as user1000.')
    labels = runtime.get('Labels', {})
    require(isinstance(labels, dict) and labels.get('org.opencontainers.image.revision') == expected_candidate_commit,
            'Image OCI revision does not match the candidate.')
    expected_source_url = f'https://github.com/{reference.group(1)}/{reference.group(2)}'
    require(isinstance(labels.get('org.opencontainers.image.source'), str)
            and labels['org.opencontainers.image.source'].lower() == expected_source_url.lower(), 'Image source repository does not match.')
    rootfs = config.get('rootfs', {})
    require(isinstance(rootfs, dict) and rootfs.get('type') == 'layers', 'Unsupported root filesystem format.')
    diff_ids, layers = rootfs.get('diff_ids'), manifest.get('layers')
    require(isinstance(diff_ids, list) and isinstance(layers, list) and 0 < len(layers) == len(diff_ids) <= 256,
            'Layer/diff-ID counts do not match.')
    layer_paths = []
    for layer, diff_id in zip(layers, diff_ids, strict=True):
        path = descriptor(layer, records, RAW_LAYER)
        require(isinstance(diff_id, str) and DIGEST.fullmatch(diff_id) and layer['digest'] == diff_id,
                'Ordered uncompressed layer digests do not match config diff IDs.')
        item = records[path]
        require(item['size'] >= 1024 and item['size'] % 512 == 0, 'Layer is not the supported raw tar layout.')
        try:
            tarfile.TarInfo.frombuf(item['first'], 'utf-8', 'surrogateescape')
        except tarfile.EmptyHeaderError:
            require(item['first'] == bytes(512), 'Invalid empty tar layer header.')
        except tarfile.HeaderError:
            raise VerificationError('Layer header is not a valid uncompressed tar header.') from None
        layer_paths.append(path)
    legacy = json_value(small['manifest.json'])
    require(isinstance(legacy, list) and len(legacy) == 1 and isinstance(legacy[0], dict), 'Unsupported Docker compatibility manifest.')
    legacy = legacy[0]
    require(legacy.get('RepoTags') == [expected_image_reference] and legacy.get('Config') == config_name
            and legacy.get('Layers') == layer_paths, 'Docker and OCI manifest identities do not agree.')
    repository, tag = expected_image_reference.rsplit(':', 1)
    require(json_value(small['repositories']) == {repository: {tag: diff_ids[-1].split(':')[1]}},
            'Docker repository tag/final-layer mapping does not agree with OCI.')
    if 'LayerSources' in legacy:
        sources = legacy['LayerSources']
        require(isinstance(sources, dict) and set(sources) == set(diff_ids), 'Docker layer-source identities do not agree.')
        for layer in layers:
            require(isinstance(sources[layer['digest']], dict)
                    and all(sources[layer['digest']].get(key) == layer[key] for key in ('mediaType', 'digest', 'size')),
                    'Docker and OCI layer-source descriptors do not agree.')
    return {
        'verified': True, 'candidate_commit': expected_candidate_commit, 'backend_source': expected_backend_source,
        'image': expected_image_reference, 'archive': archive.name, 'archive_sha256': metadata['archive_sha256'],
        'archive_bytes': metadata['archive_bytes'], 'published_registry_digest': published,
        'oci_index_sha256': records['index.json']['sha256'], 'portable_config_digest': portable_id,
        'classic_expected_image_id': portable_id, 'containerd_expected_image_id': entry['digest'],
        'rootfs_diff_ids': diff_ids, 'layer_count': len(layers),
        'verified_blob_count': sum(bool(BLOB.fullmatch(name)) for name in records),
        'platform': 'linux/amd64', 'user': runtime['User'], 'all_blob_hashes_verified': True,
        'ordered_raw_layer_diff_ids_verified': True, 'archive_extracted': False,
        'loaded_host_verified': False, 'server_modified': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--metadata', required=True, type=Path)
    parser.add_argument('--expected-candidate-commit', required=True)
    parser.add_argument('--expected-backend-source', required=True)
    parser.add_argument('--expected-image-reference', required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.archive, args.metadata, args.expected_candidate_commit,
                        args.expected_backend_source, args.expected_image_reference)
        output = json.dumps(result, indent=2, sort_keys=True) + '\n'
        if args.output:
            fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                stream.write(output)
        print(output, end='')
    except VerificationError as exc:
        raise SystemExit(str(exc)) from None
    except (OSError, ValueError, TypeError, KeyError, tarfile.TarError, RecursionError):
        raise SystemExit('Artifact verification failed; unsupported/corrupt input or unsafe output path. Internal data withheld.') from None


if __name__ == '__main__':
    main()
