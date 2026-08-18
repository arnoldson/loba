#!/bin/bash
# Delete posts created by seed-test-tags.sh, identified by the
# SEED_PREFIX in their content — without touching any other posts.
#
# Works by fetching every post the dev test user has created
# (GET /api/posts/mine, which includes expired-but-not-archived posts),
# filtering to just the ones starting with SEED_PREFIX, and deleting
# each individually via the normal author-scoped DELETE /api/posts/:id.
#
# Safe to run even if nothing matches — it just reports 0 deletions.
#
# Usage:
#   ./scripts/cleanup-test-tags.sh
#
# Requires:
#   - Local backend running (npm run backend)
#   - jq installed
#   - scripts/loba-login.sh in the same directory (for auth token)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_URL="${LOBA_API_URL:-http://localhost:3000}"

# Must match the prefix used in seed-test-tags.sh.
SEED_PREFIX="[SEEDTEST]"

echo "🔑 Getting auth token..."
source "$SCRIPT_DIR/loba-login.sh"

if [ -z "$TOKEN" ]; then
  echo "❌ No token — aborting."
  exit 1
fi

echo ""
echo "🔍 Fetching posts for this user..."
RESPONSE=$(curl -s "$API_URL/api/posts/mine" -H "Authorization: Bearer $TOKEN")

SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
if [ "$SUCCESS" != "true" ]; then
  echo "❌ Failed to fetch posts: $RESPONSE"
  exit 1
fi

# Filter to posts whose content starts with SEED_PREFIX
IDS=$(echo "$RESPONSE" | jq -r --arg prefix "$SEED_PREFIX" \
  '.posts[] | select(.content | startswith($prefix)) | .id')

if [ -z "$IDS" ]; then
  echo "✅ No posts matching \"$SEED_PREFIX\" found — nothing to clean up."
  exit 0
fi

COUNT=$(echo "$IDS" | wc -l | tr -d ' ')
echo "🧹 Found $COUNT post(s) matching \"$SEED_PREFIX\" — deleting..."

while IFS= read -r id; do
  [ -z "$id" ] && continue
  status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/posts/$id" \
    -H "Authorization: Bearer $TOKEN")
  if [ "$status" == "200" ]; then
    echo "  ✅ deleted $id"
  else
    echo "  ⚠️  failed to delete $id (HTTP $status)"
  fi
done <<< "$IDS"

echo ""
echo "✅ Cleanup complete."