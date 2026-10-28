"""A release must not lose or expose the existing private server environment."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("backend_layout", ROOT / "ops/prepare_backend_layout.py")
layout = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(layout)


class BackendLayoutTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        (self.root / "ilbi").mkdir()
        self.old = self.root / "ilbi/.env.production"
        self.new = self.root / "backend/.env.production"
        self.old.write_bytes(b"SYNTHETIC_ONLY=preserve-exact-bytes\r\n")
        self.old.chmod(0o600)

    def test_default_inspects_without_creating_a_directory_or_copy(self):
        self.assertTrue(layout.prepare(self.root)["copy_required"])
        self.assertFalse(self.new.parent.exists())

    def test_copies_exactly_once_with_private_mode_and_keeps_legacy(self):
        result = layout.prepare(self.root, apply=True)
        self.assertTrue(result["ready"] and result["copied"] and result["legacy_preserved"])
        self.assertEqual(self.new.read_bytes(), self.old.read_bytes())
        self.assertEqual(self.new.stat().st_mode & 0o777, 0o600)
        self.assertFalse(layout.prepare(self.root, apply=True)["copied"])

    def test_different_existing_files_are_preserved_and_rejected(self):
        self.new.parent.mkdir()
        self.new.write_text("OTHER_SYNTHETIC_VALUE=do-not-overwrite\n")
        self.new.chmod(0o600)
        before = self.new.read_bytes()
        with self.assertRaises(layout.LayoutError):
            layout.prepare(self.root, apply=True)
        self.assertEqual(self.new.read_bytes(), before)

    def test_current_only_is_accepted_without_recreating_legacy(self):
        layout.prepare(self.root, apply=True)
        self.old.unlink()
        result = layout.prepare(self.root, apply=True)
        self.assertTrue(result["ready"])
        self.assertFalse(result["legacy_preserved"] or result["copied"])
        self.assertFalse(self.old.exists())

    def test_missing_both_files_is_rejected(self):
        self.old.unlink()
        with self.assertRaises(layout.LayoutError):
            layout.prepare(self.root, apply=True)

    def test_public_permissions_are_rejected_without_copy(self):
        self.old.chmod(0o644)
        with self.assertRaises(layout.LayoutError):
            layout.prepare(self.root, apply=True)
        self.assertFalse(self.new.exists())

    def test_file_and_directory_symlinks_are_rejected(self):
        target = self.root / "outside-private"
        target.write_text("SYNTHETIC=outside\n")
        target.chmod(0o600)
        self.old.unlink()
        self.old.symlink_to(target)
        with self.assertRaises((layout.LayoutError, OSError)):
            layout.prepare(self.root, apply=True)
        self.old.unlink()
        self.old.write_text("SYNTHETIC=restored\n")
        self.old.chmod(0o600)
        self.new.parent.symlink_to(self.root / "ilbi", target_is_directory=True)
        with self.assertRaises(layout.LayoutError):
            layout.prepare(self.root, apply=True)
        self.assertEqual(os.readlink(self.new.parent), str(self.root / "ilbi"))

    def test_failed_write_removes_only_new_copy_and_preserves_the_legacy_environment(self):
        before = self.old.read_bytes()
        with (
            patch.object(layout.os, "fsync", side_effect=OSError("Synthetic disk failure")),
            self.assertRaises(OSError),
        ):
            layout.prepare(self.root, apply=True)
        self.assertEqual(self.old.read_bytes(), before)
        self.assertFalse(self.new.exists())
