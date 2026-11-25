#!/usr/bin/env bash
# Offline local environment for running old commits (see README.md here).
#
#   scripts/local-env/setup.sh [commit ...]   # default: 726dd22 fa96b71 main
#
# Starts the local Supabase stack (supabase/config.toml, ports 553xx), creates
# a git worktree per commit under ../loba-captures/<commit>, writes local-only
# env files into each (backend .env, mobile .env.local), installs
# dependencies, and creates two local test accounts. Safe to re-run: existing
# worktrees and accounts are kept.
#
# Never touches the live Supabase project or Railway: every env value it
# writes comes from `supabase status`, and it aborts if any of them points
# anywhere but this machine.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CAPTURES_DIR="$(cd "$REPO_DIR/.." && pwd)/loba-captures"
if [ $# -gt 0 ]; then COMMITS=("$@"); else COMMITS=(726dd22 fa96b71 main); fi

# Local-only accounts on the local stack; nothing secret about them.
AUTHOR_EMAIL="capture-author@loba.local"
VIEWER_EMAIL="capture-viewer@loba.local"
LOCAL_PASSWORD="local-capture-pass"

die() { echo "local-env: $*" >&2; exit 1; }

cd "$REPO_DIR"

# ─── Local Supabase ───────────────────────────────────────────────────
command -v supabase >/dev/null || die "supabase CLI not installed"
if ! supabase status >/dev/null 2>&1; then
  echo "local-env: starting local Supabase (first run pulls images)..."
  supabase start >/dev/null
fi
eval "$(supabase status -o env | grep -E '^(API_URL|DB_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"

for value in "$API_URL" "$DB_URL"; do
  case "$value" in
    http://127.0.0.1:*|postgresql://*@127.0.0.1:*) ;;
    *) die "refusing: '$value' isn't local" ;;
  esac
done

# ─── Worktrees + env files ────────────────────────────────────────────
mkdir -p "$CAPTURES_DIR"
for commit in "${COMMITS[@]}"; do
  wt="$CAPTURES_DIR/$commit"
  if [ ! -d "$wt" ]; then
    echo "local-env: worktree $commit -> $wt"
    git worktree add --detach "$wt" "$commit" >/dev/null
  fi

  # The worktree never gets the live apps/*/.env files (they're gitignored),
  # so these are the only env files it sees. API URL is deliberately unset:
  # the app then falls back to http://localhost:3000 (utils/api.ts).
  cat > "$wt/apps/backend/.env" <<EOF
DATABASE_URL=$DB_URL
PORT=3000
NODE_ENV=development
SUPABASE_URL=$API_URL
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
EOF
  cat > "$wt/apps/mobile/.env.local" <<EOF
EXPO_PUBLIC_SUPABASE_URL=$API_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
EOF
  if grep -qiE "supabase\.co|railway\.app" "$wt/apps/backend/.env" "$wt/apps/mobile/.env.local"; then
    die "refusing: an env file in $wt points at a hosted service"
  fi
  if [ -e "$wt/apps/mobile/.env" ] || grep -q "EXPO_PUBLIC_API_URL" "$wt/apps/mobile/.env.local"; then
    die "refusing: $wt/apps/mobile has an env file that could override the local setup"
  fi

  # Worktree-only patch (never committed): hide LogBox's warning banner when
  # Metro runs with EXPO_PUBLIC_CAPTURE=1, so screenshots are clean and the
  # banner can't swallow taps. Old commits have no such switch, and main's
  # (EXPO_PUBLIC_E2E) would also draw the E2E readout into the captures.
  layout="$wt/apps/mobile/app/_layout.tsx"
  if ! grep -q "local-env capture patch" "$layout"; then
    cat >> "$layout" <<'EOF'

// local-env capture patch (worktree only, see scripts/local-env/setup.sh)
import { LogBox as CaptureLogBox } from "react-native"
if (process.env.EXPO_PUBLIC_CAPTURE === "1") CaptureLogBox.ignoreAllLogs()
EOF
  fi

  # Worktree-only patch (never committed), pre-#63 commits like 726dd22:
  # their dev grid outline draws the whole grid rectangle and skips it above
  # 500 cells -- and at 80°N, where pre-#63 cells are ~5x too narrow, the
  # launch view alone is ~48x47 cells. Raise the cap so the narrow cells
  # (#60) can actually be seen and captured.
  map_screen="$wt/apps/mobile/app/(tabs)/index.tsx"
  if grep -q "gridWidth \* gridHeight > 500) {" "$map_screen"; then
    sed -i '' 's|gridWidth \* gridHeight > 500) {|gridWidth * gridHeight > 5000) { // local-env capture patch: was 500|' "$map_screen"
  fi

  if [ ! -d "$wt/node_modules" ]; then
    echo "local-env: npm install in $commit (a few minutes)..."
    (cd "$wt" && npm install --no-audit --no-fund >/dev/null)
  fi
done

# ─── Local test accounts ──────────────────────────────────────────────
create_user() {
  local email="$1" status
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$LOCAL_PASSWORD\",\"email_confirm\":true}")
  case "$status" in
    200|201) echo "local-env: created $email" ;;
    422) ;; # already exists
    *) die "creating $email failed (HTTP $status)" ;;
  esac
}
create_user "$AUTHOR_EMAIL"
create_user "$VIEWER_EMAIL"

cat <<EOF

local-env: ready.
  Supabase API  $API_URL   (Studio: supabase status)
  Worktrees     $CAPTURES_DIR/{$(IFS=,; echo "${COMMITS[*]}")}
  Accounts      $AUTHOR_EMAIL / $VIEWER_EMAIL, password $LOCAL_PASSWORD
Next: scripts/local-env/README.md
EOF
