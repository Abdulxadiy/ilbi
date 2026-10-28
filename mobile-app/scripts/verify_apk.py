"""Verify an existing standalone APK, pinned certificate and current runtime source.

Does not rebuild, install, upload, modify versions or read private signing secrets.
Native runtime acceptance is a separate check.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

from build_apk import APP, TOOLS, select_build_tools, validate_signer
from export_downloads import inspect_apk
from bundle_sources import verify_source_record

RUNTIME_PATHS = ['src', 'assets', 'plugins', 'vendor', 'scripts/patch-toolchain.cjs', 'google-services.json', 'App.tsx', 'index.js', 'index.ts', 'app.json', 'app.config.js', 'app.config.ts',
                 'package.json', 'package-lock.json', 'babel.config.js', 'babel.config.cjs', 'metro.config.js', 'metro.config.cjs', 'tsconfig.json', 'eas.json']
HOST_ONLY_SCRIPTS = {'test', 'typecheck', 'lint', 'test:preview', 'build:apk:check', 'verify:apk:local', 'prepare:signing'}


def runtime_changes(app, commit):
    if not isinstance(commit, str) or not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('A full original source commit is required to verify the runtime')
    app = Path(app).resolve()
    repo = Path(subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=app, capture_output=True, text=True, check=True).stdout.strip())
    prefix = app.relative_to(repo).as_posix()
    paths = [prefix + '/' + name for name in RUNTIME_PATHS]
    changed = subprocess.run(['git', 'diff', '--name-only', commit, '--', *paths], cwd=repo, capture_output=True, text=True, check=True).stdout.splitlines()
    added = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard', '--', *paths], cwd=repo, capture_output=True, text=True, check=True).stdout.splitlines()
    package = prefix + '/package.json'
    if package in changed and (app / 'package.json').is_file():
        previous = json.loads(subprocess.run(['git', 'show', commit + ':' + package], cwd=repo, capture_output=True, text=True, check=True).stdout)
        current = json.loads((app / 'package.json').read_text())
        # Known check helpers do not alter the installed runtime. Build/lifecycle
        # hooks may change bundled output, so unfamiliar script edits stay stale.
        previous_scripts = {key: value for key, value in previous.pop('scripts', {}).items() if key not in HOST_ONLY_SCRIPTS}
        current_scripts = {key: value for key, value in current.pop('scripts', {}).items() if key not in HOST_ONLY_SCRIPTS}
        if previous == current and previous_scripts == current_scripts:
            changed.remove(package)
    return sorted(set(changed + added))


def verify(apk, manifest_path, sdk, jdk, app=APP):
    apk, manifest_path, app = Path(apk), Path(manifest_path), Path(app)
    if apk.is_symlink() or not apk.is_file():
        raise ValueError('A regular APK is required; build it with npm run build:apk:local')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('standalone') is not True or manifest.get('designPreview') is not False:
        raise ValueError('The manifest must describe a standalone real-mode APK')
    if manifest.get('sourceModified'):
        raise ValueError('APK source was modified during its build. Commit runtime changes and rebuild before claiming a matching source commit.')
    changes = runtime_changes(app, manifest.get('sourceCommit'))
    if changes:
        raise ValueError('APK is stale; rebuild after these runtime changes: ' + ', '.join(changes))
    with apk.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if digest != manifest.get('sha256') or apk.stat().st_size != manifest.get('bytes'):
        raise ValueError('APK hash/size does not match its build manifest')
    public = json.loads((app / 'android-signing-public.json').read_text())
    validate_signer(manifest.get('signerSha256'), public)
    tools = select_build_tools(sdk)
    environment = {**os.environ, 'JAVA_HOME': str(jdk)}
    config = json.loads((app / 'app.json').read_text())
    if config['expo']['version'] != json.loads((app / 'package.json').read_text())['version']:
        raise ValueError('Mobile package/config versions disagree')
    inspection = inspect_apk(apk, tools / 'aapt2', tools / 'apksigner', public['signerSha256'], config, environment)
    if any(manifest.get(key) != value for key, value in inspection.items()):
        raise ValueError('APK native identity does not match the manifest')
    subprocess.run([str(tools / 'zipalign'), '-c', '4', str(apk)], env=environment, check=True, capture_output=True)
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        architectures = {name.split('/')[1] for name in names if name.startswith('lib/') and name.endswith('.so')}
        if not architectures or architectures != set(manifest.get('architectures', [])) or 'assets/index.android.bundle' not in names:
            raise ValueError('APK native architectures or embedded JavaScript are missing/inconsistent')
        verify_source_record(app, manifest, archive.read('assets/index.android.bundle'))
    return {'status': 'verified', 'apk': str(apk.resolve()), **inspection, 'sha256': digest, 'bytes': apk.stat().st_size,
            'architectures': sorted(architectures), 'sourceCommit': manifest['sourceCommit'], 'currentRuntimeMatches': True,
            'scope': 'artifact and source verification; native device acceptance is separate'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, help='Defaults to the artifact named in the build manifest')
    parser.add_argument('--manifest', type=Path, default=APP / 'dist/android/android-build-manifest.json')
    parser.add_argument('--android-sdk', type=Path, default=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or TOOLS / 'sdk')
    parser.add_argument('--jdk', type=Path, default=os.environ.get('JAVA_HOME') or TOOLS / 'jdk/jdk-17.0.21+9')
    args = parser.parse_args()
    apk = args.apk
    if apk is None:
        name = json.loads(args.manifest.read_text()).get('artifact')
        if not isinstance(name, str) or Path(name).name != name or not name.endswith('.apk'):
            parser.error('Build manifest must name a local APK file')
        apk = args.manifest.parent / name
    print(json.dumps(verify(apk, args.manifest, args.android_sdk, args.jdk), indent=2))
