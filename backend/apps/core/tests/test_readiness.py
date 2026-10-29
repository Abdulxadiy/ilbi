"""Readiness privacy, real HTTP probes, and disposable PostgreSQL/Redis recovery.

Requires Docker with existing postgres:16-alpine and redis:7-alpine images.
The production WSGI process below only sees newly created synthetic services.
"""

import http.client
import json
import select
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import healthcheck
import pytest

from apps.core import readiness

from .test_production_settings import ROOT, production_env
from .test_shared_throttles import docker


@pytest.mark.parametrize("peer", ["198.51.100.9", "172.31.0.2", "invalid", ""])
def test_readiness_rejects_nonlocal_peers_even_with_forged_proxy_headers(client, peer):
    with patch.object(readiness, "database_ready") as database, patch.object(readiness, "redis_ready") as redis:
        response = client.get(
            healthcheck.PATH, REMOTE_ADDR=peer, HTTP_X_FORWARDED_FOR="127.0.0.1", HTTP_X_REAL_IP="127.0.0.1"
        )
    assert response.status_code == 403
    assert response.json() == {"status": "forbidden"}
    assert "no-store" in response["Cache-Control"]
    database.assert_not_called()
    redis.assert_not_called()


@pytest.mark.parametrize("peer", ["127.0.0.1", "::1"])
def test_local_readiness_allows_safe_methods_only(client, peer):
    with (
        patch.object(readiness, "database_ready", return_value=True),
        patch.object(readiness, "redis_ready", return_value=True),
    ):
        response = client.get(healthcheck.PATH, REMOTE_ADDR=peer)
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
        assert "no-store" in response["Cache-Control"]
        response = client.head(healthcheck.PATH, REMOTE_ADDR=peer)
        assert response.status_code == 200 and not response.content
    with patch.object(readiness, "database_ready") as database:
        assert client.post(healthcheck.PATH, REMOTE_ADDR=peer).status_code == 405
        database.assert_not_called()


@pytest.mark.parametrize("dependency", ["database_ready", "redis_ready"])
def test_readiness_failure_does_not_disclose_credentials_or_tracebacks(client, caplog, dependency):
    secret = "synthetic-private-password-not-for-logs"
    with (
        patch.object(readiness, "database_ready", return_value=True),
        patch.object(readiness, "redis_ready", return_value=True),
        patch.object(readiness, dependency, side_effect=RuntimeError(secret)),
    ):
        response = client.get(healthcheck.PATH, REMOTE_ADDR="127.0.0.1")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
    assert "no-store" in response["Cache-Control"]
    assert secret not in response.content.decode() + caplog.text
    assert "Traceback" not in response.content.decode() + caplog.text


def test_probe_requires_exact_ready_response_and_does_not_follow_redirects():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.server.seen = (self.path, self.headers.get("Host"))
            status, body = self.server.reply
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Location", healthcheck.PATH)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for status, body, expected in (
            (200, b'{"status":"ready"}', True),
            (503, b'{"status":"not_ready"}', False),
            (302, b'{"status":"ready"}', False),
            (200, b"<html>ready</html>", False),
            (200, b'{"status":"not_ready"}', False),
            (200, b'{"status":"ready"}' + b" " * 300, False),
        ):
            server.reply = (status, body)
            assert healthcheck.check_ready(port=server.server_port) is expected
            assert server.seen == (healthcheck.PATH, "ilbi")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def local_response(port):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=7)
    try:
        connection.request("GET", healthcheck.PATH, headers={"Host": "ilbi"})
        response = connection.getresponse()
        return response.status, json.loads(response.read()), response.getheader("Cache-Control")
    finally:
        connection.close()


@pytest.mark.parametrize("initial", ["timeout", "unavailable"])
def test_deployment_wait_recovers_from_real_http_warmup(initial):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.server.calls += 1
            first = self.server.calls == 1
            if first and initial == "timeout":
                # Match production's >6s first response with the real timeout.
                threading.Event().wait(6.2)
            body = b'{"status":"not_ready"}' if first and initial == "unavailable" else b'{"status":"ready"}'
            self.send_response(503 if first and initial == "unavailable" else 200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # The first timed-out probe has already closed its socket.

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.calls = 0
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert healthcheck.wait_ready(port=server.server_port, interval=0.01)
        assert server.calls == 2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize("status,body", [
    (503, b'{"status":"not_ready"}'),
    (302, b'{"status":"ready"}'),
    (200, b'{"status":"not_ready"}'),
    (200, b"<html>ready</html>"),
    (200, b'{"status":"ready"}' + b" " * 300),
])
def test_deployment_wait_stops_and_fails_closed_on_persistent_bad_http(status, body):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.server.calls += 1
            self.send_response(status)
            self.send_header("Location", healthcheck.PATH)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.calls = 0
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert not healthcheck.wait_ready(port=server.server_port, interval=0.01)
        assert server.calls == 6
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize("arguments,wait", [([], False), (["--wait"], True)])
def test_probe_cli_keeps_docker_single_probe_and_deployment_wait_separate(arguments, wait, capsys):
    with patch.object(healthcheck, "check_ready", return_value=False) as single, patch.object(
        healthcheck, "wait_ready", return_value=False
    ) as waiting:
        assert healthcheck.main(arguments) == 1
    assert capsys.readouterr().out == "not ready\n"
    assert single.call_count == (0 if wait else 1)
    assert waiting.call_count == (1 if wait else 0)


@pytest.fixture(scope="module")
def synthetic_app():
    prefix = "ilbi-readiness-test-" + uuid.uuid4().hex[:12]
    names = {"postgres": prefix + "-postgres", "redis": prefix + "-redis"}
    created, process = [], None
    try:
        for image in ("postgres:16-alpine", "redis:7-alpine"):
            docker("image", "inspect", image)
        for service, internal_port, image, arguments in (
            (
                "postgres",
                5432,
                "postgres:16-alpine",
                [
                    "--tmpfs",
                    "/var/lib/postgresql/data:rw,nosuid,size=256m",
                    "--env",
                    "POSTGRES_USER=ilbi_health_test",
                    "--env",
                    "POSTGRES_DB=ilbi_health_test",
                    "--env",
                    "POSTGRES_PASSWORD=synthetic-readiness-only",
                ],
            ),
            ("redis", 6379, "redis:7-alpine", ["--tmpfs", "/data:rw,nosuid,size=16m"]),
        ):
            # Explicitly pin a free loopback port: Docker reallocates an empty
            # published port after stop/start, unlike production's stable DNS.
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                host_port = reservation.getsockname()[1]
            docker(
                "create",
                "--pull=never",
                "--name",
                names[service],
                "--label",
                "io.ilbi.readiness-test=true",
                "--publish",
                f"127.0.0.1:{host_port}:{internal_port}",
                *arguments,
                image,
                *(["redis-server", "--save", "", "--appendonly", "no"] if service == "redis" else []),
            )
            created.append(names[service])
            docker("start", names[service])
        ports = {}
        for service, internal_port in (("postgres", 5432), ("redis", 6379)):
            record = json.loads(docker("inspect", names[service]))[0]
            ports[service] = record["NetworkSettings"]["Ports"][f"{internal_port}/tcp"][0]["HostPort"]
        # Wait for the final PostgreSQL process rather than initdb's temporary server.
        for _ in range(100):
            if docker("exec", names["postgres"], "cat", "/proc/1/comm").strip() == "postgres":
                break
            time.sleep(0.1)
        else:
            pytest.fail("Synthetic PostgreSQL did not start.")
        process = subprocess.Popen(  # noqa: S603 -- synthetic services and explicit clean production environment
            [
                sys.executable,
                "-B",
                "-c",
                """
from wsgiref.simple_server import make_server, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args): pass
server = make_server('127.0.0.1', 0, get_wsgi_application(), handler_class=QuietHandler)
print(server.server_port, flush=True)
server.serve_forever()
""",
            ],
            cwd=ROOT,
            env=production_env(
                DB_NAME="ilbi_health_test",
                DB_USER="ilbi_health_test",
                DB_PASSWORD="synthetic-readiness-only",
                DB_HOST="127.0.0.1",
                DB_PORT=ports["postgres"],
                REDIS_URL=f"redis://127.0.0.1:{ports['redis']}/0",
            ),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert select.select([process.stdout], [], [], 20)[0], "Synthetic WSGI process did not start."
        line = process.stdout.readline().strip()
        assert line.isdecimal(), "Synthetic WSGI process failed to report its port."
        port = int(line)
        for _ in range(40):
            if local_response(port)[0] == 200:
                break
            time.sleep(0.1)
        else:
            pytest.fail("Synthetic dependencies did not become ready.")
        yield port, names
    finally:
        if process is not None:
            process.terminate()
            try:
                process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)
        for name in reversed(created):
            docker("rm", "--force", "--volumes", name)


@pytest.mark.parametrize("service", ["postgres", "redis"])
def test_real_dependency_outage_and_recovery(synthetic_app, service):
    port, names = synthetic_app
    assert healthcheck.check_ready(port=port)
    docker("stop", "--timeout", "1", names[service])
    try:
        status, body, cache_control = local_response(port)
        assert status == 503 and body == {"status": "not_ready"}
        assert "no-store" in cache_control
        assert not healthcheck.check_ready(port=port)
    finally:
        docker("start", names[service])
    for _ in range(150):
        if local_response(port)[0] == 200:
            break
        time.sleep(0.1)
    else:
        pytest.fail("Readiness did not recover after the synthetic service restarted.")
    assert healthcheck.check_ready(port=port)
    assert docker("exec", names["redis"], "redis-cli", "dbsize").strip() == "0"
    assert (
        docker(
            "exec",
            names["postgres"],
            "psql",
            "-U",
            "ilbi_health_test",
            "-d",
            "ilbi_health_test",
            "-tAc",
            "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
        ).strip()
        == "0"
    )
