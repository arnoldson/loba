#!/usr/bin/env bash
# One-command local E2E run (#30): boots the backend and Metro (with the E2E flag),
# runs the Maestro flows, records a report, checks nothing was left behind, and
# shuts everything down again.
#
#   npm run e2e                       # from the repo root -- all flows
#   npm run e2e -- flows/login.yaml   # just some flows
#
# Local only, by design. Touches real data (see README) -- flows clean up after
# themselves and this script verifies it. A recorded pass lands in
# .maestro/reports/<timestamp>-<commit>[-dirty]/ (gitignored): report.xml (JUnit)
# and summary.txt.
set -uo pipefail

MAESTRO_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(dirname "$MAESTRO_DIR")"
REPO_DIR="$(cd "$MOBILE_DIR/../.." && pwd)"
APP_ID="com.arnoldson.loba"
BACKEND_PORT=3000
METRO_PORT=8081

die() { echo "e2e: $*" >&2; exit 2; }

# ─── Preflight ──────────────────────────────────────────────────────────
[ -f "$MAESTRO_DIR/.env" ] || die "missing .maestro/.env (E2E test account credentials) -- see .maestro/README.md"
command -v maestro >/dev/null || die "maestro not installed (brew install mobile-dev-inc/tap/maestro)"
xcrun simctl list devices booted | grep -q Booted || die "no booted iOS simulator (open one in Simulator.app)"
xcrun simctl get_app_container booted "$APP_ID" >/dev/null 2>&1 \
  || die "dev build not installed on the booted simulator -- run 'npx expo run:ios' in apps/mobile once"
for port in $BACKEND_PORT $METRO_PORT; do
  lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 \
    && die "port $port is already in use -- stop the running backend/Metro first (this script starts its own)"
done

# ─── Start backend + Metro; always stop them on exit ────────────────────
LOG_DIR="$(mktemp -d)"
set -m # job control: each background job gets its own process group we can kill whole
PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null
  done
}
trap cleanup EXIT INT TERM

(cd "$REPO_DIR" && exec npm run backend) >"$LOG_DIR/backend.log" 2>&1 &
PIDS+=($!)
(cd "$MOBILE_DIR" && EXPO_PUBLIC_E2E=1 exec npx expo start --dev-client --port "$METRO_PORT" --clear) >"$LOG_DIR/metro.log" 2>&1 &
PIDS+=($!)

echo "e2e: waiting for backend (:$BACKEND_PORT) and Metro (:$METRO_PORT)..."
for _ in $(seq 1 90); do
  curl -sf "localhost:$BACKEND_PORT/health" >/dev/null && curl -sf "localhost:$METRO_PORT/status" >/dev/null && break
  sleep 1
done
curl -sf "localhost:$BACKEND_PORT/health" >/dev/null || die "backend didn't come up -- log: $LOG_DIR/backend.log"
curl -sf "localhost:$METRO_PORT/status" >/dev/null || die "Metro didn't come up -- log: $LOG_DIR/metro.log"

# ─── Run ────────────────────────────────────────────────────────────────
SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
DIRTY=""
[ -n "$(git -C "$REPO_DIR" status --porcelain)" ] && DIRTY="-dirty"
REPORT_DIR="$MAESTRO_DIR/reports/$(date +%Y%m%d-%H%M%S)-$SHA$DIRTY"
mkdir -p "$REPORT_DIR"

cd "$MAESTRO_DIR"
START=$SECONDS
./run.sh --format JUNIT --output "$REPORT_DIR/report.xml" "${@:-flows}"
MAESTRO_RC=$?
DURATION=$((SECONDS - START))

# ─── Verify nothing was left on the real map ────────────────────────────
set -a; source .env; set +a
E2E_API_URL="http://localhost:$BACKEND_PORT" node scripts/check-leftovers.mjs
LEFTOVER_RC=$?

RESULT="PASS"
{ [ $MAESTRO_RC -ne 0 ] || [ $LEFTOVER_RC -ne 0 ]; } && RESULT="FAIL"
{
  echo "result:    $RESULT"
  echo "commit:    $SHA${DIRTY:+ (working tree had uncommitted changes)}"
  echo "date:      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "duration:  ${DURATION}s"
  echo "flows:     ${*:-flows}"
  echo "maestro:   exit $MAESTRO_RC, leftover check: exit $LEFTOVER_RC"
  echo "simulator: $(xcrun simctl list devices booted | grep Booted | sed 's/^ *//')"
} | tee "$REPORT_DIR/summary.txt"
echo "e2e: report in ${REPORT_DIR#"$REPO_DIR"/}"

[ "$RESULT" = "PASS" ]
