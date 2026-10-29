"""Lightweight container probe; talks directly to the local HTTP server without proxies."""

import argparse
import http.client
import json
import time

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


def wait_ready(*, port=8000, interval=2):
    """Bounded deployment warm-up; every attempt keeps the exact HTTP probe."""
    for attempt in range(6):
        if check_ready(port=port):
            return True
        if attempt < 5:
            time.sleep(interval)
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wait", action="store_true", help="Retry strict readiness during deployment warm-up.")
    arguments = parser.parse_args(argv)
    ready = wait_ready() if arguments.wait else check_ready()
    print("ready" if ready else "not ready")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
