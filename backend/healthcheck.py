"""Lightweight container probe; talks directly to the local HTTP server without proxies."""

import http.client
import json

PATH = "/api/v1/internal/health/ready/"


def check_ready(*, port=8000):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=6)
    try:
        connection.request("GET", PATH, headers={"Host": "ilbi", "Accept": "application/json"})
        response = connection.getresponse()
        body = response.read(257)
        return response.status == 200 and len(body) <= 256 and json.loads(body) == {"status": "ready"}
    except (http.client.HTTPException, OSError, ValueError):
        return False
    finally:
        connection.close()


def main():
    ready = check_ready()
    print("ready" if ready else "not ready")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
