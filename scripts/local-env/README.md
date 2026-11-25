# Offline local environment

> **Testing branch only (`chore/local-offline-env`) -- never merge into main.** It adds a local
> Supabase project (`supabase/`), these scripts, and capture flows; none of it belongs in main.

Runs Loba entirely on this machine: backend, iOS simulator app, and Postgres + PostGIS + Auth from
the Supabase CLI's local stack. Nothing talks to the live Supabase project or Railway. Built to check
out old commits and capture the map's behaviour at each (the grid-history screenshots), but it works
for any commit back to 726dd22.

## Pieces

- **`supabase/`** (repo root) -- the local stack, on ports 553xx so it can run beside other local
  Supabase projects. `supabase start` applies `supabase/migrations/` in order:
  - `00000000000000_base_schema.sql` -- schema-only dump of the live `public` schema
    (`supabase db dump`, Postgres 17). No data. Re-dump to refresh it.
  - `00000000000001_auth_user_profile_trigger.sql` -- the `auth.users` trigger behind
    `handle_new_user()`, which a `public`-only dump leaves out.
  - `00000000000002_pre63_tile_id_compat.sql` -- re-adds `posts.tile_id` and
    `post_reports.tile_id_snapshot` (dropped by #63) as **nullable**, so pre-#63 code runs against
    the same database. One database serves every commit, with the same posts.
- **`setup.sh [commit ...]`** -- starts the stack, creates a `git worktree` per commit under
  `../loba-captures/<commit>` (default: 726dd22 fa96b71 main), writes local-only env files into each,
  runs `npm install`, and creates two local accounts (`capture-author@loba.local`,
  `capture-viewer@loba.local`, password `local-capture-pass`). Re-runnable.
- **`seed.mjs`** -- posts a fixed spread plus a 40m lattice around Seoul (37.5665, 126.978) and 80°N
  (80.0, -150.0), leaving the screen's left edge clear for the flows' zoom double-tap. Run it while a **pre-#63** backend is up, so every post also gets a `tile_id`.
- **`capture.sh <commit> <simulator-udid> [flow ...]`** -- starts that worktree's backend (:3000)
  and Metro (:8081), runs `apps/mobile/.maestro/captures/<flow>.yaml` (default: `seoul arctic`), and
  saves screenshots plus a pan recording to `../loba-captures/output/<commit>/<timestamp>/`.

## Staying offline

- The worktrees never get the live `apps/backend/.env` or `apps/mobile/.env` (both gitignored).
  `setup.sh` writes their only env files from `supabase status`; it and `capture.sh` refuse to run if
  any of them mentions `supabase.co` or `railway.app`, or if a `apps/mobile/.env` appears.
- `EXPO_PUBLIC_API_URL` is left unset, so the app uses its `http://localhost:3000` fallback.
- `seed.mjs` refuses any API URL that isn't localhost.
- Don't use the worktrees' `npm run start:prod` (points at Railway); `capture.sh` doesn't.

## Worktree-only patches

`setup.sh` makes two small changes in the worktrees (never committed):

- Every worktree: two lines appended to `apps/mobile/app/_layout.tsx` hide LogBox when Metro runs
  with `EXPO_PUBLIC_CAPTURE=1`, so the warning banner doesn't appear in captures or swallow taps.
- Pre-#63 commits (726dd22): the dev grid outline's safety cap goes from 500 to 5000 cells. That
  overlay draws the whole grid rectangle, and at 80°N -- where pre-#63 cells are ~5x too narrow
  (#60) -- the launch view alone is ~48x47 cells, so with the original cap the outline never draws
  and the narrow cells can't be seen. Captures of 726dd22's outline at high latitude rely on this.

## Simulators and dev clients

react-native-maps is native code and changed in #95, so each era needs its own dev client:

| Commits | react-native-maps | Simulator |
|---|---|---|
| 726dd22, fa96b71 | 1.20.1 | "iPhone 17 Pro (maps 1.20)" -- built from the fa96b71 worktree |
| main | 1.29.11 | "iPhone 17 Pro" |

Build a dev client from a worktree with
`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device <udid> --no-bundler` in its
`apps/mobile`. Pre-#95 commits use react-native-maps 1.20, whose new-architecture interop loses or
duplicates markers and can crash (#95) -- in captures that shows up as grid-outline cells with no
marker, and the run may stop early.

## Run it

```
scripts/local-env/setup.sh
(cd ../loba-captures/726dd22/apps/backend && npm run dev) &   # pre-#63 backend, for seeding
node scripts/local-env/seed.mjs
kill %1
scripts/local-env/capture.sh 726dd22 <maps-1.20 simulator udid>
scripts/local-env/capture.sh fa96b71 <maps-1.20 simulator udid>
scripts/local-env/capture.sh main    <iPhone 17 Pro udid>
```

`supabase stop` shuts the stack down (data is kept); `supabase db reset` wipes it back to the
migrations (re-run `setup.sh` for the accounts, then seed again).

## Known requirements

- Xcode 27 or later on macOS 27: with Xcode 26.2, Maestro's driver couldn't start on any simulator
  (`DTServiceHubClient failed to bless service hub`).
- CocoaPods needs a UTF-8 locale (the `LANG` above).
