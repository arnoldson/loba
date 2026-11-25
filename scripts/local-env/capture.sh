#!/usr/bin/env bash
# Capture the map sequence at one commit (see README.md here).
#
#   scripts/local-env/capture.sh <commit> <simulator-udid> [flow ...]
#   # e.g. capture.sh fa96b71 1FEADD8F-...   (flows default: seoul + arctic)
#
# Starts the commit's worktree backend (:3000) and Metro (:8081) against the
# local stack, runs apps/mobile/.maestro/captures/<flow>.yaml on the given
# simulator, saves screenshots + a pan recording to
# ../loba-captures/output/<commit>/<timestamp>/, and stops both servers.
# The simulator must have the matching dev client: react-native-maps 1.20
# for commits before #95, 1.29 for main.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CAPTURES_DIR="$(cd "$REPO_DIR/.." && pwd)/loba-captures"
FLOWS_DIR="$REPO_DIR/apps/mobile/.maestro/captures"
COMMIT="${1:?usage: capture.sh <commit> <simulator-udid> [flow ...]}"
UDID="${2:?usage: capture.sh <commit> <simulator-udid> [flow ...]}"
shift 2
if [ $# -gt 0 ]; then FLOWS=("$@"); else FLOWS=(seoul arctic); fi
WT="$CAPTURES_DIR/$COMMIT"

die() { echo "capture: $*" >&2; exit 2; }

[ -d "$WT" ] || die "no worktree for $COMMIT -- run scripts/local-env/setup.sh $COMMIT"
supabase status --workdir "$REPO_DIR" >/dev/null 2>&1 || die "local Supabase isn't running -- run scripts/local-env/setup.sh"
if grep -qiE "supabase\.co|railway\.app" "$WT/apps/backend/.env" "$WT/apps/mobile/.env.local"; then
  die "refusing: $WT has env pointing at a hosted service"
fi
[ -e "$WT/apps/mobile/.env" ] && die "refusing: $WT/apps/mobile/.env exists and could override the local setup"
for port in 3000 8081; do
  lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && die "port $port is in use -- stop whatever is running there"
done

OUT="$CAPTURES_DIR/output/$COMMIT/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
LOG_DIR="$OUT/logs"
mkdir -p "$LOG_DIR"

set -m
PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null; done; }
trap cleanup EXIT INT TERM

(cd "$WT/apps/backend" && exec npm run dev) >"$LOG_DIR/backend.log" 2>&1 &
PIDS+=($!)
(cd "$WT/apps/mobile" && EXPO_PUBLIC_CAPTURE=1 exec npx expo start --dev-client --port 8081 --clear) >"$LOG_DIR/metro.log" 2>&1 &
PIDS+=($!)

xcrun simctl boot "$UDID" 2>/dev/null
# Just so you can watch; captures don't need the window.
open -b com.apple.iphonesimulator 2>/dev/null || echo "capture: Simulator app not found -- running without the window"

echo "capture: waiting for backend and Metro ($COMMIT)..."
for _ in $(seq 1 120); do
  curl -sf localhost:3000/health >/dev/null && curl -sf localhost:8081/status >/dev/null && break
  sleep 1
done
curl -sf localhost:3000/health >/dev/null || die "backend didn't come up -- $LOG_DIR/backend.log"
curl -sf localhost:8081/status >/dev/null || die "Metro didn't come up -- $LOG_DIR/metro.log"

RC=0
for flow in "${FLOWS[@]}"; do
  echo "capture: $COMMIT / $flow"
  # A fresh simulator takes a while to install Maestro's driver.
  MAESTRO_DRIVER_STARTUP_TIMEOUT=180000 maestro --device "$UDID" test \
    -e CAPTURE_EMAIL="capture-viewer@loba.local" \
    -e CAPTURE_PASSWORD="local-capture-pass" \
    --test-output-dir "$OUT" --flatten-debug-output \
    --debug-output "$LOG_DIR/maestro-$flow" \
    "$FLOWS_DIR/$flow.yaml" || RC=1
  # Maestro writes takeScreenshot/startRecording output into its debug folder
  # regardless of --test-output-dir; collect the deliverables next to logs/.
  find "$LOG_DIR/maestro-$flow" \( -path "*/takeScreenshot/*.png" -o -path "*/startRecording/*.mp4" \) \
    -exec cp {} "$OUT/" \;
done

echo "capture: $([ $RC -eq 0 ] && echo done || echo 'FINISHED WITH FAILURES (a crash at an old commit is expected; see logs)')"
echo "capture: output in $OUT"
ls "$OUT"
exit $RC
