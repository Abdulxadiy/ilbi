"""Inspect a signed standalone Android APK and stage an immutable public download.

Does not upload or activate a server feed. The signer digest is supplied from the
owner's established signing identity, never learned implicitly from an APK.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def inspect_apk(apk, aapt, apksigner, expected_signer, config, environment=None):
    if not re.fullmatch(r"[a-f0-9]{64}", expected_signer):
        raise ValueError("A pinned SHA-256 signing certificate digest is required")
    badging = subprocess.run([str(aapt), "dump", "badging", str(apk)], check=True, capture_output=True, text=True, env=environment).stdout
    package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
    if not package or package[1] != "uz.ilbi.mobile":
        raise ValueError("The APK is not the ILBI mobile application")
    if "application-debuggable" in badging:
        raise ValueError("A debuggable/Metro APK cannot be advertised as an installable release")
    expo = config["expo"]
    if package[3] != expo["version"] or int(package[2]) != expo["android"]["versionCode"]:
        raise ValueError("APK version/build does not match the mobile app config")
    if not re.fullmatch(r"\d+\.\d+\.\d+", package[3]) or not 0 < int(package[2]) <= 2100000000:
        raise ValueError("Invalid Android version/build")
    plugins = {item[0] if isinstance(item, list) else item for item in expo.get("plugins", [])}
    permissions = set(re.findall(r"uses-permission(?:-sdk-\d+)?: name='([^']+)'", badging))
    required = {"expo-camera": "android.permission.CAMERA", "expo-notifications": "android.permission.POST_NOTIFICATIONS"}
    for plugin, permission in required.items():
        if plugin in plugins and permission not in permissions:
            raise ValueError(f"APK is missing the permission required by {plugin}: {permission}")
    blocked = {value if '.' in value else 'android.permission.' + value for value in expo["android"].get("blockedPermissions", [])}
    if blocked & permissions:
        raise ValueError("APK includes a permission blocked by the app config")
    certificates = subprocess.run([str(apksigner), "verify", "--print-certs", str(apk)], check=True, capture_output=True, text=True, env=environment).stdout
    digests = re.findall(r"certificate SHA-256 digest: ([a-fA-F0-9]{64})", certificates)
    if expected_signer not in [digest.lower() for digest in digests] or re.search(r"certificate DN:.*CN=Android Debug", certificates, re.I):
        raise ValueError("APK signature does not match the established release identity")
    return {"applicationId": package[1], "version": package[3], "buildNumber": package[2], "signerSha256": expected_signer}


def export(apk, output, commit, inspection, channel="preview"):
    apk, output = Path(apk), Path(output)
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or channel not in {"preview", "stable"}:
        raise ValueError("Invalid source commit/channel")
    if (inspection.get("applicationId") != "uz.ilbi.mobile"
            or not re.fullmatch(r"\d+\.\d+\.\d+", inspection.get("version", ""))
            or not re.fullmatch(r"[1-9]\d{0,9}", inspection.get("buildNumber", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", inspection.get("signerSha256", ""))):
        raise ValueError("Expected verified mobile package metadata")
    if apk.is_symlink() or not apk.is_file() or not 0 < apk.stat().st_size <= 2 * 1024 ** 3:
        raise ValueError("Expected a bounded regular APK")
    with apk.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    name = f"ILBI-{inspection['version']}-android-{inspection['buildNumber']}.apk"
    target = output / "mobile" / commit
    target.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or target.parent.is_symlink():
        raise ValueError("Expected a regular staging directory")
    final = target / name
    if final.exists():
        if final.is_symlink():
            raise ValueError("Expected a regular immutable APK")
        with final.open("rb") as previous:
            if hashlib.file_digest(previous, "sha256").hexdigest() != digest:
                raise ValueError("An immutable release already exists with different contents")
    temporary = target / (name + ".part")
    shutil.copyfile(apk, temporary)
    temporary.replace(final)
    release = {**inspection, "sourceCommit": commit, "url": f"/downloads/mobile/{commit}/{name}", "bytes": apk.stat().st_size, "sha256": digest, "channel": channel}
    feed = {"schema": 1, "mobile": {**release, "android": release}}
    staged = output / "releases-mobile.json"
    part = staged.with_suffix(".json.part")
    part.write_text(json.dumps(feed, indent=2) + "\n")
    part.replace(staged)
    return release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--signer-sha256", required=True)
    parser.add_argument("--aapt", type=Path, required=True)
    parser.add_argument("--apksigner", type=Path, required=True)
    parser.add_argument("--channel", choices=["preview", "stable"], default="preview")
    args = parser.parse_args()
    config = json.loads((APP / "app.json").read_text())
    if config["expo"]["version"] != json.loads((APP / "package.json").read_text())["version"]:
        raise ValueError("Mobile package/config versions disagree")
    inspection = inspect_apk(args.apk, args.aapt, args.apksigner, args.signer_sha256, config)
    print(json.dumps(export(args.apk, args.output, args.release_id, inspection, args.channel)))


if __name__ == "__main__":
    main()
