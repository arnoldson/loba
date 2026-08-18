#!/bin/bash
# Seed tagged posts across two clusters within San Francisco, ~1.6km
# apart, for testing TagFilterBar viewport scoping.
#
# Distance is intentionally modest rather than city-spanning: markers
# only render at zoom >= 13 (see fetchVisiblePosts in index.tsx — a
# stricter cutoff than getGroupingFactor's own zoom >= 11 floor; tracked
# separately as issue #38). At zoom 13 the viewport spans roughly ~4.9km,
# so 1.6km apart comfortably fits both clusters together once you zoom
# out to city-block scale, while your default/initial zoom (~16, ~550m
# viewport) keeps them separate — giving you an actual zoom in/out
# transition to observe without running into #38's marker-hiding cutoff.
#
# Also seeds #food and #coffee tags across both clusters (in addition to
# #test) so you can confirm the tag bar shows multiple distinct tags
# with correct counts, and that selecting one actually filters to just
# that tag's posts rather than everything.
#
# Every post's content is prefixed with SEED_PREFIX (see below) so it
# can be identified and removed later with cleanup-test-tags.sh, without
# touching any other posts in the database.
#
# Usage:
#   ./scripts/seed-test-tags.sh                        # seed with defaults
#   ./scripts/seed-test-tags.sh LAT_A LNG_A LAT_B LNG_B # seed at custom coords
#
# Requires:
#   - Local backend running (npm run backend)
#   - jq installed
#   - scripts/loba-login.sh in the same directory (for auth token)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_URL="${LOBA_API_URL:-http://localhost:3000}"

# Unique prefix identifying posts created by this script. Must match
# the prefix used in cleanup-test-tags.sh.
SEED_PREFIX="[SEEDTEST]"

echo "🔑 Getting auth token..."
source "$SCRIPT_DIR/loba-login.sh"

if [ -z "$TOKEN" ]; then
  echo "❌ No token — aborting."
  exit 1
fi

# Cluster A: Union Square area, downtown SF
CLUSTER_A_LAT="${1:-37.7855}"
CLUSTER_A_LNG="${2:--122.4064}"

# Cluster B: SOMA, ~1.6km from Cluster A
CLUSTER_B_LAT="${3:-37.7749}"
CLUSTER_B_LNG="${4:--122.4194}"

post() {
  local lat=$1 lng=$2 tag=$3 content=$4
  local response
  response=$(curl -s -X POST "$API_URL/api/posts" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"content\":\"$SEED_PREFIX $content\",\"tags\":[\"$tag\"],\"latitude\":$lat,\"longitude\":$lng}")

  local id
  id=$(echo "$response" | jq -r '.post.id // empty')

  if [ -z "$id" ]; then
    echo "  ⚠️  failed to create post: $response"
  else
    echo "$response" | jq -c '{id: .post.id, tag: .post.tags, lat: .post.latitude, lng: .post.longitude}'
  fi
}

echo ""
echo "📍 Seeding Cluster A — Union Square ($CLUSTER_A_LAT, $CLUSTER_A_LNG)..."
post "$CLUSTER_A_LAT" "$CLUSTER_A_LNG" "#test" "cluster A test post 1"
post "$(echo "$CLUSTER_A_LAT + 0.0005" | bc)" "$(echo "$CLUSTER_A_LNG + 0.0005" | bc)" "#test" "cluster A test post 2"
post "$(echo "$CLUSTER_A_LAT - 0.0007" | bc)" "$(echo "$CLUSTER_A_LNG + 0.0004" | bc)" "#food" "cluster A food post"
post "$(echo "$CLUSTER_A_LAT + 0.0003" | bc)" "$(echo "$CLUSTER_A_LNG - 0.0006" | bc)" "#coffee" "cluster A coffee post"

echo ""
echo "📍 Seeding Cluster B — SOMA ($CLUSTER_B_LAT, $CLUSTER_B_LNG)..."
post "$CLUSTER_B_LAT" "$CLUSTER_B_LNG" "#test" "cluster B test post 1"
post "$(echo "$CLUSTER_B_LAT + 0.0005" | bc)" "$(echo "$CLUSTER_B_LNG - 0.0005" | bc)" "#food" "cluster B food post"
post "$(echo "$CLUSTER_B_LAT - 0.0004" | bc)" "$(echo "$CLUSTER_B_LNG + 0.0006" | bc)" "#coffee" "cluster B coffee post"

echo ""
echo "✅ Verifying — SF-wide view (should show #test:3, #food:2, #coffee:2):"
curl -s "$API_URL/api/tags/popular?minLat=37.70&maxLat=37.83&minLng=-122.53&maxLng=-122.35&limit=20" | jq .

echo ""
echo "To test zoom in/out behavior:"
echo "  1. Set sim location to Cluster A: $CLUSTER_A_LAT, $CLUSTER_A_LNG"
echo "     (Features > Location > Custom Location)"
echo "  2. Reload the app at default zoom — tag bar should only reflect"
echo "     Cluster A's posts (#test, #food, #coffee each count 1-2)"
echo "  3. Zoom out toward city-block scale (stay >= zoom 13 to avoid #38's"
echo "     marker-hiding cutoff) — counts should grow as Cluster B enters view"
echo ""
echo "To test tag filtering itself:"
echo "  - Tap #food in the bar — map should only show food-tagged posts"
echo "  - Tap #coffee — only coffee-tagged posts"
echo "  - Tap Clear — all posts return"
echo ""
echo "🧹 When done testing, clean up with:"
echo "   ./scripts/cleanup-test-tags.sh"