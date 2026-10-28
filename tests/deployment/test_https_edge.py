"""Isolated TLS/proxy integration tests; never start the application or access its data.

Run: python -m unittest discover -s tests/deployment -v
Requires existing nginx:alpine/python:3.12-slim images, Docker and OpenSSL.
"""

import http.client
import json
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOST = "production.example"
DOCKER = shutil.which("docker") or "/usr/bin/docker"


def command(*args):
    executable = shutil.which(args[0])
    if not executable:
        raise RuntimeError(f"Required test executable is missing: {args[0]}")
    # Fixed test commands and generated paths, passed as argv without a shell.
    return subprocess.run(  # noqa: S603
        [executable, *args[1:]],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout.strip()


class ProductionComposeTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="ilbi-compose-test-")
        self.addCleanup(self.scratch.cleanup)
        self.compose_root = Path(self.scratch.name)
        shutil.copy2(ROOT / "docker-compose.prod.yml", self.compose_root / "docker-compose.prod.yml")
        shutil.copy2(ROOT / ".env.production.example", self.compose_root / ".env.production.example")
        # Compose 2.38 checks env_file existence even with --no-env-resolution.
        # Use only checked-in examples in an isolated tree, never operator secrets.
        for folder in ("backend", "telegram_bot_sms"):
            destination = self.compose_root / folder / ".env.production"
            destination.parent.mkdir()
            shutil.copyfile(ROOT / folder / ".env.production.example", destination)
            destination.chmod(0o600)

    def compose_config(self, *options):
        return command(
            "docker",
            "compose",
            "--env-file",
            str(self.compose_root / ".env.production.example"),
            "-f",
            str(self.compose_root / "docker-compose.prod.yml"),
            "config",
            "--no-env-resolution",
            *options,
        )

    def test_settings_environment_and_private_network_boundary(self):
        services = json.loads(self.compose_config("--format", "json"))["services"]
        # Older Compose omits env_file and false bind flags from the resolved
        # model. Inspect those declared policies separately without interpolation.
        declared = json.loads(self.compose_config("--no-interpolate", "--format", "json"))["services"]
        for name in ("ilbi", "celery_worker", "celery_beat"):
            with self.subTest(service=name):
                env = services[name]["environment"]
                self.assertEqual(env["DJANGO_SETTINGS_MODULE"], "config.settings_production")
                self.assertEqual(env["GUNICORN_RELOAD"], "False")
                self.assertEqual(env["DJANGO_DEBUG"], "False")
                self.assertEqual(env["LOCAL_DEMO_LOGIN_ENABLED"], "False")
                self.assertTrue(declared[name]["env_file"][0]["path"].endswith("/backend/.env.production"))
        for name in ("ilbi", "celery_worker", "celery_beat", "postgres", "redis", "bot"):
            self.assertNotIn("ports", services[name])
        self.assertEqual(services["ilbi"]["healthcheck"]["test"], ["CMD", "python", "-B", "healthcheck.py"])
        for name in ("celery_worker", "celery_beat", "bot", "frontend"):
            self.assertEqual(services[name]["depends_on"]["ilbi"]["condition"], "service_healthy")
        edge = services["frontend"]
        self.assertEqual({port["target"] for port in edge["ports"]}, {80, 443})
        # Compose escapes literal dollars in its exported model for round-tripping.
        template_filter = edge["environment"]["NGINX_ENVSUBST_FILTER"].replace("$$", "$")
        self.assertEqual(template_filter, "^(PUBLIC_HOST|SECURE_HSTS_SECONDS)$")
        mount = next(volume for volume in edge["volumes"] if volume["target"] == "/etc/nginx/tls")
        self.assertTrue(mount["read_only"])
        declared_mount = next(volume for volume in declared["frontend"]["volumes"] if volume["target"] == "/etc/nginx/tls")
        self.assertFalse(declared_mount["bind"]["create_host_path"])

    def test_compose_requires_public_domain_and_existing_certificate_directory_setting(self):
        for missing in ("PUBLIC_HOST", "TLS_CERT_DIR"):
            with self.subTest(missing=missing):
                result = subprocess.run(  # noqa: S603
                    [
                        DOCKER,
                        "compose",
                        "--env-file",
                        str(self.compose_root / ".env.production.example"),
                        "-f",
                        str(self.compose_root / "docker-compose.prod.yml"),
                        "config",
                        "--no-env-resolution",
                        "-q",
                    ],
                    env={**os.environ, missing: ""},
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=30,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(missing, result.stderr)


class ProductionHttpsFixture:
    """Real TLS edge and a synthetic echo backend, with no application services."""

    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix="ilbi-https-test-")
        cls.addClassCleanup(cls.scratch.cleanup)
        folder = Path(cls.scratch.name)
        cls.certs = certs = folder / "tls"
        certs.mkdir()
        command(
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-sha256",
            "-days",
            "1",
            "-subj",
            f"/CN={HOST}",
            "-addext",
            f"subjectAltName=DNS:{HOST}",
            "-keyout",
            str(certs / "privkey.pem"),
            "-out",
            str(certs / "fullchain.pem"),
        )
        web = folder / "web"
        (web / "assets").mkdir(parents=True)
        (web / "index.html").write_text("isolated frontend fixture")
        (web / "assets" / "fixture.js").write_text("/* isolated asset */")
        (web / ".env").write_text("SYNTHETIC_PRIVATE_CONFIGURATION=must-not-be-served")
        (web / "assets" / ".env").write_text("SYNTHETIC_PRIVATE_CONFIGURATION=must-not-be-served")
        downloads = folder / "downloads"
        downloads.mkdir()
        (downloads / ".env").write_text("SYNTHETIC_PRIVATE_CONFIGURATION=must-not-be-served")
        (downloads / "releases.json").write_text('{"schema":1,"windows":{"version":"1.2.0"}}')
        (downloads / "ILBI-Setup-1.2.0-x64.exe").write_bytes(b"MZ" + b"isolated download fixture" * 100)
        tag = uuid.uuid4().hex[:12]
        cls.network = f"ilbi-https-test-{tag}"
        command("docker", "network", "create", cls.network)
        cls.addClassCleanup(command, "docker", "network", "rm", cls.network)
        cls.backend = backend = f"{cls.network}-backend"
        command(
            "docker",
            "run",
            "--pull=never",
            "--rm",
            "-d",
            "--name",
            backend,
            "--network",
            cls.network,
            "--network-alias",
            "ilbi",
            "python:3.12-slim",
            "python",
            "-B",
            "-c",
            """
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
counts = {}
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def do_GET(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        parsed = urlsplit(self.path)
        if parsed.path == '/_fixture/count':
            run = parse_qs(parsed.query)['run'][0]
            with lock:
                data = {'count': counts.get(run, 0)}
        else:
            run = self.headers.get('X-Test-Run')
            with lock:
                counts[run] = counts.get(run, 0) + 1
            data = dict(self.headers)
            data.update(_test_method=self.command, _test_body=body.decode(), _test_path=self.path)
        upstream_limited = parsed.path == '/api/fixture-throttled/'
        if upstream_limited:
            data = {'error': {'code': 'fixture_limit', 'message': 'upstream throttle'}}
        payload=json.dumps(data).encode()
        self.send_response(429 if upstream_limited else 200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Strict-Transport-Security','max-age=999999')
        if upstream_limited:
            self.send_header('Retry-After', '73')
        self.end_headers()
        self.wfile.write(payload)
    do_POST = do_GET
    do_OPTIONS = do_GET
    def log_message(self, *args): pass
ThreadingHTTPServer(('0.0.0.0',8000),Handler).serve_forever()
""",
        )
        cls.addClassCleanup(command, "docker", "rm", "-f", backend)
        # Two actual workers exercise shared-memory limits. Logs contain only
        # synthetic run IDs, worker PIDs and statuses, never request contents.
        main_config = folder / "nginx.conf"
        main_config.write_text(
            "worker_processes 2;\nevents { worker_connections 1024; }\n"
            "http {\ninclude /etc/nginx/mime.types;\n"
            "log_format fixture '$pid $status $http_x_test_run';\n"
            "access_log /var/log/nginx/fixture-access.log fixture;\n"
            "include /etc/nginx/conf.d/*.conf;\n}\n"
        )
        cls.edge = edge = f"{cls.network}-edge"
        command(
            "docker",
            "run",
            "--pull=never",
            "--rm",
            "-d",
            "--name",
            edge,
            "--network",
            cls.network,
            "--network-alias",
            HOST,
            "-p",
            "127.0.0.1::80",
            "-p",
            "127.0.0.1::443",
            "-e",
            f"PUBLIC_HOST={HOST}",
            "-e",
            "SECURE_HSTS_SECONDS=3600",
            "-e",
            "NGINX_ENVSUBST_FILTER=^(PUBLIC_HOST|SECURE_HSTS_SECONDS)$",
            "-v",
            f"{ROOT / 'frontend/ilbi/nginx.prod.conf'}:/etc/nginx/templates/default.conf.template:ro",
            "-v",
            f"{main_config}:/etc/nginx/nginx.conf:ro",
            "-v",
            f"{certs}:/etc/nginx/tls:ro",
            "-v",
            f"{web}:/usr/share/nginx/html:ro",
            "-v",
            f"{downloads}:/var/www/downloads:ro",
            "nginx:alpine",
        )
        cls.addClassCleanup(command, "docker", "rm", "-f", edge)
        cls.http_port = int(command("docker", "port", edge, "80/tcp").rsplit(":", 1)[1])
        cls.https_port = int(command("docker", "port", edge, "443/tcp").rsplit(":", 1)[1])
        cls.context = ssl.create_default_context(cafile=str(certs / "fullchain.pem"))
        for _ in range(100):
            try:
                if cls.https("/")[0] == 200:
                    break
            except (OSError, http.client.HTTPException):
                time.sleep(0.1)
        else:
            raise AssertionError("Isolated HTTPS edge failed to start: " + command("docker", "logs", edge))
        # A valid template must also pass Nginx's actual configuration checker.
        command("docker", "exec", edge, "nginx", "-t")

    @classmethod
    def https(cls, path, headers=None):
        connection = http.client.HTTPSConnection(HOST, context=cls.context, timeout=5)
        connection.sock = cls.context.wrap_socket(
            socket.create_connection(("127.0.0.1", cls.https_port), timeout=5),
            server_hostname=HOST,
        )
        try:
            connection.request("GET", path, headers={"Host": HOST, **(headers or {})})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()


class ProductionHttpsTests(ProductionHttpsFixture, unittest.TestCase):
    def test_public_download_feed_and_partial_installer_requests(self):
        status, headers, body = self.https("/downloads/releases.json")
        headers = {name.lower(): value for name, value in headers.items()}
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["schema"], 1)
        self.assertEqual(headers["cache-control"], "no-store")
        status, headers, body = self.https("/downloads/ILBI-Setup-1.2.0-x64.exe", {"Range": "bytes=0-1"})
        headers = {name.lower(): value for name, value in headers.items()}
        self.assertEqual(status, 206)
        self.assertEqual(body, b"MZ")
        self.assertEqual(headers["content-disposition"], "attachment")
        self.assertEqual(headers["content-type"], "application/octet-stream")
        self.assertEqual(self.https("/downloads/missing.exe")[0], 404)

    def test_http_redirect_preserves_method_and_path(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.http_port, timeout=5)
        try:
            connection.request(
                "POST",
                "/api/v1/auth/admin-login/?next=%2Fpos",
                body="fixture",
                headers={
                    "Host": HOST,
                    "X-Forwarded-Proto": "https",
                    "X-Forwarded-Host": "evil.example",
                },
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 308)
            self.assertEqual(response.getheader("Location"), f"https://{HOST}/api/v1/auth/admin-login/?next=%2Fpos")
            response.read()
        finally:
            connection.close()

    def test_client_cannot_spoof_proxy_headers(self):
        status, headers, body = self.https(
            "/api/v1/auth/profile/",
            {
                "X-Forwarded-Proto": "http",
                "X-Forwarded-For": "198.51.100.9",
                "X-Forwarded-Host": "evil.example",
                "X-Real-IP": "198.51.100.10",
            },
        )
        self.assertEqual(status, 200)
        forwarded = {key.lower(): value for key, value in json.loads(body).items()}
        self.assertEqual(forwarded["host"], HOST)
        self.assertEqual(forwarded["x-forwarded-proto"], "https")
        self.assertEqual(forwarded["x-forwarded-port"], "443")
        self.assertNotEqual(forwarded["x-forwarded-for"], "198.51.100.9")
        self.assertNotIn("x-forwarded-host", forwarded)
        self.assertEqual(headers["Strict-Transport-Security"], "max-age=3600")

    def test_private_api_is_blocked_at_edge(self):
        for path in (
            "/api/v1/internal",
            "/api/v1/internal/telegram/register/",
            "/api/v1/internal/health/ready/",
            "/api/v1/internal%2Fhealth/ready/",
            "/api/v1/internal%2Fshop/tenants/1/products/",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.https(path)[0], 403)

    def test_frontend_and_cached_assets_keep_security_headers(self):
        for path in ("/", "/assets/fixture.js", "/assets/missing.js"):
            with self.subTest(path=path):
                status, headers, _ = self.https(path)
                self.assertEqual(status, 404 if "missing" in path else 200)
                self.assertEqual(headers["Strict-Transport-Security"], "max-age=3600")
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_unknown_http_host_is_rejected(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.http_port, timeout=5)
        try:
            connection.request("GET", "/", headers={"Host": "evil.example"})
            with self.assertRaises(http.client.RemoteDisconnected):
                connection.getresponse()
        finally:
            connection.close()

    def test_hidden_configuration_files_are_not_served(self):
        for path in ("/.env", "/.env.production", "/.git/config", "/assets/.env", "/downloads/.env", "/api/v1/.env"):
            with self.subTest(path=path):
                status, headers, body = self.https(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"SYNTHETIC_PRIVATE_CONFIGURATION", body)
                self.assertNotIn(b"isolated frontend fixture", body)
                self.assertEqual(headers["Server"], "nginx")

    def test_unknown_tls_host_is_rejected(self):
        with socket.create_connection(("127.0.0.1", self.https_port), timeout=5) as raw:
            with self.assertRaises(ssl.SSLError):
                self.context.wrap_socket(raw, server_hostname="evil.example")

    def test_known_tls_name_cannot_use_an_unknown_http_host(self):
        with self.assertRaises(http.client.RemoteDisconnected):
            self.https("/", {"Host": "evil.example"})


if __name__ == "__main__":
    unittest.main()
