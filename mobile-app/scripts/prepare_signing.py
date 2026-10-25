"""Map the owner's established Android key to a protected, ignored EAS credential file."""
import argparse
import json
import os
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DEFAULT_RECORD = Path.home() / ".local/share/ilbi-signing/mobile/signing-credentials.json"


def prepare(record=DEFAULT_RECORD, target=APP / "credentials.json"):
    data = json.loads(Path(record).read_text())
    key = Path(data["keystore"]).expanduser().resolve()
    if not key.is_file() or not data.get("alias") or not data.get("storePassword"):
        raise ValueError("The established Android signing identity is incomplete")
    target = Path(target)
    current = json.loads(target.read_text()) if target.exists() else {}
    existing = current.get("android", {}).get("keystore")
    credentials = {"keystorePath": str(key), "keystorePassword": data["storePassword"], "keyAlias": data["alias"], "keyPassword": data["storePassword"]}
    if existing and existing != credentials:
        raise ValueError("An existing Android signing configuration cannot be silently replaced")
    current["android"] = {"keystore": credentials}
    temporary = target.with_name(".credentials.json.part")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(current, output, indent=2)
            output.write("\n")
        temporary.replace(target)
        target.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record", type=Path, default=DEFAULT_RECORD)
    args = parser.parse_args()
    prepare(args.record)
    print("Protected credentials.json prepared from the existing key. No passwords printed. Do not commit this file.")
