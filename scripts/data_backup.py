#!/usr/bin/env python3
"""Encrypted PostgreSQL + local media + docs backups; restore only into NEW isolated Docker resources."""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib
import uuid
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
LABEL = "io.ilbi.data-restore"
WRITER_SERVICES = {"ilbi", "celery_worker", "celery_beat", "bot"}
POSTGRES_IMAGE = "postgres:16-alpine"
MAX_FILES = 100_000
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
DEFAULT_MAX_BYTES = 100 * 1024**3


class BackupError(Exception):
    pass


def executable(name):
    value = shutil.which(name)
    if not value:
        raise BackupError(f"Kerakli dastur topilmadi: {name}")
    return value


def run(argv, *, input_data=None, stdout=None, pass_fds=(), timeout=600):
    """Never echo command lines or arbitrary tool stderr (they can contain private data)."""
    try:
        result = subprocess.run(  # noqa: S603 -- validated argv; never invoke a shell
            argv,
            input=input_data,
            stdout=stdout if stdout is not None else subprocess.PIPE,
            stderr=subprocess.PIPE,
            pass_fds=pass_fds,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BackupError("Tashqi vosita ishlamadi yoki kutish muddati tugadi.") from exc
    if result.returncode:
        raise BackupError("Tashqi vosita xato qaytardi. Maxfiy bo‘lishi mumkin bo‘lgan chiqish yashirildi.")
    return result


def docker(*args, **kwargs):
    return run([executable("docker"), *args], **kwargs)


def private_file(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    return os.fdopen(fd, "wb")


def outside_repo(path):
    path = Path(path).absolute()
    if path.is_symlink() or path.resolve().is_relative_to(ROOT):
        raise BackupError("Zaxira, parol va tiklangan ma’lumot repo tashqarisida bo‘lishi kerak.")
    return path.resolve()


def private_directory(path):
    path = outside_repo(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise BackupError("Zaxira katalogi faqat joriy foydalanuvchiga ochiq bo‘lishi kerak (chmod 700).")
    return path


def read_passphrase(path):
    path = outside_repo(path)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise BackupError("Parol fayli joriy foydalanuvchiga tegishli, oddiy va yopiq bo‘lsin (chmod 600).")
            if info.st_size > 4098:
                raise BackupError("Parol fayli juda katta.")
            value = stream.read(4099).removesuffix(b"\n").removesuffix(b"\r")
    except OSError as exc:
        raise BackupError("Parol faylini o‘qib bo‘lmadi.") from exc
    if not 16 <= len(value) <= 4096 or any(char in value for char in (b"\n", b"\r", b"\0")):
        raise BackupError("Parol kamida 16 belgidan iborat bitta satr bo‘lishi kerak.")
    return value


def crypt(source, target, passphrase, *, decrypt=False):
    gpg, gpgconf = executable("gpg"), executable("gpgconf")
    with tempfile.TemporaryDirectory(prefix="ilbi-gpg-") as home:
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, passphrase + b"\n")
            os.close(write_fd)
            write_fd = None
            argv = [
                gpg,
                "--homedir",
                home,
                "--no-options",
                "--batch",
                "--yes",
                "--no-tty",
                "--pinentry-mode",
                "loopback",
                "--no-symkey-cache",
                "--passphrase-fd",
                str(read_fd),
                "--output",
                str(target),
            ]
            argv += (
                ["--decrypt"]
                if decrypt
                else [
                    "--symmetric",
                    "--cipher-algo",
                    "AES256",
                    "--compress-algo",
                    "none",
                ]
            )
            argv.append(str(source))
            try:
                run(argv, pass_fds=(read_fd,))
            except BackupError as exc:
                raise BackupError(
                    "Shifrlash yoki ochish bajarilmadi: parol, fayl va GnuPG holatini tekshiring."
                ) from exc
            os.chmod(target, 0o600)
        finally:
            os.close(read_fd)
            if write_fd is not None:
                os.close(write_fd)
            subprocess.run(  # noqa: S603 -- stop only this temporary GPG home agent
                [gpgconf, "--homedir", home, "--kill", "gpg-agent"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=15,
            )


def relative_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or any(ord(c) < 32 for c in name):
        raise BackupError("Arxivda xavfli fayl manzili bor.")
    return path.as_posix()


def extract_tar(archive_path, destination, *, max_bytes, bundle):
    """Extract only ordinary files/dirs; do not trust archive links, permissions or paths."""
    seen, total = set(), 0
    try:
        with tarfile.open(archive_path, "r:") as archive:
            for member in archive:
                name = relative_name(member.name)
                if name == "." and member.isdir():
                    continue
                if name == "." or name in seen or len(seen) >= MAX_FILES:
                    raise BackupError("Arxivda takroriy nom yoki juda ko‘p fayl bor.")
                seen.add(name)
                if bundle and not (
                    name in {"database.dump", "manifest.json", "media", "docs"} or name.startswith(("media/", "docs/"))
                ):
                    raise BackupError("Arxiv tarkibi kutilgan zaxira formatiga mos emas.")
                path = destination / name
                if member.isdir():
                    path.mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                if not member.isfile() or member.size < 0:
                    raise BackupError("Arxivda symlink, hardlink yoki maxsus fayl bor.")
                total += member.size
                if total > max_bytes or (name == "manifest.json" and member.size > MAX_MANIFEST_BYTES):
                    raise BackupError("Arxiv ochilish hajmi belgilangan limitdan katta.")
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with (
                    archive.extractfile(member) as source,
                    private_file(path) as target,
                ):
                    shutil.copyfileobj(source, target)
    except (tarfile.TarError, OSError, ValueError) as exc:
        raise BackupError("Arxiv o‘qilmadi yoki xavfsiz ochilmadi.") from exc


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory(directory, prefix=""):
    files = {}
    for current, directories, filenames in os.walk(directory, followlinks=False):
        for name in directories + filenames:
            path = Path(current) / name
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                raise BackupError("Nusxalanadigan katalogda symlink yoki maxsus fayl bor.")
            relative = relative_name(path.relative_to(directory).as_posix())
            if path.is_file():
                key = f"{prefix}/{relative}" if prefix else relative
                files[key] = {"size": path.stat().st_size, "sha256": digest(path)}
                if len(files) > MAX_FILES:
                    raise BackupError("Zaxira uchun fayllar soni limitdan katta.")
    return files


def load_config(path):
    try:
        config = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise BackupError("Zaxira sozlamasi JSON faylidan o‘qilmadi.") from exc
    fields = {
        "version",
        "compose_project",
        "postgres_container",
        "database",
        "database_user",
        "media_container",
        "media_path",
        "docs_directory",
        "storage",
    }
    if not isinstance(config, dict) or set(config) != fields or config["version"] != 1:
        raise BackupError("Zaxira sozlamasi maydonlari yoki versiyasi noto‘g‘ri.")
    for field in (
        "compose_project",
        "postgres_container",
        "media_container",
        "database",
        "database_user",
    ):
        if not isinstance(config[field], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", config[field]):
            raise BackupError("Sozlamadagi identifikator noto‘g‘ri.")
    if config["storage"] != "local":
        raise BackupError("Bu versiya local media uchun. MinIO/S3 alohida backup adapterini talab qiladi.")
    if not all(isinstance(config[field], str) for field in ("media_path", "docs_directory")):
        raise BackupError("Media va hujjat kataloglari matn bo‘lishi kerak.")
    media = PurePosixPath(config["media_path"])
    if not media.is_absolute() or ".." in media.parts or str(media) == "/":
        raise BackupError("Media uchun aniq mutlaq katalog kerak.")
    docs = Path(config["docs_directory"])
    if not docs.is_absolute() or docs.is_symlink() or not docs.is_dir() or docs.resolve() == Path("/"):
        raise BackupError("Hujjatlar uchun mavjud mutlaq katalog kerak.")
    config["docs_directory"] = str(docs.resolve())
    config["media_path"] = str(media)
    return config


def source_state(config):
    ids = docker(
        "ps",
        "-aq",
        "--filter",
        f"label=com.docker.compose.project={config['compose_project']}",
    ).stdout.split()
    if not ids:
        raise BackupError("Sozlangan Compose loyihasi topilmadi.")
    records = json.loads(docker("inspect", *(value.decode() for value in ids)).stdout)
    by_name = {record["Name"].lstrip("/"): record for record in records}
    try:
        postgres, media = (by_name[config[key]] for key in ("postgres_container", "media_container"))
    except KeyError as exc:
        raise BackupError("Baza yoki media konteyneri shu Compose loyihasiga tegishli emas.") from exc

    def service(record):
        return record["Config"]["Labels"].get("com.docker.compose.service")

    if service(postgres) != "postgres" or service(media) != "ilbi" or not postgres["State"]["Running"]:
        raise BackupError("Baza/media xizmatlari yoki baza holati noto‘g‘ri.")
    environment = dict(item.split("=", 1) for item in media["Config"].get("Env", []) if "=" in item)
    if environment.get("USE_MINIO", "False").lower() in {"true", "1"}:
        raise BackupError("MinIO yoqilgan; mahalliy media nusxasi bilan to‘liq backup deb bo‘lmaydi.")
    writers = {}
    for record in records:
        if service(record) in WRITER_SERVICES:
            if record["State"]["Running"]:
                raise BackupError("Yozuvchi xizmatlar hali ishlayapti. Kelishilgan xizmat oynasida ularni to‘xtating.")
            writers[record["Id"]] = (
                record["State"]["StartedAt"],
                record["State"]["FinishedAt"],
            )
    return {"postgres_id": postgres["Id"], "media_id": media["Id"], "writers": writers}


def pg_args(config, *args):
    return [
        "--host=/var/run/postgresql",
        "--no-password",
        f"--username={config['database_user']}",
        f"--dbname={config['database']}",
        *args,
    ]


def validate_manifest(directory):
    try:
        manifest = json.loads((directory / "manifest.json").read_text())
    except (ValueError, OSError) as exc:
        raise BackupError("Zaxira manifesti o‘qilmadi.") from exc
    if not isinstance(manifest, dict) or manifest.get("format") != "ilbi-data-backup" or manifest.get("version") != 1:
        raise BackupError("Noma’lum zaxira formati.")
    if manifest.get("postgres_major") != 16 or manifest.get("storage") != "local":
        raise BackupError("Bu vosita PostgreSQL 16 va local media zaxirasini tiklaydi.")
    actual = inventory(directory)
    actual.pop("manifest.json", None)
    if actual != manifest.get("files") or "database.dump" not in actual:
        raise BackupError("Zaxiradagi fayllarning hajmi yoki checksum qiymati mos emas.")
    if not all((directory / name).is_dir() for name in ("media", "docs")):
        raise BackupError("Media yoki hujjatlar katalogi yo‘q.")
    with (directory / "database.dump").open("rb") as stream:
        if stream.read(5) != b"PGDMP":
            raise BackupError("PostgreSQL custom dump formati topilmadi.")
    return manifest


@contextlib.contextmanager
def opened_backup(archive, passphrase, max_bytes=DEFAULT_MAX_BYTES):
    with tempfile.TemporaryDirectory(prefix="ilbi-data-open-") as folder:
        work = Path(folder)
        plain = work / "payload.tar"
        crypt(archive, plain, passphrase, decrypt=True)
        extracted = work / "contents"
        extracted.mkdir(mode=0o700)
        extract_tar(plain, extracted, max_bytes=max_bytes, bundle=True)
        yield extracted, validate_manifest(extracted)


def create_backup(config_path, output_dir, passphrase_path, *, writers_stopped=False):
    if not writers_stopped:
        raise BackupError("Barcha tashqi yozuvlar ham to‘xtatilganini --writers-stopped bilan tasdiqlang.")
    config = load_config(config_path)
    password = read_passphrase(passphrase_path)
    output = private_directory(output_dir)
    if output.is_relative_to(config["docs_directory"]) or Path(config["docs_directory"]).is_relative_to(output):
        raise BackupError("Zaxira katalogi hujjatlar manbasidan alohida bo‘lishi kerak.")
    if Path(passphrase_path).resolve().is_relative_to(output) or Path(passphrase_path).resolve().is_relative_to(
        config["docs_directory"]
    ):
        raise BackupError("Parol fayli backup va hujjatlar katalogidan alohida turishi kerak.")
    lock_fd = os.open(output / ".data-backup.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "rb") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise BackupError("Bu katalogga boshqa zaxira jarayoni ishlayapti.") from exc
        state = source_state(config)
        info = docker("exec", state["postgres_id"], "pg_dump", "--version").stdout
        if not re.search(rb"PostgreSQL\) 16\.", info):
            raise BackupError("PostgreSQL 16 dump vositasi talab qilinadi.")
        with tempfile.TemporaryDirectory(prefix="ilbi-data-create-") as folder:
            work = Path(folder)
            payload = work / "contents"
            payload.mkdir(mode=0o700)
            with private_file(payload / "database.dump") as stream:
                docker(
                    "exec",
                    state["postgres_id"],
                    "pg_dump",
                    *pg_args(config, "--format=custom", "--no-acl"),
                    stdout=stream,
                )
            media_tar = work / "media.tar"
            with private_file(media_tar) as stream:
                docker(
                    "cp",
                    f"{state['media_id']}:{config['media_path']}/.",
                    "-",
                    stdout=stream,
                )
            (payload / "media").mkdir(mode=0o700)
            extract_tar(media_tar, payload / "media", max_bytes=DEFAULT_MAX_BYTES, bundle=False)
            media_tar.unlink()
            docs_before = inventory(Path(config["docs_directory"]))
            shutil.copytree(config["docs_directory"], payload / "docs", symlinks=True)
            docs_after = inventory(payload / "docs")
            if docs_before != docs_after or docs_before != inventory(Path(config["docs_directory"])):
                raise BackupError("Hujjatlar nusxa olish paytida o‘zgardi; zaxira qaytadan olinishi kerak.")
            manifest = {
                "format": "ilbi-data-backup",
                "version": 1,
                "postgres_major": 16,
                "storage": "local",
                "created_at": datetime.now(UTC).isoformat(),
                "source_project": config["compose_project"],
                "source_database": config["database"],
                "app_version": tomllib.loads((ROOT / "backend/pyproject.toml").read_text())["project"]["version"],
                "files": inventory(payload),
            }
            with private_file(payload / "manifest.json") as stream:
                stream.write(json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode())
            plain = work / "payload.tar"
            with tarfile.open(plain, "w") as archive:
                for name in ("database.dump", "media", "docs", "manifest.json"):
                    archive.add(payload / name, arcname=name, recursive=True)
            os.chmod(plain, 0o600)
            if source_state(config) != state or docs_before != inventory(Path(config["docs_directory"])):
                raise BackupError("Nusxa olinayotganda manba yoki yozuvchi xizmatlar o‘zgardi.")
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            final = output / f"ilbi-data-{stamp}-{uuid.uuid4().hex[:12]}.tar.gpg"
            fd, name = tempfile.mkstemp(prefix=".ilbi-data-", suffix=".partial", dir=output)
            os.close(fd)
            partial = Path(name)
            try:
                crypt(plain, partial, password)
                with opened_backup(partial, password) as (_, checked):
                    if checked != manifest:
                        raise BackupError("Yangi zaxira tekshiruvi mos kelmadi.")
                with partial.open("rb") as stream:
                    os.fsync(stream.fileno())
                os.link(partial, final)  # Never overwrite a previous backup, even on a name collision.
                directory_fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                partial.unlink(missing_ok=True)
            return {
                "archive": str(final),
                "sha256": digest(final),
                "files": len(manifest["files"]),
                "created_at": manifest["created_at"],
            }


def remove_restore(name, token):
    """Remove only resources created by this restore, never an arbitrary target."""
    for kind in ("container", "volume"):
        try:
            record = json.loads(docker(kind, "inspect", name).stdout)[0]
        except BackupError:
            continue
        labels = record.get("Labels", {}) if kind == "volume" else record["Config"].get("Labels", {})
        if labels.get(LABEL) != token:
            raise BackupError("Tiklash resursi belgisi mos emas; o‘chirish bajarilmadi.")
        docker(kind, "rm", *(["--force"] if kind == "container" else []), name)


def restore_backup(archive, destination, passphrase_path, *, max_bytes=DEFAULT_MAX_BYTES):
    destination = outside_repo(destination)
    if destination.exists():
        raise BackupError("Tiklash uchun yangi, hali mavjud bo‘lmagan katalog tanlang.")
    password = read_passphrase(passphrase_path)
    with opened_backup(archive, password, max_bytes) as (payload, manifest):
        # Authenticate and verify ALL files before creating a database or publishing restored files.
        image = json.loads(docker("image", "inspect", POSTGRES_IMAGE).stdout)[0]["Id"]
        token = uuid.uuid4().hex
        name = "ilbi-data-restore-" + token[:16]
        created = False
        destination_created = False
        try:
            docker("volume", "create", "--label", f"{LABEL}={token}", name)
            created = True
            container = (
                docker(
                    "create",
                    "--name",
                    name,
                    "--network",
                    "none",
                    "--label",
                    f"{LABEL}={token}",
                    "--security-opt",
                    "no-new-privileges:true",
                    "--mount",
                    f"type=volume,source={name},target=/var/lib/postgresql/data",
                    "--env",
                    "POSTGRES_HOST_AUTH_METHOD=trust",
                    "--env",
                    "POSTGRES_USER=ilbi_restore",
                    "--env",
                    "POSTGRES_DB=ilbi_restore",
                    image,
                )
                .stdout.decode()
                .strip()
            )
            docker("start", container)
            ready = False
            for _ in range(90):
                try:
                    docker(
                        "exec",
                        container,
                        "pg_isready",
                        "-U",
                        "ilbi_restore",
                        "-d",
                        "ilbi_restore",
                        timeout=5,
                    )
                    if docker("exec", container, "cat", "/proc/1/comm").stdout.strip() != b"postgres":
                        time.sleep(0.5)
                        continue
                    ready = True
                    break
                except BackupError:
                    time.sleep(0.5)
            if not ready:
                raise BackupError("Yangi tiklash bazasi tayyor bo‘lmadi.")
            with (payload / "database.dump").open("rb") as stream:
                # A fresh database only. There is deliberately no existing-container/DB target option.
                argv = [
                    executable("docker"),
                    "exec",
                    "-i",
                    container,
                    "pg_restore",
                    "--host=/var/run/postgresql",
                    "--username=ilbi_restore",
                    "--dbname=ilbi_restore",
                    "--no-owner",
                    "--no-acl",
                    "--exit-on-error",
                    "--single-transaction",
                ]
                try:
                    result = subprocess.run(  # noqa: S603 -- fresh isolated container, fixed argv
                        argv,
                        stdin=stream,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        timeout=1800,
                        check=False,
                    )
                except (OSError, subprocess.TimeoutExpired) as exc:
                    raise BackupError("Tiklash jarayoni ishlamadi yoki kutish muddati tugadi.") from exc
                if result.returncode:
                    raise BackupError("PostgreSQL nusxasidan tiklash bajarilmadi; maxfiy chiqish yashirildi.")
            destination.mkdir(mode=0o700, parents=True, exist_ok=False)
            destination_created = True
            for part in ("media", "docs"):
                shutil.copytree(payload / part, destination / part, symlinks=False)
            report = {
                "container": name,
                "volume": name,
                "resource_token": token,
                "database": "ilbi_restore",
                "database_user": "ilbi_restore",
                "network": "none",
                "source_created_at": manifest["created_at"],
                "app_version": manifest["app_version"],
                "media_directory": str(destination / "media"),
                "docs_directory": str(destination / "docs"),
            }
            with private_file(destination / "restore.json") as stream:
                stream.write(json.dumps(report, ensure_ascii=False, indent=2).encode())
            return report
        except BaseException:
            if created:
                remove_restore(name, token)
            if destination_created:
                shutil.rmtree(destination)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Create and verify an encrypted backup; never stops services.")
    create.add_argument("--config", required=True)
    create.add_argument("--output-dir", required=True)
    create.add_argument("--passphrase-file", required=True)
    create.add_argument("--writers-stopped", action="store_true")
    for action in ("verify", "restore"):
        command = commands.add_parser(action)
        command.add_argument("--archive", required=True)
        command.add_argument("--passphrase-file", required=True)
        command.add_argument("--max-unpacked-gib", type=int, default=100)
        if action == "restore":
            command.add_argument("--destination", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.command == "create":
            result = create_backup(
                args.config,
                args.output_dir,
                args.passphrase_file,
                writers_stopped=args.writers_stopped,
            )
        else:
            if args.max_unpacked_gib < 1:
                raise BackupError("Ochish hajmi limiti musbat bo‘lishi kerak.")
            limit = args.max_unpacked_gib * 1024**3
            if args.command == "restore":
                result = restore_backup(
                    args.archive,
                    args.destination,
                    args.passphrase_file,
                    max_bytes=limit,
                )
            else:
                with opened_backup(args.archive, read_passphrase(args.passphrase_file), limit) as (_, manifest):
                    result = {
                        "verified": True,
                        "created_at": manifest["created_at"],
                        "files": len(manifest["files"]),
                    }
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (BackupError, OSError, ValueError, KeyError, TypeError) as exc:
        message = (
            str(exc) if isinstance(exc, BackupError) else "Zaxira amali bajarilmadi; sozlama va resurslarni tekshiring."
        )
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
