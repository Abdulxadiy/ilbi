"""Stage a self-contained Windows runtime on Windows or Linux, without a compiler.

Pinned upstream archives are verified before extraction. Python dependencies use
the application lockfile and Windows wheels; no server .env or database is copied.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import tomllib
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {
    "ilbi",
    "gunicorn",
    "gevent",
    "greenlet",
    "psycopg2",
    "ruff",
    "factory-boy",
    "pytest",
    "pytest-cov",
    "pytest-django",
    "coverage",
    "iniconfig",
    "pluggy",
    "pygments",
    "django-stubs-ext",
    "django-stubs",
    "djangorestframework-stubs",
}


def extract(archive, destination, postgres=False):
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        for name in source.namelist():
            if not (destination / name).resolve().is_relative_to(destination.resolve()):
                raise ValueError("Unsafe ZIP path")
            parts = Path(name).parts
            if (
                postgres
                and len(parts) > 1
                and parts[1] not in {"bin", "lib", "share"}
                and not name.endswith(".txt")
            ):
                continue
            source.extract(name, destination)


def stage_source(backend):
    app = backend / "app"
    if app.exists():
        shutil.rmtree(app)
    for directory in ("apps", "api", "config", "data"):
        shutil.copytree(
            ROOT / "backend" / directory,
            app / directory,
            ignore=shutil.ignore_patterns("__pycache__", "tests", "test_*.py", ".env*"),
        )
    shutil.copy(ROOT / "backend/pyproject.toml", app / "pyproject.toml")
    shutil.copy(ROOT / "desktop/runtime.py", backend / "runtime.py")
    shutil.copy(ROOT / "desktop/backup_store.py", backend / "backup_store.py")
    docs = backend / "docs"
    if docs.exists():
        shutil.rmtree(docs)
    shutil.copytree(
        ROOT / "docs", docs, ignore=shutil.ignore_patterns("releases")
    )


def stage_msvc(resources, archive):
    with zipfile.ZipFile(archive) as source:
        for name in source.namelist():
            if name.lower().endswith(".dll") and ".data/data/" in name:
                destination = resources / "postgres/bin" / Path(name).name
                destination.write_bytes(source.read(name))
                python_destination = resources / "backend/python" / Path(name).name
                if not python_destination.exists():
                    python_destination.write_bytes(source.read(name))
            elif name.endswith("/licenses/LICENSE"):
                (resources / "postgres/msvc-runtime-LICENSE.txt").write_bytes(
                    source.read(name)
                )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(tempfile.gettempdir()) / "ilbi-windows-assets",
    )
    parser.add_argument(
        "--code-only",
        action="store_true",
        help="Refresh source in an already staged runtime",
    )
    args = parser.parse_args()
    if args.code_only:
        asset = json.loads((ROOT / "desktop/runtime-assets.json").read_text())["msvc"]
        archive = args.cache / asset["file"]
        with archive.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != asset["sha256"]:
                raise ValueError("Archive checksum mismatch: msvc")
        stage_source(ROOT / "desktop/ilbi/resources/backend")
        stage_msvc(ROOT / "desktop/ilbi/resources", archive)
        return
    args.cache.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "desktop/runtime-assets.json").read_text())
    archives = {}
    for name, asset in manifest.items():
        path = args.cache / asset["file"]
        if not path.exists():
            print("Downloading", name, flush=True)
            with (
                urllib.request.urlopen(asset["url"], timeout=60) as response,
                path.with_suffix(".part").open("wb") as output,
            ):
                shutil.copyfileobj(response, output)
            path.with_suffix(".part").replace(path)
        with path.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != asset["sha256"]:
                raise ValueError("Archive checksum mismatch: " + name)
        archives[name] = path
    resources = ROOT / "desktop/ilbi/resources"
    backend = resources / "backend"
    if backend.exists():
        shutil.rmtree(backend)
    extract(archives["python"], backend / "python")
    pth = next((backend / "python").glob("python*._pth"))
    pth.write_text("python313.zip\n.\nLib/site-packages\n../app\nimport site\n")
    lock = tomllib.loads((ROOT / "backend/uv.lock").read_text())
    packages = {
        item["name"]: item
        for item in lock["package"]
        if item["name"] not in EXCLUDED
        and "version" in item
        and "registry" in item.get("source", {})
    }
    requirements = []
    for name, item in sorted(packages.items()):
        hashes = sorted({wheel["hash"] for wheel in item.get("wheels", [])})
        if not hashes:
            raise ValueError("No locked wheels: " + name)
        requirements.append(
            f"{name}=={item['version']} "
            + " ".join("--hash=" + value for value in hashes)
        )
    # The server's source-built psycopg2 is replaced with its official Windows wheel.
    dependency = "psycopg2-binary"
    version = next(
        item["version"] for item in lock["package"] if item["name"] == "psycopg2"
    )
    wheel_lock = ROOT / "desktop/windows-wheel-lock.json"
    if wheel_lock.exists():
        binary = json.loads(wheel_lock.read_text())
        if binary["version"] != version:
            raise ValueError(
                "Refresh windows-wheel-lock.json for the new psycopg2 version"
            )
    else:
        with urllib.request.urlopen(
            f"https://pypi.org/pypi/{dependency}/{version}/json", timeout=30
        ) as response:
            metadata = json.load(response)
        binary = {
            "name": dependency,
            "version": version,
            "hashes": sorted(
                {
                    row["digests"]["sha256"]
                    for row in metadata["urls"]
                    if row["filename"].endswith(".whl")
                }
            ),
        }
        wheel_lock.write_text(json.dumps(binary, indent=2) + "\n")
    requirements.append(
        f"{dependency}=={version} "
        + " ".join("--hash=sha256:" + value for value in binary["hashes"])
    )
    requirements_path = args.cache / "requirements-windows.txt"
    requirements_path.write_text("\n".join(requirements) + "\n")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--target",
            str(backend / "python/Lib/site-packages"),
            "--platform",
            "win_amd64",
            "--python-version",
            "3.13",
            "--implementation",
            "cp",
            "--only-binary=:all:",
            "--no-deps",
            "--no-compile",
            "--require-hashes",
            "-r",
            str(requirements_path),
        ],
        check=True,
    )
    stage_source(backend)
    postgres = resources / "postgres"
    if not postgres.exists():
        with tempfile.TemporaryDirectory(dir=resources) as directory:
            temporary = Path(directory)
            extract(archives["postgres"], temporary, postgres=True)
            source = next(temporary.rglob("initdb.exe")).parent.parent
            shutil.copytree(source, postgres)
    stage_msvc(resources, archives["msvc"])
    required = [
        backend / "python/python.exe",
        postgres / "bin/initdb.exe",
        postgres / "bin/pg_ctl.exe",
        postgres / "bin/postgres.exe",
        postgres / "bin/createdb.exe",
    ]
    if not all(path.exists() for path in required):
        raise ValueError("Windows runtime is incomplete")
    if list(backend.rglob(".env*")):
        raise ValueError("Environment file must never be packaged")
    print(
        json.dumps(
            {
                "staged": True,
                "python": "3.13.16",
                "postgres": "16.15",
                "packages": len(packages) + 1,
                "resources": str(resources),
            }
        )
    )


if __name__ == "__main__":
    main()
