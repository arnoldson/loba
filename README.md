# Loba - Location-Based Social App

Monorepo for the Loba mobile app and backend API.

## Project Structure

```
loba/
├── apps/
│   ├── mobile/          # React Native mobile app (Expo)
│   └── backend/         # TypeScript backend API (Fastify + Kysely)
├── packages/
│   └── shared/          # Shared TypeScript types
└── package.json         # Root package with workspaces
```

## Setup

### Prerequisites
- Node.js 18+ 
- npm 9+
- Supabase account with PostgreSQL database

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up backend environment:
```bash
cd apps/backend
cp .env.example .env
# Edit .env and add your Supabase DATABASE_URL
```

3. Get your Supabase connection string:
- Go to your Supabase project settings
- Navigate to Database → Connection String → URI
- Copy the connection string (should look like: `postgresql://postgres:[PASSWORD]@db.[PROJECT-ID].supabase.co:5432/postgres`)
- Replace `[PASSWORD]` with your database password

### Running the Backend

From the root directory:
```bash
npm run backend
```

Or from the backend directory:
```bash
cd apps/backend
npm run dev
```

The API will start on http://localhost:3000

### API Endpoints

- `GET /health` - Health check
- `POST /api/posts` - Create a new post
- `POST /api/posts/by-tiles` - Get posts by tile IDs
- `GET /api/posts/:id` - Get a single post

### Testing the API

Create a post:
```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello from the backend!",
    "tags": ["test", "backend"],
    "latitude": 37.7749,
    "longitude": -122.4194
  }'
```

### Shared Types

All API request/response types are defined in `packages/shared/src/index.ts` and shared between frontend and backend for type safety.

## Development

### Backend Development
```bash
npm run backend        # Start dev server with hot reload
npm run backend:build  # Build for production
```

### Type Checking
```bash
cd packages/shared
npm run type-check
```

## Tech Stack

- **Backend**: Fastify, Kysely, PostgreSQL (Supabase)
- **Mobile**: React Native (Expo)
- **Shared**: TypeScript
- **Database**: PostgreSQL with PostGIS
