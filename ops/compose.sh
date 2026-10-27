#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
compose_args=(--env-file .env.production -f docker-compose.prod.yml)
# The separately staged activation file persists across ordinary deployments.
if [[ -f docker-compose.mobile-push.yml ]]; then
    compose_args+=(-f docker-compose.mobile-push.yml)
fi
exec docker compose "${compose_args[@]}" "$@"
