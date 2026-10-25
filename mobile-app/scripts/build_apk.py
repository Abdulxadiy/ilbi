"""Build a standalone, owner-signed APK in an isolated CNG checkout; no Android Studio required."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from export_downloads import inspect_apk
from prepare_signing import APP, DEFAULT_RECORD

TOOLS = Path('/mnt/storage/.cache/ilbi-native-tools')


def copy_project(source, destination):
    source, destination = Path(source), Path(destination)
    destination.mkdir(parents=True)
    for name in ['src', 'assets', 'plugins']:
        if (source / name).is_dir():
            shutil.copytree(source / name, destination / name)
    for name in ['App.tsx', 'index.js', 'index.ts', 'app.json', 'app.config.js', 'app.config.ts', 'package.json', 'package-lock.json', 'babel.config.js', 'babel.config.cjs', 'metro.config.js', 'metro.config.cjs', 'tsconfig.json']:
        if (source / name).is_file():
            shutil.copyfile(source / name, destination / name)
    (destination / 'node_modules').symlink_to((source / 'node_modules').resolve(), target_is_directory=True)


def build(args):
    sdk = Path(args.android_sdk).expanduser().resolve()
    jdk = Path(args.jdk).expanduser().resolve()
    if not (APP / 'node_modules/.bin/expo').is_file():
        raise ValueError('Run npm ci inside mobile-app first')
    if not (jdk / 'bin/java').is_file() or not (sdk / 'platform-tools/adb').is_file():
        raise ValueError('Java 17 and an Android SDK are required; pass --jdk and --android-sdk')
    versions = [p for p in (sdk / 'build-tools').iterdir() if p.is_dir() and all(part.isdigit() for part in p.name.split('.'))]
    tools = max(versions, key=lambda p: tuple(map(int, p.name.split('.'))))
    config = json.loads((APP / 'app.json').read_text())
    if config['expo']['version'] != json.loads((APP / 'package.json').read_text())['version']:
        raise ValueError('Mobile app/config versions disagree')
    record = json.loads(Path(args.signing_record).expanduser().read_text())
    key = Path(record['keystore']).expanduser().resolve()
    if not key.is_file():
        raise ValueError('The established signing key is missing; restore it rather than replacing it')
    environment = {**os.environ, 'JAVA_HOME': str(jdk), 'ANDROID_HOME': str(sdk), 'ANDROID_SDK_ROOT': str(sdk), 'CI': '1', 'EXPO_NO_TELEMETRY': '1', 'EXPO_PUBLIC_DESIGN_PREVIEW': '0', 'EXPO_PUBLIC_UPDATE_PREVIEW': '0'}
    environment['PATH'] = str(jdk / 'bin') + os.pathsep + environment.get('PATH', '')
    if (TOOLS / 'gradle').is_dir() and 'GRADLE_USER_HOME' not in environment:
        environment['GRADLE_USER_HOME'] = str(TOOLS / 'gradle')
    cache = Path(args.build_cache).expanduser()
    cache.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='standalone-', dir=cache))
    project = work / 'mobile-app'
    commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=APP, capture_output=True, text=True, check=False).stdout.strip() or None
    modified = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=normal', '--', '.'], cwd=APP, capture_output=True, text=True, check=False).stdout.strip()
    copy_project(APP, project)
    if not any((project / name).exists() for name in ['metro.config.js', 'metro.config.cjs']):
        (project / 'metro.config.cjs').write_text("const { getDefaultConfig } = require('expo/metro-config');\nconst config = getDefaultConfig(__dirname);\nconfig.maxWorkers = 2;\nmodule.exports = config;\n")
    print('Generating native project outside the repository:', work, flush=True)
    subprocess.run(['node', 'node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install'], cwd=project, env=environment, check=True)
    subprocess.run(['./gradlew', ':app:assembleRelease', '--no-daemon', '--max-workers=1', '-PreactNativeArchitectures=' + args.architectures,
                    '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=384m -XX:+UseSerialGC -XX:ActiveProcessorCount=2', '-Pkotlin.compiler.execution.strategy=in-process'], cwd=project / 'android', env=environment, check=True)
    apk = project / 'android/app/build/outputs/apk/release/app-release.apk'
    if not apk.is_file():
        raise ValueError('Gradle did not produce the expected standalone APK')
    signing = {**environment, 'ILBI_ANDROID_STORE_PASSWORD': record['storePassword']}
    certificate = subprocess.run([str(jdk / 'bin/keytool'), '-exportcert', '-keystore', str(key), '-alias', record['alias'], '-storepass:env', 'ILBI_ANDROID_STORE_PASSWORD'], env=signing, check=True, capture_output=True).stdout
    signer = hashlib.sha256(certificate).hexdigest()
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = f"ILBI-{config['expo']['version']}-android-{config['expo']['android']['versionCode']}.apk"
    temporary = output / (name + '.part.apk')
    subprocess.run([str(tools / 'apksigner'), 'sign', '--ks', str(key), '--ks-key-alias', record['alias'], '--ks-pass', 'env:ILBI_ANDROID_STORE_PASSWORD', '--key-pass', 'env:ILBI_ANDROID_STORE_PASSWORD', '--out', str(temporary), str(apk)], env=signing, check=True)
    inspection = inspect_apk(temporary, tools / 'aapt2', tools / 'apksigner', signer, config, environment)
    subprocess.run([str(tools / 'zipalign'), '-c', '4', str(temporary)], env=environment, check=True, capture_output=True)
    final = output / name
    temporary.replace(final)
    incremental = Path(str(temporary) + '.idsig')
    if incremental.exists():
        incremental.replace(Path(str(final) + '.idsig'))
    with final.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    manifest = {**inspection, 'artifact': name, 'sha256': digest, 'bytes': final.stat().st_size, 'sourceCommit': commit, 'sourceModified': bool(modified), 'architectures': args.architectures.split(','), 'standalone': True, 'designPreview': False, 'builtAt': datetime.now(timezone.utc).isoformat()}
    (output / 'android-build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Standalone owner-signed APK:', final, flush=True)
    print('Mobile version/build unchanged:', inspection['version'], inspection['buildNumber'], flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--android-sdk', default=os.environ.get('ANDROID_HOME', str(TOOLS / 'sdk')))
    parser.add_argument('--jdk', default=os.environ.get('JAVA_HOME', str(TOOLS / 'jdk/jdk-17.0.21+9')))
    parser.add_argument('--signing-record', type=Path, default=DEFAULT_RECORD)
    parser.add_argument('--build-cache', type=Path, default=TOOLS / 'build' if TOOLS.is_dir() else Path.home() / '.cache/ilbi/android-builds')
    parser.add_argument('--output', type=Path, default=APP / 'dist/android')
    parser.add_argument('--architectures', choices=['arm64-v8a', 'x86_64', 'arm64-v8a,x86_64'], default='arm64-v8a,x86_64')
    build(parser.parse_args())
