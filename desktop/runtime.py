"""Bundled desktop entry point. Runtime state is outside the install directory."""

import os
import sys
from datetime import UTC
from pathlib import Path

if not getattr(sys, "frozen", False):
    bundled_app = Path(__file__).resolve().parent / "app"
    sys.path.insert(0, str(bundled_app if bundled_app.is_dir() else Path(__file__).resolve().parents[1] / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_desktop"


def main():
    import django

    django.setup()
    from django.conf import settings

    if "--prepare" in sys.argv:
        from django.core.management import call_command

        call_command("migrate", interactive=False, verbosity=0)
        create_lan_certificate(Path(settings.DESKTOP_DATA_DIR))
        return
    from apps.desktop_sync.worker import start_worker
    from django.core.wsgi import get_wsgi_application
    from waitress import serve

    stop = start_worker()
    try:
        serve(
            get_wsgi_application(),
            host="127.0.0.1",
            port=int(os.environ["ILBI_DESKTOP_API_PORT"]),
            threads=8,
        )
    finally:
        stop.set()


def create_lan_certificate(directory):
    from datetime import datetime, timedelta

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    directory.mkdir(parents=True, exist_ok=True)
    if (directory / "lan.crt").exists() and (directory / "lan.key").exists():
        return
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "ILBI Local Store")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(UTC) - timedelta(days=1))
        .not_valid_after(datetime.now(UTC) + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(key, hashes.SHA256())
    )
    (directory / "lan.key").write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    (directory / "lan.key").chmod(0o600)
    (directory / "lan.crt").write_bytes(cert.public_bytes(serialization.Encoding.PEM))


if __name__ == "__main__":
    main()
