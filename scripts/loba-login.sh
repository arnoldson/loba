#!/bin/bash
# Get a dev auth token for Loba
# Source this script to set $TOKEN automatically:
#   source scripts/loba-login.sh   OR   loba-token (alias)
#
# Usage:
#   loba-token                        # default test user
#   loba-token user@test.dev pass123  # custom credentials

EMAIL="${1:-test@loba.dev}"
PASSWORD="${2:-testpass123}"
API_URL="${LOBA_API_URL:-http://localhost:3000}"

RESPONSE=$(curl -s -X POST "$API_URL/api/dev/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}")

TOKEN=$(echo "$RESPONSE" | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed:"
  echo "$RESPONSE" | jq .
else
  export TOKEN
  echo "✅ TOKEN set (${#TOKEN} chars)"
fi