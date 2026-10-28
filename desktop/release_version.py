"""Keep application versions aligned; a release always needs reviewed Uzbek notes."""

import argparse
import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?")


def check(root=ROOT):
    root = Path(root)
    desktop = json.loads((root / "desktop/ilbi/package.json").read_text())["version"]
    if not VERSION.fullmatch(desktop):
        raise ValueError("Invalid application version")
    versions = {}
    for directory in ("desktop/ilbi", "frontend/ilbi"):
        versions[directory] = json.loads((root / directory / "package.json").read_text())["version"]
        lock = json.loads((root / directory / "package-lock.json").read_text())
        versions[directory + " lock"] = lock["version"]
        versions[directory + " lock root"] = lock["packages"][""]["version"]
    versions["backend"] = tomllib.loads((root / "backend/pyproject.toml").read_text())["project"]["version"]
    backend_lock = tomllib.loads((root / "backend/uv.lock").read_text())
    versions["backend lock"] = next(item["version"] for item in backend_lock["package"] if item["name"] == "ilbi")
    preload = (root / "desktop/ilbi/preload.cjs").read_text()
    versions["desktop bridge"] = re.search(r"\bversion: '([^']+)'", preload)[1]
    if any(value != desktop for value in versions.values()):
        raise ValueError(f"Application versions differ: {versions}")
    notes = root / "docs/releases" / f"v{desktop}.md"
    if not notes.is_file() or not notes.read_text().startswith(f"# ILBI v{desktop}\n"):
        raise ValueError(f"Write reviewed release notes in {notes.relative_to(root)}")
    return desktop


def bump(version, root=ROOT):
    if not VERSION.fullmatch(version):
        raise ValueError("Use a version such as 1.3.1 or 1.4.0-beta.1")
    root = Path(root)
    for directory in ("desktop/ilbi", "frontend/ilbi"):
        for name in ("package.json", "package-lock.json"):
            path = root / directory / name
            data = json.loads(path.read_text())
            data["version"] = version
            if name == "package-lock.json":
                data["packages"][""]["version"] = version
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    path = root / "backend/pyproject.toml"
    path.write_text(re.sub(r'(?m)^version = "[^"]+"', f'version = "{version}"', path.read_text(), count=1))
    path = root / "backend/uv.lock"
    path.write_text(re.sub(r'(\nname = "ilbi"\nversion = ")[^"]+', lambda match: match[1] + version, path.read_text(), count=1))
    path = root / "desktop/ilbi/preload.cjs"
    path.write_text(re.sub(r"\bversion: '[^']+'", f"version: '{version}'", path.read_text(), count=1))
    path = root / "README.md"
    path.write_text(re.sub(r"Current platform release: \[v[^]]+\]\(docs/releases/v[^)]+\)",
                           f"Current platform release: [v{version}](docs/releases/v{version}.md)", path.read_text(), count=1))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", nargs="?", help="Set the next version; omit to validate")
    args = parser.parse_args()
    if args.version:
        bump(args.version)
        print(f"Versions set to {args.version}. Write docs/releases/v{args.version}.md, then run this command without arguments.")
    else:
        print("Verified application version:", check())
