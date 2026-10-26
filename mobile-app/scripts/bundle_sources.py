"""Bind the packaged Hermes payload to actual application source contents."""
import hashlib
import json
from pathlib import Path
import zipfile


def source_file(project, relative):
    project = Path(project).resolve()
    if not isinstance(relative, str):
        raise ValueError('Invalid bundled application source path')
    name = Path(relative)
    if name.is_absolute() or not name.parts or name.parts[0] != 'src' or '..' in name.parts:
        raise ValueError('Invalid bundled application source path')
    file = (project / name).resolve()
    if not file.is_relative_to(project / 'src') or not file.is_file():
        raise ValueError('Bundled application source is missing: ' + relative)
    return file


def verify_bundle_sources(project, apk):
    project = Path(project)
    generated = project / 'android/app/build/generated'
    mapping = json.loads((generated / 'sourcemaps/react/release/index.android.bundle.map').read_text())
    sources, contents = mapping.get('sources', []), mapping.get('sourcesContent', [])
    if len(sources) != len(contents):
        raise ValueError('Source map must include original application source contents')
    digests = {}
    for source, content in zip(sources, contents):
        source = source.replace('\\', '/')
        # Metro also maps generated require.context modules such as app?ctx=...;
        # they are not source files on disk.
        if '?' in source or Path(source).suffix not in {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'}:
            continue
        if '/node_modules/' in '/' + source:
            continue
        if source.startswith('src/'):
            relative = source
        elif '/src/' in source:
            relative = 'src/' + source.split('/src/', 1)[1]
        else:
            continue
        file = source_file(project, relative)
        if content is None or content != file.read_text():
            raise ValueError('Stale bundled application source: ' + relative)
        digests[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
    if 'src/app/_layout.tsx' not in digests:
        raise ValueError('Bundle source map does not contain the application layout')
    expected = (generated / 'assets/react/release/index.android.bundle').read_bytes()
    with zipfile.ZipFile(apk) as archive:
        actual = archive.read('assets/index.android.bundle')
    if actual != expected:
        raise ValueError('Packaged JavaScript differs from the source-verified generated bundle')
    return {'bundleSha256': hashlib.sha256(actual).hexdigest(), 'bundledSources': digests}


def verify_source_record(app, manifest, payload):
    recorded = manifest.get('bundledSources')
    if not isinstance(recorded, dict) or 'src/app/_layout.tsx' not in recorded:
        raise ValueError('Rebuild: the APK manifest predates bundled-source verification')
    if hashlib.sha256(payload).hexdigest() != manifest.get('bundleSha256'):
        raise ValueError('Packaged JavaScript does not match its source-verification record')
    for relative, digest in recorded.items():
        if hashlib.sha256(source_file(app, relative).read_bytes()).hexdigest() != digest:
            raise ValueError('Bundled source no longer matches the application: ' + relative)
