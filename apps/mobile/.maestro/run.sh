#!/usr/bin/env bash
# Runs Maestro flows with the E2E credentials from .maestro/.env.
#   .maestro/run.sh                  # all flows
#   .maestro/run.sh flows/login.yaml # one flow
# Prereqs: local backend (npm run backend), Metro + a dev build on the
# simulator (npx expo run:ios), simulator booted. See .maestro/README.md.
set -euo pipefail
cd "$(dirname "$0")"

set -a
# shellcheck disable=SC1091
source .env
set +a

exec maestro test \
  -e E2E_API_URL="${E2E_API_URL:-http://localhost:3000}" \
  -e E2E_AUTHOR_EMAIL="$E2E_AUTHOR_EMAIL" \
  -e E2E_AUTHOR_PASSWORD="$E2E_AUTHOR_PASSWORD" \
  -e E2E_REACTOR_EMAIL="$E2E_REACTOR_EMAIL" \
  -e E2E_REACTOR_PASSWORD="$E2E_REACTOR_PASSWORD" \
  "${@:-flows}"
