# Loba Project Status

**Last Updated:** August 1, 2026

## Project Overview

Loba is a hyperlocal, anonymous social posting app for proximity-based content discovery (construction updates, trail sightings, unlisted local info). It's pull-based by design — users navigate a map to discover content rather than receiving a push feed — and anonymity is deliberate: it removes influencer incentive structures, and physical proximity requirements filter bots and fake engagement.

Posts are anchored to 3m×3m geographic tiles, displayed on an interactive map with zoom-adaptive SuperTile grouping.

## Tech Stack

- **Frontend:** React Native, Expo, TypeScript
- **Backend:** Fastify, Kysely (type-safe SQL), node-postgres
- **Database:** PostgreSQL + PostGIS (Supabase)
- **Auth:** Supabase Auth, JWT-based
- **Architecture:** Monorepo with npm workspaces (`apps/backend`, `apps/mobile`, `packages/shared`)

## Current Features ✅

### Core Functionality

- ✅ Post creation at current GPS location, automatic tile_id calculation
- ✅ PostGIS spatial indexing (GIST/R-tree) with bounding-box queries — replaced the original `tile_id = ANY(array)` approach
- ✅ TTL-based post expiry (24hr default, +2hr per upvote, capped at 7 days)
- ✅ Archive/hard-delete jobs run via `pg_cron` in Postgres (migrated off the original `setInterval` job)

### Auth & Identity

- ✅ Supabase Auth (email/password)
- ✅ Anonymous per-post display names (deterministic hash of `user_id + post_id`)
- ✅ In-app account deletion — reassigns the user's posts/comments to a `[deleted]` sentinel account (content stays visible, ownership link is severed), two-step confirmation UI in Settings

### Engagement

- ✅ Upvote/downvote, gated to within 50m of the post, self-vote prevented
- ✅ Comments, gated to within 50m OR a prior reaction on that post; 500-char limit
- ✅ Comment/post deletion (author-only)
- ✅ Tag filtering (`TagFilterBar`)
- ✅ "My Posts" screen

### Map Display

- ✅ Fetch posts based on visible map bounds, debounced on pan stop (replaced the original large-radius fetch-on-load approach)
- ✅ Dynamic zoom-based grouping (1→2→4→8→16), colored markers by density
- ✅ Tap markers → bottom sheet modal with post list
- ✅ LRU cache (50 regions, 5-min TTL, ~11m precision)
- ✅ Error boundaries around `MapView` and `TileDetailsModal` — a render crash in one no longer takes down the whole screen; `DevCrashButton` (`__DEV__`-gated) exists for manually testing this

### Dev Tooling & CI

- ✅ Dev-only routes (`/db-test`, `/debug/posts`, dev-auth, `/api/seed`) gated behind `NODE_ENV !== "production"`
- ✅ CI workflow (`dev-route-safety.yml`) — static analysis + live-boot check asserting dev routes 404 in prod
- ✅ Pre-commit hook diffing the live route table against a committed snapshot
- ✅ `keep-alive.yml` workflow

## Known Issues ⚠️

### App Store Blockers (open)

1. **No moderation** — no report/block functionality anywhere in the codebase yet (Guideline 1.2)
2. **Privacy Policy / Terms of Service not hosted** — `docs/privacy.html` and `docs/terms.html` are drafted but there's no GitHub Pages/hosting workflow set up to serve them publicly yet
3. **Apple Developer Program + App Store Connect** — setup not yet started
4. **Backend not deployed to production**

### Medium Priority

- No photo upload capability
- No real-time updates (must refetch to see new posts)
- No push notifications
- No user profiles screen
- Minimal automated test coverage (no functional/E2E tests)
- No retry logic for failed API requests

## File Structure

```
loba/
├── apps/
│   ├── mobile/                          # React Native app (Expo)
│   │   ├── app/
│   │   │   ├── login.tsx
│   │   │   └── (tabs)/
│   │   │       ├── index.tsx           # Main map screen ⭐
│   │   │       ├── my-posts.tsx
│   │   │       └── settings.tsx        # Logout, account deletion
│   │   ├── components/
│   │   │   ├── TileMarker.tsx
│   │   │   ├── TileDetailsModal.tsx
│   │   │   ├── CreatePostModal.tsx
│   │   │   ├── TagFilterBar.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── DevCrashButton.tsx
│   │   └── utils/
│   │       ├── tiles.ts
│   │       ├── postGrouping.ts
│   │       ├── mapBounds.ts
│   │       ├── auth.tsx
│   │       ├── supabase.ts
│   │       └── diagnostics.ts
│   │
│   └── backend/                         # Fastify API
│       └── src/
│           ├── index.ts                # Server entry, route registration
│           ├── middleware/auth.ts
│           ├── routes/
│           │   ├── posts.ts
│           │   ├── posts-spatial.ts
│           │   ├── comments.ts
│           │   ├── reactions.ts
│           │   ├── account.ts
│           │   ├── dev-auth.ts         # Dev-only
│           │   └── seed.ts             # Dev-only
│           ├── services/
│           │   ├── posts.ts
│           │   ├── comments.ts
│           │   └── account.ts
│           ├── utils/
│           │   ├── displayName.ts
│           │   └── proximity.ts
│           └── db/
│               ├── index.ts            # Kysely connection
│               └── tiles.ts
│
├── packages/shared/                     # Shared TypeScript types
├── scripts/                              # CI + dev tooling (route checks, seeding, account-deletion test)
├── docs/                                 # DEV_SETUP.md, PRODUCTION_CHECKLIST.md, privacy.html, terms.html
└── package.json
```

## API Endpoints

### Posts

- `POST /api/posts` — Create post
- `GET /api/posts/:id` — Get single post
- `GET /api/posts/in-bounds` — Bounding-box spatial query

### Comments

- `GET /api/posts/:postId/comments`
- `POST /api/posts/:postId/comments`
- `DELETE /api/posts/:postId/comments/:commentId`

### Reactions

- `POST /api/posts/:id/react` — Toggle upvote/downvote

### Account

- `DELETE /api/account` — Delete own account (requires auth)

### Dev Only (gated behind `NODE_ENV !== "production"`)

- `POST /api/seed`, `DELETE /api/seed`, `GET /api/seed/stats`
- `GET /db-test`, `GET /debug/posts`
- Dev auth routes

### Misc

- `GET /health`

## Configuration

### Environment Variables

```bash
# apps/backend/.env
DATABASE_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres
```

Use port **6543** (transaction pooler) — public WiFi blocks 5432.

### API URLs (Mobile)

```typescript
const API_URL = Platform.select({
  ios: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
})
```

## Zoom-Based Grouping Logic

```
Zoom 19-20: grouping = 1   → 3m × 3m (atomic)
Zoom 17-18: grouping = 2   → 6m × 6m
Zoom 15-16: grouping = 4   → 12m × 12m
Zoom 13-14: grouping = 8   → 24m × 24m
Zoom 11-12: grouping = 16  → 48m × 48m
Zoom < 11:  no markers     → too zoomed out
```

## Next Steps (Prioritized)

### Immediate — App Store Release Blockers

1. Minimal UGC moderation flow (report + block)
2. Host Privacy Policy + Terms of Service (files exist, need public hosting)
3. Apple Developer Program + App Store Connect setup
4. Deploy backend to production

### Short/Medium Term

5. Add functional/E2E test coverage
6. Add retry logic for failed API requests
7. Photo upload (Cloudflare R2 preferred — zero egress fees matter given the map-pan-triggered fetch pattern)
8. Add error/alerting for the pg_cron archive + hard-delete jobs

### Long Term

9. Real-time updates (Supabase Realtime)
10. Push notifications
11. User profiles
12. Android testing
13. More robust TTL-extension algorithm

## Key Decisions & Learnings

### Architecture Decisions

- TypeScript full-stack with shared types (`@loba/shared`) — catches frontend/backend contract mismatches at compile time
- Kysely over a heavier ORM — stays close to raw SQL, important for PostGIS-specific syntax
- Backend calculates `tile_id`, not frontend — single source of truth, no cross-device floating-point drift
- Transaction pooler (port 6543) for public WiFi compatibility
- SuperTile marker centers use tile coordinates, not post averages — deterministic, cache-friendly
- Bounding-box + GIST spatial index over tile-ID arrays — 1000x smaller requests, O(log n) vs O(n)
- Fetch on pan stop, not during pan — prevents marker churn crashes, reduces API calls
- Comments gated by proximity OR prior reaction — lets an engaged user keep participating after moving away
- Self-commenting is intentional (Reddit/HN norm); doesn't affect ranking, supports post updates
- Account deletion reassigns content to a `[deleted]` sentinel rather than hard-deleting posts/comments — preserves thread integrity for other users

### Performance Learnings

- Rendering per-tile boundary polygons crashes the map — group into supertiles instead
- Non-unique marker keys caused native iOS array index mismatches (`[__NSArrayM insertObject:atIndex:]`) — fixed with keys incorporating post IDs, marker cap (150), concurrent-fetch guards
- PostgreSQL `DECIMAL` serializes as string in JSON — explicit `parseFloat` needed or markers render as `NaN`
- `initialRegion` + `animateToRegion` instead of controlled `region` prop eliminates render cascades
- React Native has two separate worlds (JS VM and Native) that communicate via a bridge; if they get out of sync you get native crashes with no JS stack trace — error boundaries now catch render-time regressions in this class before they take the whole screen down

### Development Learnings

- ES module import hoisting requires `.env` loaded before other imports
- Public WiFi blocks port 5432 — use 6543 (transaction pooler)
- `printRoutes()` tree-text produces false diffs on unrelated route changes — an `onRoute` hook collecting sorted `"METHOD /path"` strings is stable for CI/pre-commit diffing
- `process.exit(0)` must be called explicitly to terminate spawned `tsx` child processes in CI scripts
- Node's `readline/promises` `.question()` hangs after the first answer on piped stdin — use a single shared async iterator instead

## Recent Session Summary

**Session Date:** August 1, 2026

**What We Did:**

1. Added error boundaries around `MapView` and `TileDetailsModal`, with a `DevCrashButton` for manual verification (merged, closes #5)
2. Audited the actual repo against prior documentation and found several items marked "planned" were already shipped (account deletion, pg_cron migration) and one was drifted (leftover `DATABASE_URL exists`/`length` debug logs in `index.ts`, beyond what #17 removed)
3. Removed the leftover `DATABASE_URL` debug logging lines from `apps/backend/src/index.ts`
4. Rewrote this document to match the verified current state of the codebase

**Next Action:**
Pick up the App Store blockers — moderation (report + block) is the largest remaining gap with no code written yet.
