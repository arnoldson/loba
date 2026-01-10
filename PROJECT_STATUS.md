# Loba Project Status

**Last Updated:** January 10, 2026

## Project Overview

Location-based social media app where users create posts tied to specific 3m×3m geographic tiles.

## Tech Stack

- **Frontend:** React Native, Expo, TypeScript
- **Backend:** Fastify, Kysely (type-safe SQL), node-postgres
- **Database:** PostgreSQL (Supabase)
- **Architecture:** Monorepo with npm workspaces
- **Shared Types:** @loba/shared package

## Current Features ✅

### Core Functionality

- ✅ Post creation at current GPS location
- ✅ Automatic tile_id calculation (3m × 3m tiles)
- ✅ Posts stored in Supabase with tile_id, tags, content
- ✅ Backend API with type-safe queries

### Map Display (Just Completed!)

- ✅ Fetch posts in 303m radius around user location
- ✅ Dynamic zoom-based grouping (1→2→4→8→16)
- ✅ Colored markers by count (🟢→🔵→🟡→🟠→🔴)
- ✅ Tap markers to view all posts in tile/group
- ✅ Bottom sheet modal with post details
- ✅ Scale indicators on grouped markers (×2, ×4, etc.)

### Database Seeding

- ✅ POST /api/seed: Generate test posts
- ✅ DELETE /api/seed: Clear database
- ✅ GET /api/seed/stats: View distribution
- ✅ Realistic clustering patterns

## Known Issues ⚠️

### High Priority

1. **Overlapping markers** - Fetching 10,201 tiles (303m radius) causes too many markers
2. **No dynamic fetch** - Only fetches on app load, not when panning map
3. **Performance** - Large fetch area impacts performance

### Medium Priority

- No user authentication yet
- No photo upload capability
- No comments/replies
- Backend not deployed

## File Structure

```
loba/
├── apps/
│   ├── mobile/                    # React Native app
│   │   ├── app/(tabs)/
│   │   │   └── index.tsx         # Main map screen with post display
│   │   ├── components/
│   │   │   ├── TileMarker.tsx    # Colored circular markers
│   │   │   └── TileDetailsModal.tsx  # Post list modal
│   │   └── utils/
│   │       ├── tiles.ts          # Tile calculations & grouping
│   │       └── postGrouping.ts   # SuperTile logic
│   └── backend/                   # Fastify API
│       └── src/
│           ├── routes/
│           │   ├── posts.ts      # Post CRUD endpoints
│           │   └── seed.ts       # Database seeding (NEW)
│           ├── services/
│           │   └── posts.ts      # Business logic
│           └── db/
│               ├── index.ts      # Kysely connection
│               └── tiles.ts      # Tile helpers
├── packages/
│   └── shared/
│       └── src/
│           └── index.ts          # Shared TypeScript types
└── package.json                   # Root workspace config
```

## API Endpoints

### Posts

- `POST /api/posts` - Create post
- `POST /api/posts/by-tiles` - Get posts by tile_ids
- `GET /api/posts/:id` - Get single post
- `GET /health` - Health check

### Seeding (Dev Only)

- `POST /api/seed` - Generate test posts
- `DELETE /api/seed` - Clear all posts
- `GET /api/seed/stats` - View distribution

## Configuration

### Environment Variables

```bash
# apps/backend/.env
DATABASE_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres
```

### API URLs (Mobile)

```typescript
const API_URL = Platform.select({
  ios: "http://localhost:3000", // iOS Simulator
  android: "http://10.0.2.2:3000", // Android Emulator
});
```

### Current Fetch Settings

```typescript
const tileIds = getTileRange(lat, lng, 50); // 101×101 tiles = 303m
```

## Zoom-Based Grouping Logic

```
Zoom 19-20: grouping = 1   → 3m × 3m (atomic)
Zoom 17-18: grouping = 2   → 6m × 6m (2×2)
Zoom 15-16: grouping = 4   → 12m × 12m (4×4)
Zoom 13-14: grouping = 8   → 24m × 24m (8×8)
Zoom 11-12: grouping = 16  → 48m × 48m (16×16)
Zoom < 11:  no markers     → Too zoomed out
```

## Next Steps (Prioritized)

### Immediate

1. **Fix overlapping markers**

   - Option A: Reduce fetch radius (quick fix)
   - Option B: Implement fetch on map pan (better UX)
   - Option C: Use clustering library

2. **Fetch on map pan**
   - Debounce map movement (300ms)
   - Calculate visible bounds
   - Fetch only visible tiles
   - Update markers dynamically

### Short Term

3. Add pull-to-refresh
4. Loading indicators
5. Error handling improvements
6. Cache fetched posts

### Medium Term

7. User authentication (Supabase Auth)
8. Photo upload (Supabase Storage)
9. Comments/replies system
10. Deploy backend to production

### Long Term

11. Real-time updates (Supabase Realtime)
12. Push notifications
13. User profiles
14. Post moderation

## Development Workflow

### Start Development

```bash
# Terminal 1: Backend
cd loba
npm run backend

# Terminal 2: Mobile
cd loba
npm run mobile
```

### Test with Seed Data

```bash
# Clear and reseed
curl -X DELETE http://localhost:3000/api/seed
curl -X POST http://localhost:3000/api/seed -H "Content-Type: application/json" -d '{"count": 500}'
```

### Commit Changes

```bash
git add .
git commit -m "Description"
git push origin main
```

## Key Decisions & Learnings

### Architecture Decisions

- ✅ TypeScript full-stack for shared types
- ✅ Monorepo for code sharing
- ✅ Backend handles business logic (tile calculation)
- ✅ Kysely for type-safe SQL (no code generation)
- ✅ Transaction pooler for public WiFi compatibility

### Performance Learnings

- ❌ Don't render 225 tile boundary polygons (crashes)
- ✅ Group tiles into supertiles based on zoom
- ✅ Use single marker per tile/group
- ⚠️ Large fetch radius causes overlapping (needs optimization)

### Development Learnings

- ES module import hoisting requires .env in each file
- Public WiFi blocks port 5432, use 6543 (transaction pooler)
- React Native Marker needs `tracksViewChanges={false}` for performance

## Recent Session Summary

**Session Date:** January 9-10, 2026

**What We Built:**

1. Post display system with dynamic zoom-based grouping
2. Colored markers indicating post density
3. Tap-to-view post details modal
4. Database seeding system for testing
5. Comprehensive documentation

**Key Files Modified:**

- `apps/mobile/app/(tabs)/index.tsx` - Added post fetching & display
- `apps/mobile/components/TileMarker.tsx` - Created marker component
- `apps/mobile/components/TileDetailsModal.tsx` - Created details modal
- `apps/mobile/utils/tiles.ts` - Created tile utilities
- `apps/mobile/utils/postGrouping.ts` - Created grouping logic
- `apps/backend/src/routes/seed.ts` - Created seed endpoints

**Current Issue:**
Too many overlapping markers because fetch radius (303m) is very large. Need to either reduce radius or implement dynamic fetch based on visible map area.

**Next Action:**
Implement "fetch on map pan" to only load posts in visible area, solving the overlapping issue naturally.
