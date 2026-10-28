"""Real encryption and isolated PostgreSQL recovery; never read any application data.

Run: python3 -m unittest discover -s tests/deployment -p 'test_data_backup.py' -v
Requires Docker, existing postgres:16-alpine, gpg and gpgconf. No host ports or app networks.
"""

import fcntl
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("data_backup", ROOT / "scripts/data_backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ilbi-backup-safety-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.key = self.root / "passphrase"
        self.key.write_bytes(b"synthetic-test-only-passphrase\n")
        self.key.chmod(0o600)

    def test_passphrase_requires_private_file_and_sufficient_length(self):
        self.assertEqual(backup.read_passphrase(self.key), b"synthetic-test-only-passphrase")
        self.key.chmod(0o644)
        with self.assertRaises(backup.BackupError):
            backup.read_passphrase(self.key)
        self.key.chmod(0o600)
        for invalid in (b"short", b"a" * 4096 + b"\ntrailing-data", b"long-enough-password\n\n"):
            self.key.write_bytes(invalid)
            with self.subTest(invalid_length=len(invalid)), self.assertRaises(backup.BackupError):
                backup.read_passphrase(self.key)

    def test_data_cannot_be_written_inside_repo(self):
        with self.assertRaises(backup.BackupError):
            backup.outside_repo(ROOT / "backups")

    def test_backup_requires_explicit_writer_acknowledgement(self):
        with self.assertRaisesRegex(backup.BackupError, "writers-stopped"):
            backup.create_backup("nonexistent.json", self.root / "out", self.key)

    def test_restore_refuses_existing_destination_without_touching_it(self):
        marker = self.root / "keep.txt"
        marker.write_text("unchanged")
        with self.assertRaisesRegex(backup.BackupError, "yangi"):
            backup.restore_backup("missing.gpg", self.root, self.key)
        self.assertEqual(marker.read_text(), "unchanged")

    def test_container_version_metadata_rejects_links_special_files_and_invalid_contents(self):
        cases = {
            "link": None,
            "directory": None,
            "fifo": None,
            "oversize": b"x" * (backup.MAX_APP_METADATA_BYTES + 1),
            "invalid-toml": b"[",
            "invalid-utf8": b"\xff",
            "missing": b"[project]\nname='synthetic'\n",
            "wrong-type": b"project='not-a-table'\n",
            "invalid-version": b"[project]\nversion='not-a-version'\n",
            "long-version": b"[project]\nversion='1.4.0+" + b"x" * 64 + b"'\n",
        }
        for kind, contents in cases.items():
            work = self.root / kind
            work.mkdir(mode=0o700)

            def copy_metadata(*args, **kwargs):
                destination = Path(args[2])
                if kind == "link":
                    destination.symlink_to(self.root / "keep-private")
                elif kind == "directory":
                    destination.mkdir()
                elif kind == "fifo":
                    os.mkfifo(destination)
                else:
                    destination.write_bytes(contents)

            with (
                self.subTest(kind=kind),
                patch.object(backup, "docker", copy_metadata),
                self.assertRaises(backup.BackupError),
            ):
                backup.source_app_version("synthetic-container", work)

    def test_archive_traversal_links_duplicates_and_size_are_rejected(self):
        for kind in (
            "traversal",
            "absolute",
            "symlink",
            "hardlink",
            "duplicate",
            "size",
        ):
            with self.subTest(kind=kind):
                archive = self.root / (kind + ".tar")
                with tarfile.open(archive, "w") as tar:
                    item = tarfile.TarInfo(
                        "../escape" if kind == "traversal" else "/escape" if kind == "absolute" else "media/x"
                    )
                    if kind in {"symlink", "hardlink"}:
                        item.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                        item.linkname = "../../escape"
                        tar.addfile(item)
                    else:
                        item.size = 10
                        tar.addfile(item, io.BytesIO(b"0123456789"))
                        if kind == "duplicate":
                            tar.addfile(item, io.BytesIO(b"0123456789"))
                target = self.root / kind
                target.mkdir(mode=0o700)
                with self.assertRaises(backup.BackupError):
                    backup.extract_tar(
                        archive,
                        target,
                        max_bytes=5 if kind == "size" else 1000,
                        bundle=True,
                    )
        self.assertFalse((self.root / "escape").exists())


class RealRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="ilbi-recovery-test-")
        cls.root = Path(cls.temporary.name)
        cls.token = uuid.uuid4().hex[:16]
        cls.project = "ilbi-backup-test-" + cls.token
        cls.postgres = cls.project + "-postgres"
        cls.media = cls.project + "-media"
        cls.created = []
        try:
            for tool in ("docker", "gpg", "gpgconf"):
                backup.executable(tool)
            backup.docker("image", "inspect", backup.POSTGRES_IMAGE)
            cls.key = cls.root / "passphrase"
            cls.key.write_bytes(b"synthetic-recovery-password-only\n")
            cls.key.chmod(0o600)
            cls.docs = cls.root / "docs"
            cls.docs.mkdir(mode=0o700)
            (cls.docs / "rules.md").write_text("Faqat sun’iy tiklash sinovi uchun hujjat.")
            cls.files = cls.root / "media"
            (cls.files / "products").mkdir(parents=True)
            (cls.files / "empty").mkdir()
            cls.image = b"synthetic-image-bytes\x00\xff\x89"
            (cls.files / "products" / "sample.png").write_bytes(cls.image)
            cls.container(
                "postgres",
                cls.postgres,
                "--env",
                "POSTGRES_HOST_AUTH_METHOD=trust",
                "--env",
                "POSTGRES_USER=ilbi_test",
                "--env",
                "POSTGRES_DB=ilbi_test",
            )
            backup.docker("start", cls.postgres)
            for _ in range(90):
                try:
                    backup.docker(
                        "exec",
                        cls.postgres,
                        "pg_isready",
                        "-U",
                        "ilbi_test",
                        "-d",
                        "ilbi_test",
                        timeout=5,
                    )
                    if backup.docker("exec", cls.postgres, "cat", "/proc/1/comm").stdout.strip() == b"postgres":
                        break
                except backup.BackupError:
                    pass
                time.sleep(0.2)
            else:
                raise AssertionError("Synthetic PostgreSQL did not start")
            cls.sql("""
                CREATE TABLE products (id serial PRIMARY KEY, name text NOT NULL, image text NOT NULL);
                CREATE TABLE sales (id serial PRIMARY KEY, product_id int REFERENCES products, total numeric(14,2));
                CREATE TABLE debts (id serial PRIMARY KEY, sale_id int REFERENCES sales, balance numeric(14,2));
                CREATE TABLE support_files (id serial PRIMARY KEY, data bytea NOT NULL);
                INSERT INTO products(name,image) VALUES ('Sun’iy mahsulot','products/sample.png');
                INSERT INTO sales(product_id,total) VALUES (1,123456.78);
                INSERT INTO debts(sale_id,balance) VALUES (1,456.78);
                INSERT INTO support_files(data) VALUES (decode('00ff102030','hex'));
            """)
            cls.container(
                "ilbi",
                cls.media,
                "--entrypoint",
                "/bin/true",
                "--env",
                "USE_MINIO=False",
            )
            backup.docker("cp", str(cls.files), f"{cls.media}:/tmp/")
            cls.application_version = "0.9.7"
            application = cls.root / "app"
            application.mkdir(mode=0o700)
            (application / "pyproject.toml").write_text(
                f'[project]\nname = "synthetic-backup-source"\nversion = "{cls.application_version}"\n'
            )
            backup.docker("cp", str(application), f"{cls.media}:/")
            cls.config = {
                "version": 1,
                "compose_project": cls.project,
                "postgres_container": cls.postgres,
                "database": "ilbi_test",
                "database_user": "ilbi_test",
                "media_container": cls.media,
                "media_path": "/tmp/media",  # noqa: S108 -- inside a disposable stopped container
                "docs_directory": str(cls.docs),
                "storage": "local",
            }
            cls.config_path = cls.root / "backup.json"
            cls.config_path.write_text(json.dumps(cls.config))
            cls.output = cls.root / "backups"
            cls.result = backup.create_backup(cls.config_path, cls.output, cls.key, writers_stopped=True)
            cls.archive = Path(cls.result["archive"])
        except BaseException:
            cls.cleanup()
            raise

    @classmethod
    def container(cls, service, name, *options):
        backup.docker(
            "create",
            "--name",
            name,
            "--network",
            "none",
            "--label",
            f"com.docker.compose.project={cls.project}",
            "--label",
            f"com.docker.compose.service={service}",
            *options,
            backup.POSTGRES_IMAGE,
        )
        cls.created.append(name)

    @classmethod
    def sql(cls, sql, container=None, user="ilbi_test"):
        return (
            backup.docker(
                "exec",
                "-i",
                container or cls.postgres,
                "psql",
                "--host=/var/run/postgresql",
                "--no-password",
                "--username=" + user,
                "--dbname=" + user,
                "--no-psqlrc",
                "--tuples-only",
                "--no-align",
                "--set=ON_ERROR_STOP=1",
                input_data=sql.encode(),
            )
            .stdout.decode()
            .strip()
        )

    @classmethod
    def cleanup(cls):
        for name in reversed(cls.created):
            try:
                backup.docker("rm", "--force", "--volumes", name)
            except backup.BackupError:
                pass
        cls.temporary.cleanup()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def test_encrypted_backup_is_private_and_complete(self):
        self.assertEqual(self.archive.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        self.assertNotIn((self.docs / "rules.md").read_bytes(), self.archive.read_bytes())
        self.assertFalse(list(self.output.glob("*.dump")))
        self.assertFalse(list(self.output.glob("*.partial")))
        with backup.opened_backup(self.archive, backup.read_passphrase(self.key)) as (
            payload,
            manifest,
        ):
            self.assertEqual((payload / "media/products/sample.png").read_bytes(), self.image)
            self.assertEqual(
                (payload / "docs/rules.md").read_text(),
                (self.docs / "rules.md").read_text(),
            )
            self.assertIn("database.dump", manifest["files"])
            self.assertEqual(manifest["app_version"], self.application_version)
            self.assertTrue((payload / "media/empty").is_dir())

    def test_standalone_deployment_needs_no_host_application_checkout(self):
        standalone = self.root / "standalone"
        (standalone / "scripts").mkdir(parents=True)
        script = standalone / "scripts/data_backup.py"
        shutil.copyfile(ROOT / "scripts/data_backup.py", script)
        output = self.root / "standalone-backups"
        result = subprocess.run(
            ["python3", str(script), "create", "--config", str(self.config_path),
             "--output-dir", str(output), "--passphrase-file", str(self.key), "--writers-stopped"],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((standalone / "backend").exists())
        self.assertFalse((standalone / "ilbi").exists())
        archive = Path(json.loads(result.stdout)["archive"])
        with backup.opened_backup(archive, backup.read_passphrase(self.key)) as (_, manifest):
            self.assertEqual(manifest["app_version"], self.application_version)
        self.assertEqual(self.sql("SELECT count(*) FROM products;"), "1")

    def test_restore_recovers_database_files_constraints_and_sequences_without_touching_source(
        self,
    ):
        original = self.sql("SELECT total FROM sales; SELECT balance FROM debts;")
        target = self.root / "restored"
        report = backup.restore_backup(self.archive, target, self.key)
        self.addCleanup(backup.remove_restore, report["container"], report["resource_token"])
        self.assertEqual(
            self.sql(
                "SELECT total FROM sales; SELECT balance FROM debts;",
                report["container"],
                "ilbi_restore",
            ),
            original,
        )
        self.assertEqual(
            self.sql(
                "SELECT encode(data,'hex') FROM support_files;",
                report["container"],
                "ilbi_restore",
            ),
            "00ff102030",
        )
        self.assertEqual(
            self.sql(
                "INSERT INTO products(name,image) VALUES ('New','new.png') RETURNING id;",
                report["container"],
                "ilbi_restore",
            ).splitlines()[0],
            "2",
        )
        with self.assertRaises(backup.BackupError):
            self.sql(
                "INSERT INTO sales(product_id,total) VALUES (999,1);",
                report["container"],
                "ilbi_restore",
            )
        self.assertEqual((target / "media/products/sample.png").read_bytes(), self.image)
        self.assertEqual((target / "docs/rules.md").read_text(), (self.docs / "rules.md").read_text())
        self.assertEqual(self.sql("SELECT total FROM sales; SELECT balance FROM debts;"), original)
        self.assertEqual(self.sql("SELECT count(*) FROM products;"), "1")
        container = json.loads(backup.docker("inspect", report["container"]).stdout)[0]
        self.assertEqual(container["HostConfig"]["NetworkMode"], "none")
        self.assertFalse(container["HostConfig"].get("PortBindings"))
        self.assertEqual(container["Config"]["Labels"][backup.LABEL], report["resource_token"])

    def test_wrong_password_and_damaged_archive_do_not_start_restore(self):
        wrong = self.root / "wrong-password"
        wrong.write_bytes(b"different-synthetic-test-password")
        wrong.chmod(0o600)
        damaged = self.root / "damaged.gpg"
        contents = bytearray(self.archive.read_bytes())
        contents[-15] ^= 0x10
        damaged.write_bytes(contents)
        for archive, key, name in (
            (self.archive, wrong, "wrong"),
            (damaged, self.key, "damaged"),
        ):
            with self.subTest(name=name), self.assertRaises(backup.BackupError):
                backup.restore_backup(archive, self.root / name, key)
            self.assertFalse((self.root / name).exists())

    def test_checksum_mismatch_is_rejected_before_restore(self):
        with backup.opened_backup(self.archive, backup.read_passphrase(self.key)) as (
            payload,
            _,
        ):
            (payload / "media/products/sample.png").write_bytes(b"changed")
            plain = self.root / "mismatch.tar"
            with tarfile.open(plain, "w") as tar:
                for path in payload.iterdir():
                    tar.add(path, arcname=path.name)
            encrypted = self.root / "mismatch.gpg"
            backup.crypt(plain, encrypted, backup.read_passphrase(self.key))
        with self.assertRaisesRegex(backup.BackupError, "checksum"):
            backup.restore_backup(encrypted, self.root / "mismatch-restore", self.key)
        self.assertFalse((self.root / "mismatch-restore").exists())

    def test_dump_failure_and_parallel_run_do_not_publish_partial_backup(self):
        config = {**self.config, "database": "does_not_exist"}
        path = self.root / "bad-database.json"
        path.write_text(json.dumps(config))
        before = set(self.output.iterdir())
        with self.assertRaises(backup.BackupError):
            backup.create_backup(path, self.output, self.key, writers_stopped=True)
        self.assertEqual(set(self.output.iterdir()), before)
        with (self.output / ".data-backup.lock").open("rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(backup.BackupError, "boshqa"):
                backup.create_backup(self.config_path, self.output, self.key, writers_stopped=True)

    def test_live_writer_and_minio_are_rejected(self):
        live = self.project + "-writer"
        backup.docker(
            "create",
            "--name",
            live,
            "--network",
            "none",
            "--label",
            f"com.docker.compose.project={self.project}",
            "--label",
            "com.docker.compose.service=celery_worker",
            "--entrypoint",
            "/bin/sleep",
            backup.POSTGRES_IMAGE,
            "300",
        )
        self.created.append(live)
        backup.docker("start", live)
        with self.assertRaisesRegex(backup.BackupError, "Yozuvchi"):
            backup.create_backup(self.config_path, self.output, self.key, writers_stopped=True)
        backup.docker("stop", "--timeout", "1", live)
        config = {**self.config, "storage": "minio"}
        path = self.root / "minio.json"
        path.write_text(json.dumps(config))
        with self.assertRaisesRegex(backup.BackupError, "MinIO"):
            backup.create_backup(path, self.output, self.key, writers_stopped=True)


if __name__ == "__main__":
    unittest.main()
