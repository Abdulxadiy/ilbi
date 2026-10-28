"""Build an isolated, relocatable Linux x64 runtime, without the host database.

Release builds run on Ubuntu 22.04 for glibc compatibility. PostgreSQL uses only
libc/libm (local loopback and SCRAM); LAN TLS is provided by the Electron host.
Only verified upstream archives and hashed wheels from the application lock ship.
"""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request
from pathlib import Path

from build_windows_runtime import EXCLUDED, ROOT, stage_source


def run(*command, **kwargs):
    subprocess.run(command, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=ROOT / "desktop/ilbi/build/linux-cache")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "AMD64"}:
        raise ValueError("Linux x64 builder required")
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    assets = json.loads((ROOT / "desktop/linux-runtime-assets.json").read_text())
    archives = {}
    for name, asset in assets.items():
        path = cache / asset["file"]
        if not path.exists():
            print("Downloading", name, flush=True)
            with urllib.request.urlopen(asset["url"], timeout=90) as source, path.with_suffix(".part").open("wb") as target:
                shutil.copyfileobj(source, target)
            path.with_suffix(".part").replace(path)
        with path.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != asset["sha256"]:
                raise ValueError("Archive checksum mismatch: " + name)
        archives[name] = path
    python_cache = cache / "python"
    if not (python_cache / "bin/python3").exists():
        with tarfile.open(archives["python"]) as source:
            source.extractall(cache, filter="data")
    postgres_cache = cache / "postgres"
    if not (postgres_cache / "bin/postgres").exists():
        with tarfile.open(archives["postgres"]) as source:
            source.extractall(cache, filter="data")
        source_directory = cache / "postgresql-16.15"
        build_env = {**os.environ, "CFLAGS": "-O2 -fno-omit-frame-pointer"}
        run("./configure", "--prefix=" + str(postgres_cache), "--without-readline", "--without-zlib", "--without-icu", cwd=source_directory, env=build_env)
        run("make", "-j" + str(max(1, min(args.jobs, 4))), cwd=source_directory)
        run("make", "install", cwd=source_directory)
    resources = ROOT / "desktop/ilbi/resources-linux"
    backend = resources / "backend"
    backend.mkdir(parents=True, exist_ok=True)
    if not (backend / "python/bin/python3").exists():
        shutil.copytree(python_cache, backend / "python", symlinks=True)
    python = backend / "python/bin/python3"
    version = subprocess.check_output([str(python), "-c", "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')"], text=True).strip()
    site_packages = backend / f"python/lib/python{version}/site-packages"
    lock = tomllib.loads((ROOT / "backend/uv.lock").read_text())
    packages = [item for item in lock["package"] if item["name"] not in EXCLUDED and "version" in item and "registry" in item.get("source", {})]
    requirements = []
    for item in sorted(packages, key=lambda item: item["name"]):
        hashes = sorted({wheel["hash"] for wheel in item.get("wheels", [])})
        if not hashes:
            raise ValueError("No locked wheels: " + item["name"])
        requirements.append(f"{item['name']}=={item['version']} " + " ".join("--hash=" + value for value in hashes))
    binary = json.loads((ROOT / "desktop/windows-wheel-lock.json").read_text())
    psycopg_version = next(item["version"] for item in lock["package"] if item["name"] == "psycopg2")
    if binary["version"] != psycopg_version:
        raise ValueError("Refresh the psycopg2-binary wheel lock")
    requirements.append(f"psycopg2-binary=={psycopg_version} " + " ".join("--hash=sha256:" + value for value in binary["hashes"]))
    requirements_path = cache / "requirements-linux.txt"
    requirements_path.write_text("\n".join(requirements) + "\n")
    run("uv", "pip", "install", "--python", str(python), "--target", str(site_packages), "--no-deps", "--require-hashes", "--only-binary", ":all:", "-r", str(requirements_path))
    stage_source(backend)
    postgres = resources / "postgres"
    if postgres.exists():
        shutil.rmtree(postgres)
    shutil.copytree(postgres_cache, postgres, symlinks=True)
    # PostgreSQL's build prefix must not remain a runtime dependency. Resolve
    # libpq and extension libraries relative to the installed executable instead.
    patchelf = shutil.which("patchelf")
    if not patchelf:
        patchelf = subprocess.check_output(["uvx", "--from", "patchelf==0.17.2.4", "python", "-c", "import shutil;print(shutil.which('patchelf'))"], text=True).strip()
    for path in postgres.rglob("*"):
        if path.is_file() and not path.is_symlink():
            with path.open("rb") as source:
                elf = source.read(4) == b"\x7fELF"
            if elf:
                relative_lib = os.path.relpath(postgres / "lib", path.parent)
                run(patchelf, "--set-rpath", "$ORIGIN/" + relative_lib, str(path))
    run(str(python), "-c", "import django, psycopg2, cryptography, PIL, waitress; print('Linux Python dependencies verified')")
    run(str(postgres / "bin/postgres"), "--version")
    if list(resources.rglob(".env*")):
        raise ValueError("Environment files must never be packaged")
    print(json.dumps({"staged": True, "platform": "linux", "python": "3.13.16", "postgres": "16.15", "resources": str(resources)}))


if __name__ == "__main__":
    main()
