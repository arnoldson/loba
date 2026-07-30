#!/bin/bash
# scripts/test-account-deletion.sh
#
# End-to-end test for account deletion. Uses unique throwaway emails per
# run (timestamp-suffixed) so results never collide with previous runs or
# get confused by /api/dev/login's auto-recreate-on-failed-login behavior.
#
# Requires: jq, psql, DATABASE_URL set in environment (or apps/backend/.env)
#
# Usage:
#   ./scripts/test-account-deletion.sh

set -e

API_URL="${LOBA_API_URL:-http://localhost:3000}"
STAMP=$(date +%s)
PASS="testpass123"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# Load DATABASE_URL from apps/backend/.env if not already set
if [ -z "$DATABASE_URL" ]; then
  export $(grep -v '^#' apps/backend/.env | grep DATABASE_URL | xargs)
fi

echo "── Test 1: Basic deletion + token invalidation ──"

EMAIL_A="deltest-a-${STAMP}@loba.dev"
RESPONSE=$(curl -s -X POST "$API_URL/api/dev/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL_A\", \"password\": \"$PASS\"}")

TOKEN_A=$(echo "$RESPONSE" | jq -r '.token')
UID_A=$(echo "$RESPONSE" | jq -r '.user_id')
[ -n "$TOKEN_A" ] && [ "$TOKEN_A" != "null" ] || fail "Setup: couldn't create/login user A"
pass "Created user A ($UID_A)"

# Sanity check: token works before deletion
ME_BEFORE=$(curl -s "$API_URL/api/dev/me" -H "Authorization: Bearer $TOKEN_A")
echo "$ME_BEFORE" | jq -e '.success == true' > /dev/null || fail "Token didn't work before deletion"
pass "Token valid before deletion"

# Delete the account
DELETE_RESPONSE=$(curl -s -X DELETE "$API_URL/api/account" -H "Authorization: Bearer $TOKEN_A")
echo "$DELETE_RESPONSE" | jq -e '.success == true' > /dev/null || fail "Delete call failed: $DELETE_RESPONSE"
pass "Delete call returned success"

# Reuse the SAME token — this is the real proof, not re-logging in
ME_AFTER=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/dev/me" -H "Authorization: Bearer $TOKEN_A")
[ "$ME_AFTER" = "401" ] || fail "Expected 401 reusing old token, got $ME_AFTER — account may not actually be deleted"
pass "Old token correctly rejected (401) — account genuinely deleted"

# Confirm re-login creates a DIFFERENT user_id (proves it's a new account, not survival)
RELOGIN=$(curl -s -X POST "$API_URL/api/dev/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL_A\", \"password\": \"$PASS\"}")
UID_A_NEW=$(echo "$RELOGIN" | jq -r '.user_id')
[ "$UID_A_NEW" != "$UID_A" ] || fail "Re-login returned the SAME user_id — deletion didn't actually happen"
pass "Re-login created a distinct new account ($UID_A_NEW != $UID_A)"

echo ""
echo "── Test 2: Content preservation (posts/comments/reactions) ──"

EMAIL_B="deltest-b-${STAMP}@loba.dev"
RESPONSE_B=$(curl -s -X POST "$API_URL/api/dev/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL_B\", \"password\": \"$PASS\"}")
TOKEN_B=$(echo "$RESPONSE_B" | jq -r '.token')
UID_B=$(echo "$RESPONSE_B" | jq -r '.user_id')
pass "Created user B ($UID_B)"

# User A (new post-deletion account) creates a post
POST_RESPONSE=$(curl -s -X POST "$API_URL/api/posts" \
  -H "Authorization: Bearer $(echo "$RELOGIN" | jq -r '.token')" \
  -H "Content-Type: application/json" \
  -d '{"content": "account-deletion test post", "latitude": 37.7858, "longitude": -122.4064, "tags": []}')
POST_ID=$(echo "$POST_RESPONSE" | jq -r '.id // .post.id')
[ -n "$POST_ID" ] && [ "$POST_ID" != "null" ] || fail "Couldn't create test post: $POST_RESPONSE"
pass "User A created post ($POST_ID)"

# User B comments and upvotes it
curl -s -X POST "$API_URL/api/posts/$POST_ID/comments" \
  -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: application/json" \
  -d '{"content": "test comment from B", "latitude": 37.7858, "longitude": -122.4064}' > /dev/null
curl -s -X POST "$API_URL/api/posts/$POST_ID/react" \
  -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: application/json" \
  -d '{"reaction": "upvote", "latitude": 37.7858, "longitude": -122.4064}' > /dev/null
pass "User B commented and upvoted"

UPVOTES_BEFORE=$(psql "$DATABASE_URL" -t -A -c "SELECT upvote_count FROM posts WHERE id = '$POST_ID';")

# Delete user A's account (the post author)
curl -s -X DELETE "$API_URL/api/account" -H "Authorization: Bearer $(echo "$RELOGIN" | jq -r '.token')" > /dev/null
pass "Deleted user A (post author)"

SENTINEL_CHECK=$(psql "$DATABASE_URL" -t -A -c "SELECT user_id FROM posts WHERE id = '$POST_ID';")
DELETED_USER_ID=$(grep -v '^#' apps/backend/.env | grep DELETED_USER_ID | cut -d '=' -f2)
[ "$SENTINEL_CHECK" = "$DELETED_USER_ID" ] || fail "Post's user_id ($SENTINEL_CHECK) doesn't match sentinel ($DELETED_USER_ID)"
pass "Post reassigned to sentinel account, still exists"

COMMENT_STILL_THERE=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM comments WHERE post_id = '$POST_ID' AND user_id = '$UID_B';")
[ "$COMMENT_STILL_THERE" = "1" ] || fail "User B's comment disappeared or changed unexpectedly"
pass "User B's comment untouched (author's deletion didn't affect it)"

# Now delete user B too — tests reaction cleanup + count preservation
curl -s -X DELETE "$API_URL/api/account" -H "Authorization: Bearer $TOKEN_B" > /dev/null
pass "Deleted user B (commenter/voter)"

REACTION_GONE=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM post_reactions WHERE post_id = '$POST_ID' AND user_id = '$UID_B';")
[ "$REACTION_GONE" = "0" ] || fail "User B's reaction row still exists after deletion"
pass "User B's reaction row cleaned up (cascaded)"

UPVOTES_AFTER=$(psql "$DATABASE_URL" -t -A -c "SELECT upvote_count FROM posts WHERE id = '$POST_ID';")
[ "$UPVOTES_AFTER" = "$UPVOTES_BEFORE" ] || fail "Vote count changed after deletion (was $UPVOTES_BEFORE, now $UPVOTES_AFTER) — count should be untouched"
pass "Vote count preserved ($UPVOTES_AFTER, unchanged)"

COMMENT_REASSIGNED=$(psql "$DATABASE_URL" -t -A -c "SELECT user_id FROM comments WHERE post_id = '$POST_ID' AND user_id = '$DELETED_USER_ID';")
[ "$COMMENT_REASSIGNED" = "$DELETED_USER_ID" ] || fail "User B's comment wasn't reassigned to sentinel after their deletion"
pass "User B's comment reassigned to sentinel after their own deletion"

echo ""
echo "── Test 3: Double-delete / replay guard ──"

REPLAY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/account" -H "Authorization: Bearer $TOKEN_B")
[ "$REPLAY_STATUS" = "401" ] || fail "Expected 401 replaying an already-used token, got $REPLAY_STATUS"
pass "Replay with already-deleted token correctly rejected (401)"

echo ""
echo -e "${GREEN}All account deletion tests passed.${NC}"