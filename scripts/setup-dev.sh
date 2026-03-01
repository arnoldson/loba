#!/bin/bash
# One-time setup for Loba dev environment
# Run this from the repo root: ./scripts/setup-dev.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SHELL_RC="$HOME/.zshrc"

# Detect shell
if [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

echo "🔧 Setting up Loba dev environment..."
echo "   Repo: $REPO_DIR"
echo "   Shell config: $SHELL_RC"
echo ""

# Add aliases if not already present
if grep -q "loba-token" "$SHELL_RC" 2>/dev/null; then
  echo "⏭️  Aliases already exist in $SHELL_RC"
else
  cat >> "$SHELL_RC" << EOF

# ─── Loba dev shortcuts ──────────────────────────────────────────
alias loba-token='source $REPO_DIR/scripts/loba-login.sh'
alias loba-backend='cd $REPO_DIR && npm run backend'
alias loba-mobile='cd $REPO_DIR && npm run mobile'
alias loba-seed='curl -X DELETE http://localhost:3000/api/seed && curl -X POST http://localhost:3000/api/seed -d "{\"count\":500}" -H "Content-Type: application/json"'
# ─────────────────────────────────────────────────────────────────
EOF
  echo "✅ Added aliases to $SHELL_RC"
fi

echo ""
echo "Run 'source $SHELL_RC' or open a new terminal, then:"
echo ""
echo "  loba-token    → get a dev auth token (sets \$TOKEN)"
echo "  loba-backend  → start the backend server"
echo "  loba-mobile   → start the mobile app"
echo "  loba-seed     → clear and reseed 500 test posts"