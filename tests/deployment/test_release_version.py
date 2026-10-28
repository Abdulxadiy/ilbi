"""A version change must align application metadata without changing dependencies."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))
from release_version import bump, check  # noqa: E402


class ReleaseVersionTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        for name in ("desktop/ilbi/package.json", "desktop/ilbi/package-lock.json", "frontend/ilbi/package.json",
                     "frontend/ilbi/package-lock.json", "backend/pyproject.toml", "backend/uv.lock", "desktop/ilbi/preload.cjs", "README.md"):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.version = check()
        notes = self.root / "docs/releases" / f"v{self.version}.md"
        notes.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "docs/releases" / notes.name, notes)

    def test_current_metadata_is_consistent(self):
        self.assertEqual(check(self.root), self.version)

    def test_bump_preserves_locked_dependencies_and_requires_new_notes(self):
        path = self.root / "frontend/ilbi/package-lock.json"
        before = json.loads(path.read_text())["packages"].copy()
        before.pop("")
        bump("9.4.1", self.root)
        with self.assertRaisesRegex(ValueError, "release notes"):
            check(self.root)
        (self.root / "docs/releases/v9.4.1.md").write_text("# ILBI v9.4.1\n\nReviewed notes.\n")
        self.assertEqual(check(self.root), "9.4.1")
        after = json.loads(path.read_text())["packages"].copy()
        after.pop("")
        self.assertEqual(before, after)

    def test_stale_desktop_bridge_blocks_release(self):
        path = self.root / "desktop/ilbi/preload.cjs"
        path.write_text(path.read_text().replace(f"version: '{self.version}'", "version: '0.0.1'"))
        with self.assertRaisesRegex(ValueError, "versions differ"):
            check(self.root)

    def test_invalid_version_does_not_modify_files(self):
        path = self.root / "desktop/ilbi/package.json"
        before = path.read_bytes()
        with self.assertRaises(ValueError):
            bump("v1.3.0;bad", self.root)
        self.assertEqual(path.read_bytes(), before)
