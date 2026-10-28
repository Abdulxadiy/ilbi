#!/usr/bin/env python3
"""Activate a verified staged mobile download without replacing desktop releases."""
import hashlib
import json
import re
import sys
from pathlib import Path


def activate(directory, staged_feed, commit):
    directory, staged_feed = Path(directory), Path(staged_feed)
    staged = json.loads(staged_feed.read_text())
    release = staged.get("mobile", {}).get("android", {})
    if staged.get("schema") != 1 or not re.fullmatch(r"[a-f0-9]{40}", commit) or release.get("sourceCommit") != commit:
        raise ValueError("Mobile release commit does not match")
    version, build = release.get("version", ""), release.get("buildNumber", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or not isinstance(build, str) or not build.isdigit() or not 0 < int(build) <= 2100000000:
        raise ValueError("Invalid mobile version/build")
    name = f"ILBI-{version}-android-{build}.apk"
    if release.get("applicationId") != "uz.ilbi.mobile" or release.get("url") != f"/downloads/mobile/{commit}/{name}" or not re.fullmatch(r"[a-f0-9]{64}", release.get("signerSha256", "")):
        raise ValueError("Invalid mobile package identity")
    artifact = directory / "mobile" / commit / name
    if any(path.is_symlink() for path in [artifact, artifact.parent, artifact.parent.parent]):
        raise ValueError("Mobile artifact must be a regular file")
    with artifact.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != release.get("sha256") or artifact.stat().st_size != release.get("bytes"):
        raise ValueError("Mobile artifact integrity check failed; current feed preserved")
    published = directory / "releases.json"
    feed = json.loads(published.read_text()) if published.exists() else {"schema": 1}
    if feed.get("schema") != 1:
        raise ValueError("Existing feed schema is invalid")
    mobile = feed.get("mobile") or {}
    previous = mobile.get("android") or (mobile if mobile.get("url") else {})
    if previous.get("signerSha256") and previous["signerSha256"] != release["signerSha256"]:
        raise ValueError("The established Android signing identity cannot be replaced")
    if previous.get("buildNumber") and previous != release:
        old_version = tuple(map(int, previous["version"].split('.')))
        if tuple(map(int, version.split('.'))) < old_version or int(build) <= int(previous["buildNumber"]):
            raise ValueError("Mobile publication must advance the native build without downgrading")
    # Keep a legacy Android alias for older download pages, plus the platform-specific entries.
    feed["mobile"] = {**mobile, **release, "android": release}
    temporary = directory / ".releases-mobile.json.part"
    temporary.write_text(json.dumps(feed, indent=2) + "\n")
    temporary.chmod(0o644)
    temporary.replace(published)
    return release


if __name__ == "__main__":
    print(json.dumps(activate(*sys.argv[1:])))
