#!/bin/bash
# scripts/test-location-verification.sh
#
# End-to-end test for #43's server-side location verification:
# staleness/accuracy rejection on createPost/reactToPost/createComment,
# the reaction-bypass path for comments, and the IP-mismatch flag on
# posts. Uses unique throwaway emails per run (timestamp-suffixed) so
# results never collide with previous runs.
#
# Requires: jq, psql, DATABASE_URL set in environment (or apps/backend/.env)
#
# Coordinates below are Apopka, FL -- swap APOPKA_LAT/LNG if you'd
# rather test against wherever you actually are.
#
# Usage:
#   ./scripts/test-location-verification.sh

set -e

API_URL="${LOBA_API_URL:-http://localhost:3000}"
STAMP=$(date +%s)
PASS="testpass123"

APOPKA_LAT=28.6774
APOPKA_LNG=-81.532

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# Load DATABASE_URL from apps/backend/.env if not already set
if [ -z "$DATABASE_URL" ]; then
  export $(grep -v '^#' apps/backend/.env | grep DATABASE_URL | xargs)
fi

# now_ms / stale_ms: whole-second precision (portable across GNU/BSD
# date -- macOS's date has no %3N). Fine here since the thresholds
# we're testing are tens of seconds to minutes, not sub-second.
now_ms() { echo $(( $(date +%s) * 1000 )); }
stale_ms() { echo $(( $(date +%s) * 1000 - 120000 )); } # 2 min old

# post_json URL TOKEN JSON_BODY [EXTRA_HEADER]
# Prints "<status>\n<body>"
post_json() {
  local url="$1" token="$2" body="$3" extra_header="${4:-}"
  local extra_args=()
  [ -n "$extra_header" ] && extra_args=(-H "$extra_header")
  curl -s -w "\n%{http_code}" -X POST "$url" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    "${extra_args[@]}" \
    -d "$body"
}

status_of() { echo "$1" | tail -1; }
body_of() { echo "$1" | sed '$d'; }

echo "── Setup: two throwaway users ──"

EMAIL_A="loctest-a-${STAMP}@loba.dev"
RESP_A=$(curl -s -X POST "$API_URL/api/dev/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL_A\", \"password\": \"$PASS\"}")
TOKEN_A=$(echo "$RESP_A" | jq -r '.token')
[ -n "$TOKEN_A" ] && [ "$TOKEN_A" != "null" ] || fail "Setup: couldn't create/login user A"
pass "Created user A"

EMAIL_B="loctest-b-${STAMP}@loba.dev"
RESP_B=$(curl -s -X POST "$API_URL/api/dev/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL_B\", \"password\": \"$PASS\"}")
TOKEN_B=$(echo "$RESP_B" | jq -r '.token')
[ -n "$TOKEN_B" ] && [ "$TOKEN_B" != "null" ] || fail "Setup: couldn't create/login user B"
pass "Created user B"

echo ""
echo "── Test 1: createPost -- missing location fields ──"

RESP=$(post_json "$API_URL/api/posts" "$TOKEN_A" \
  "{\"content\":\"missing fields\",\"tags\":[],\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG}")
[ "$(status_of "$RESP")" = "400" ] || fail "Expected 400 for missing fields, got $(status_of "$RESP"): $(body_of "$RESP")"
pass "Missing locationAccuracy/locationTimestamp correctly rejected (400)"

echo ""
echo "── Test 2: createPost -- stale timestamp ──"

RESP=$(post_json "$API_URL/api/posts" "$TOKEN_A" \
  "{\"content\":\"stale\",\"tags\":[],\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":10,\"locationTimestamp\":$(stale_ms)}")
[ "$(status_of "$RESP")" = "403" ] || fail "Expected 403 for stale timestamp, got $(status_of "$RESP"): $(body_of "$RESP")"
echo "$(body_of "$RESP")" | jq -e '.error | contains("too old")' > /dev/null || fail "Expected 'too old' in error message"
pass "Stale (2min old) reading correctly rejected (403)"

echo ""
echo "── Test 3: createPost -- inaccurate reading ──"

RESP=$(post_json "$API_URL/api/posts" "$TOKEN_A" \
  "{\"content\":\"inaccurate\",\"tags\":[],\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":5000,\"locationTimestamp\":$(now_ms)}")
[ "$(status_of "$RESP")" = "403" ] || fail "Expected 403 for bad accuracy, got $(status_of "$RESP"): $(body_of "$RESP")"
echo "$(body_of "$RESP")" | jq -e '.error | contains("not accurate enough")' > /dev/null || fail "Expected 'not accurate enough' in error message"
pass "5000m accuracy reading correctly rejected (403)"

echo ""
echo "── Test 4: createPost -- valid reading succeeds, no flag leak ──"

RESP=$(post_json "$API_URL/api/posts" "$TOKEN_A" \
  "{\"content\":\"valid post ${STAMP}\",\"tags\":[],\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":10,\"locationTimestamp\":$(now_ms)}")
[ "$(status_of "$RESP")" = "200" ] || fail "Expected 200 for valid post, got $(status_of "$RESP"): $(body_of "$RESP")"
echo "$(body_of "$RESP")" | jq -e '.success == true' > /dev/null || fail "Expected success: true"
echo "$(body_of "$RESP")" | jq -e 'has("post") and (.post | has("flagged_ip_mismatch") | not)' > /dev/null \
  || fail "flagged_ip_mismatch leaked into the response!"
POST_ID=$(echo "$(body_of "$RESP")" | jq -r '.post.id')
pass "Valid post created ($POST_ID), flagged_ip_mismatch not exposed to client"

echo ""
echo "── Test 5: createPost -- IP mismatch is flagged (not rejected) ──"

RESP=$(post_json "$API_URL/api/posts" "$TOKEN_A" \
  "{\"content\":\"ip mismatch ${STAMP}\",\"tags\":[],\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":10,\"locationTimestamp\":$(now_ms)}" \
  "X-Forwarded-For: 8.8.8.8")
[ "$(status_of "$RESP")" = "200" ] || fail "Expected 200 even on IP mismatch (flag, not reject), got $(status_of "$RESP")"
IP_MISMATCH_POST_ID=$(echo "$(body_of "$RESP")" | jq -r '.post.id')
FLAGGED=$(psql "$DATABASE_URL" -t -A -c "SELECT flagged_ip_mismatch FROM posts WHERE id = '$IP_MISMATCH_POST_ID';")
[ "$FLAGGED" = "t" ] || fail "Expected flagged_ip_mismatch = true for an 8.8.8.8-claimed-Apopka post, got '$FLAGGED'"
pass "Post accepted despite IP mismatch, correctly flagged in DB (invisible to client)"

echo ""
echo "── Test 6: reactToPost -- stale/inaccurate rejected, valid succeeds ──"
echo "(user B reacting to user A's post — can't react to your own)"

RESP=$(post_json "$API_URL/api/posts/$POST_ID/react" "$TOKEN_B" \
  "{\"reaction\":\"upvote\",\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":10,\"locationTimestamp\":$(stale_ms)}")
[ "$(status_of "$RESP")" = "403" ] || fail "Expected 403 for stale reaction, got $(status_of "$RESP"): $(body_of "$RESP")"
pass "Stale reaction correctly rejected (403)"

RESP=$(post_json "$API_URL/api/posts/$POST_ID/react" "$TOKEN_B" \
  "{\"reaction\":\"upvote\",\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":10,\"locationTimestamp\":$(now_ms)}")
[ "$(status_of "$RESP")" = "200" ] || fail "Expected 200 for valid reaction, got $(status_of "$RESP"): $(body_of "$RESP")"
echo "$(body_of "$RESP")" | jq -e '.success == true' > /dev/null || fail "Expected success: true"
pass "Valid reaction succeeded (user B has now upvoted, satisfying the comment bypass below)"

echo ""
echo "── Test 7: createComment -- proximity branch (stale rejected, valid succeeds) ──"
echo "(fresh user C, no prior reaction, so the proximity gate is actually enforced)"

EMAIL_C="loctest-c-${STAMP}@loba.dev"
RESP_C=$(curl -s -X POST "$API_URL/api/dev/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL_C\", \"password\": \"$PASS\"}")
TOKEN_C=$(echo "$RESP_C" | jq -r '.token')
[ -n "$TOKEN_C" ] && [ "$TOKEN_C" != "null" ] || fail "Setup: couldn't create/login user C"

RESP=$(post_json "$API_URL/api/posts/$POST_ID/comments" "$TOKEN_C" \
  "{\"content\":\"stale comment\",\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":10,\"locationTimestamp\":$(stale_ms)}")
[ "$(status_of "$RESP")" = "403" ] || fail "Expected 403 for stale comment, got $(status_of "$RESP"): $(body_of "$RESP")"
pass "Stale comment (no prior reaction) correctly rejected (403)"

RESP=$(post_json "$API_URL/api/posts/$POST_ID/comments" "$TOKEN_C" \
  "{\"content\":\"valid comment ${STAMP}\",\"latitude\":$APOPKA_LAT,\"longitude\":$APOPKA_LNG,\"locationAccuracy\":10,\"locationTimestamp\":$(now_ms)}")
[ "$(status_of "$RESP")" = "201" ] || fail "Expected 201 for valid comment, got $(status_of "$RESP"): $(body_of "$RESP")"
pass "Valid comment succeeded"

echo ""
echo "── Test 8: createComment -- reaction-bypass branch skips the gate entirely ──"
echo "(user B already upvoted in Test 6 — should succeed with NO location fields at all)"

RESP=$(post_json "$API_URL/api/posts/$POST_ID/comments" "$TOKEN_B" \
  "{\"content\":\"bypass comment ${STAMP}\"}")
[ "$(status_of "$RESP")" = "201" ] || fail "Expected 201 for reaction-bypass comment, got $(status_of "$RESP"): $(body_of "$RESP")"
pass "Comment with zero location fields succeeded via prior-reaction bypass, as expected"

echo ""
echo "── Cleanup: deleting the three throwaway test accounts ──"
echo "(DELETE /api/account removes the account's posts/comments/reactions"
echo " AND the auth account itself — not just content, so there's nothing"
echo " left over for cleanup-test-tags.sh, which targets a different,"
echo " fixed dev account and a [SEEDTEST] content prefix that doesn't"
echo " apply here.)"

cleanup_account() {
  local email="$1" token="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/account" \
    -H "Authorization: Bearer $token")
  if [ "$status" = "200" ]; then
    pass "Deleted $email"
  else
    echo -e "${RED}⚠️  Failed to delete $email (HTTP $status) — clean up manually${NC}"
  fi
}

cleanup_account "$EMAIL_A" "$TOKEN_A"
cleanup_account "$EMAIL_B" "$TOKEN_B"
cleanup_account "$EMAIL_C" "$TOKEN_C"

echo ""
echo "🎉 All location verification checks passed, test accounts cleaned up."
