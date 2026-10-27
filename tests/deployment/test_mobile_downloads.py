"""Synthetic publisher fixtures; these do not claim a store-signed APK was built."""
import importlib.util
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


exporter = load("mobile_export", "mobile-app/scripts/export_downloads.py")
activator = load("mobile_activate", "ops/activate_mobile_downloads.py")
desktop = load("desktop_activate_mobile_retention", "ops/activate_downloads.py")


class MobileDownloadsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.apk = self.folder / "synthetic.apk"
        self.apk.write_bytes(b"explicit synthetic package fixture")
        self.commit = "a" * 40
        self.inspection = {"applicationId": "uz.ilbi.mobile", "version": "1.0.0", "buildNumber": "1", "signerSha256": "b" * 64}
        self.output = self.folder / "downloads"

    def stage(self, **changes):
        result = exporter.export(self.apk, self.output, self.commit, {**self.inspection, **changes})
        return result, self.output / "releases-mobile.json"

    def test_mobile_activation_preserves_both_desktop_platforms_and_ios(self):
        release, staged = self.stage()
        original = {"schema": 1, "windows": {"version": "1.4.0"}, "linux": {"version": "1.4.0"}, "mobile": {"ios": {"version": "1.0.0", "url": "https://apps.apple.com/uz/app/ilbi/id123456789"}}}
        (self.output / "releases.json").write_text(json.dumps(original))
        activator.activate(self.output, staged, self.commit)
        actual = json.loads((self.output / "releases.json").read_text())
        for platform in ["windows", "linux"]:
            self.assertEqual(actual[platform], original[platform])
        self.assertEqual(actual["mobile"]["ios"], original["mobile"]["ios"])
        self.assertEqual(actual["mobile"]["android"], release)
        self.assertEqual(actual["mobile"]["url"], release["url"])
        activator.activate(self.output, staged, self.commit)  # Idempotent activation.

    def test_corrupt_or_wrong_commit_preserves_current_feed(self):
        release, staged = self.stage()
        live = self.output / "releases.json"
        live.write_text('{"schema":1,"windows":{"version":"1.4.0"}}')
        before = live.read_bytes()
        with self.assertRaises(ValueError):
            activator.activate(self.output, staged, "c" * 40)
        (self.output / "mobile" / self.commit / Path(release["url"]).name).write_bytes(b"truncated")
        with self.assertRaisesRegex(ValueError, "integrity"):
            activator.activate(self.output, staged, self.commit)
        self.assertEqual(live.read_bytes(), before)

    def test_existing_build_and_signer_cannot_be_silently_replaced(self):
        _, staged = self.stage()
        activator.activate(self.output, staged, self.commit)
        before = (self.output / "releases.json").read_bytes()
        self.commit = "c" * 40
        for changes in [{"buildNumber": "1"}, {"buildNumber": "2", "signerSha256": "d" * 64}]:
            _, staged = self.stage(**changes)
            with self.assertRaises(ValueError):
                activator.activate(self.output, staged, self.commit)
        self.assertEqual((self.output / "releases.json").read_bytes(), before)
        _, staged = self.stage(buildNumber="2")
        activator.activate(self.output, staged, self.commit)

    def test_debug_and_foreign_signatures_are_rejected_before_export(self):
        config = {"expo": {"version": "1.0.0", "android": {"versionCode": 1}}}
        badging = "package: name='uz.ilbi.mobile' versionCode='1' versionName='1.0.0'\n"
        certificate = "Signer #1 certificate SHA-256 digest: " + "b" * 64
        with patch.object(exporter.subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0, badging, ''), subprocess.CompletedProcess([], 0, certificate, '')]):
            self.assertEqual(exporter.inspect_apk(self.apk, "aapt", "signer", "b" * 64, config)["buildNumber"], "1")
        with patch.object(exporter.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, badging + "application-debuggable", '')):
            with self.assertRaisesRegex(ValueError, "debuggable"):
                exporter.inspect_apk(self.apk, "aapt", "signer", "b" * 64, config)
        with patch.object(exporter.subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0, badging, ''), subprocess.CompletedProcess([], 0, certificate, '')]):
            with self.assertRaisesRegex(ValueError, "signature"):
                exporter.inspect_apk(self.apk, "aapt", "signer", "c" * 64, config)

    def test_native_camera_and_notification_permissions_are_required_when_configured(self):
        config = {"expo": {"version": "1.0.0", "android": {"versionCode": 1}, "plugins": [["expo-camera", {"barcodeScannerEnabled": True}], "expo-notifications"]}}
        badging = "package: name='uz.ilbi.mobile' versionCode='1' versionName='1.0.0'\n"
        certificate = "Signer #1 certificate SHA-256 digest: " + "b" * 64
        for missing in ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS']:
            permissions = ''.join("uses-permission: name='" + p + "'\n" for p in ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'] if p != missing)
            with self.subTest(missing=missing), patch.object(exporter.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, badging + permissions, '')):
                with self.assertRaisesRegex(ValueError, 'permission required'):
                    exporter.inspect_apk(self.apk, 'aapt', 'signer', 'b' * 64, config)
        permissions = "uses-permission: name='android.permission.CAMERA'\nuses-permission: name='android.permission.POST_NOTIFICATIONS'\n"
        with patch.object(exporter.subprocess, 'run', side_effect=[subprocess.CompletedProcess([], 0, badging + permissions, ''), subprocess.CompletedProcess([], 0, certificate, '')]):
            self.assertEqual(exporter.inspect_apk(self.apk, 'aapt', 'signer', 'b' * 64, config)['buildNumber'], '1')

    def test_blocked_microphone_permission_cannot_be_published(self):
        config = {"expo": {"version": "1.0.0", "android": {"versionCode": 1, "blockedPermissions": ['android.permission.RECORD_AUDIO']}}}
        badging = "package: name='uz.ilbi.mobile' versionCode='1' versionName='1.0.0'\nuses-permission: name='android.permission.RECORD_AUDIO'\n"
        with patch.object(exporter.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, badging, '')):
            with self.assertRaisesRegex(ValueError, 'blocked'):
                exporter.inspect_apk(self.apk, 'aapt', 'signer', 'b' * 64, config)

    def test_desktop_activation_and_retention_keep_mobile_artifacts_and_feed(self):
        release, staged = self.stage()
        activator.activate(self.output, staged, self.commit)
        commit = "d" * 40
        folder = self.output / commit
        folder.mkdir()
        installer = folder / "ILBI-Setup-1.4.0-x64.exe"
        installer.write_bytes(b"synthetic Windows fixture")
        windows = {"version": "1.4.0", "sourceCommit": commit, "url": f"/downloads/{commit}/{installer.name}", "bytes": installer.stat().st_size, "sha256": hashlib.sha256(installer.read_bytes()).hexdigest()}
        pending = self.output / "pending-desktop.json"
        pending.write_text(json.dumps({"schema": 1, "windows": windows, "mobile": None}))
        desktop.activate(self.output, pending, commit, keep=1)
        actual = json.loads((self.output / "releases.json").read_text())
        self.assertEqual(actual["mobile"]["android"], release)
        self.assertTrue((self.output / "mobile" / self.commit / Path(release["url"]).name).is_file())


if __name__ == "__main__":
    unittest.main()
