#!/usr/bin/env bash
# Called by CD after images have been built and CI has passed.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
if (($# != 3)); then
    echo 'Usage: ops/deploy_release.sh BACKEND_IMAGE FRONTEND_IMAGE BOT_IMAGE' >&2
    exit 2
fi
backend_image=$1
frontend_image=$2
bot_image=$3
for ref in "$@"; do
    [[ "$ref" =~ ^ghcr\.io/[a-z0-9/_-]+:sha-[a-f0-9]{40}$ ]] || {
        echo 'A commit-pinned GHCR image is required.' >&2; exit 2;
    }
done
exec 9>.operations.lock
flock -n 9 || { echo 'Another deployment or backup is running.' >&2; exit 1; }
for ref in "$@"; do docker pull "$ref"; done
source ./ops/backup.sh
backup_data
umask 077
cp .env.production .env.production.previous
python3 - "$backend_image" "$frontend_image" "$bot_image" <<'PY'
import os
import sys
import tempfile
from pathlib import Path

updates = dict(zip(('ILBI_BACKEND_IMAGE', 'ILBI_FRONTEND_IMAGE', 'ILBI_BOT_IMAGE'), sys.argv[1:]))
path = Path('.env.production')
lines = [line for line in path.read_text().splitlines() if line.split('=', 1)[0] not in updates]
with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.env.production-', delete=False) as pending:
    pending.write('\n'.join([*lines, *(f'{key}={value}' for key, value in updates.items()), '']))
os.replace(pending.name, path)
PY
if ! ./ops/compose.sh up -d --no-build --wait --wait-timeout 300; then
    echo 'Release failed. Backup and .env.production.previous are retained. Check migrations before rollback.' >&2
    exit 1
fi
./ops/compose.sh exec -T --interactive=false ilbi python -B healthcheck.py --wait
./ops/compose.sh exec -T --interactive=false frontend nginx -t
printf '%s\n' "$backend_image" "$frontend_image" "$bot_image" > .deployed-images
echo 'Release is healthy.'
