# 🛠️ Development Setup

## Prerequisites

- Node.js (v20+)
- Xcode (for iOS Simulator)
- jq (`brew install jq`)

## Initial Setup

```bash
# Clone and install
git clone <repo-url> loba
cd loba
npm install

# Set up environment variables
cp apps/backend/.env.example apps/backend/.env
# Edit .env with your Supabase credentials

# Set up dev shortcuts (one-time)
chmod +x scripts/setup-dev.sh scripts/loba-login.sh
./scripts/setup-dev.sh
source ~/.zshrc
```

## Daily Workflow

```bash
# Start backend (terminal 1)
loba-backend

# Start mobile app (terminal 2)
loba-mobile

# Get an auth token (any terminal)
loba-token
# ✅ TOKEN set (xxx chars)

# Seed test data
loba-seed
```

## Available Aliases

After running `setup-dev.sh`:

| Alias          | Description                         |
| -------------- | ----------------------------------- |
| `loba-token`   | Get a dev auth token, sets `$TOKEN` |
| `loba-backend` | Start the backend server            |
| `loba-mobile`  | Start the Expo mobile app           |
| `loba-seed`    | Clear and reseed 500 test posts     |

## Testing API Endpoints

```bash
# Create a post
curl -s -X POST http://localhost:3000/api/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"content": "Test post", "tags": ["test"], "latitude": 37.7895, "longitude": -122.4075}' | jq .

# Upvote a post (must be within 50m)
curl -s -X POST http://localhost:3000/api/posts/POST_ID/react \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reaction": "upvote", "latitude": 37.7895, "longitude": -122.4075}' | jq .
```

## Before Deploying to Production

See [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md).
