# Maestro E2E flows (#30, phase 2)

Local, on-demand. Not run in CI yet -- see issue #30 for why.

## One-time setup
- `brew install mobile-dev-inc/tap/maestro cocoapods` (Xcode + Java 17+ also required)
- Two test accounts in `.maestro/.env` (gitignored):
  `E2E_AUTHOR_EMAIL/PASSWORD`, `E2E_REACTOR_EMAIL/PASSWORD`. Create them with the
  dev-only `POST /api/dev/login` on a locally running backend (it creates + confirms).

## Each run
**`npm run e2e`** from the repo root (or `npm run e2e -- flows/login.yaml` for a subset). It
checks the prerequisites, starts the backend and Metro (with `EXPO_PUBLIC_E2E=1`), runs the
flows, verifies no `e2e-` posts were left on the real map, and shuts everything down.
Needs a booted simulator with the dev build installed (`npx expo run:ios` in `apps/mobile`
once, and again after native dependency changes).

Each run records a pass/fail in `.maestro/reports/<timestamp>-<commit>[-dirty]/`
(`report.xml` JUnit + `summary.txt`; gitignored). Before a release, run it on a clean
checkout of the release commit and keep that report -- that's the recorded pass.

Not part of any git hook or CI: the full suite takes ~35 minutes (the two coverage flows are
~10 each -- run the others alone with `npm run e2e -- flows/<name>.yaml`), needs the simulator, and
writes to the real database, so it's run deliberately -- before releases and after changes
to reactions, location gating or the map screen.

<details><summary>Doing it by hand instead</summary>

1. `npm run backend` (local backend; talks to whatever `apps/backend/.env` points at)
2. From `apps/mobile`: `EXPO_PUBLIC_E2E=1 npx expo start --dev-client` (the flag hides LogBox's
   warning banner, which otherwise covers the modal's vote buttons and eats taps)
3. `.maestro/run.sh` (all flows) or `.maestro/run.sh flows/login.yaml`

</details>

## Layout
- `flows/` -- runnable tests (`maestro test flows` runs every file here)
- `subflows/` -- reusable steps, deliberately outside `flows/` so they aren't run as tests
- `scripts/` -- JS run by flows: `create-post.js` (API setup; pass `POST_KEY` to create several
  posts in one flow -> `output.<key>Id` / `output.<key>Text`) and `cleanup-posts.js`;
  plus `check-leftovers.mjs`, the post-run safety net used by `e2e.sh`

## Map markers (#93, #95)
- `marker-stability-{equator,pole}.yaml` seed a fixed spread of posts (`scripts/seed-spread.js`)
  straddling the equator and at 80°N, then pan, zoom in and recenter, checking after each gesture
  (`scripts/map-state.js`) that markers never move, cells never shift, zoom levels nest, and cell
  size depends only on zoom. `marker-stability-outline.yaml` does the same with the dev sector
  outline on, so polygons change alongside markers on every update.
- `marker-coverage-{equator,pole}.yaml` seed ~460 posts across and past the whole screen
  (`scripts/seed-grid.js`; dense enough at the widest zoom that every cell on screen holds one),
  then at four zoom levels from street level out to near the zoom-out lock check after every view
  change that every seeded post on screen has a marker -- no strips, sides or corners unrendered.

Maestro can't read a map marker's coordinate or pinch, so E2E builds (`EXPO_PUBLIC_E2E=1`) add
two hooks to the map screen (`components/E2EMapState.tsx`):
- `id: e2e-map-state` -- a tiny readout of the sectors from the last fetch (a marker is drawn
  exactly at its sector's center) and the map's real on-screen bounds.
  `subflows/map-capture.yaml` waits for the next fetch and captures it.
- `id: e2e-goto` -- type `lat,lng,longitudeDelta` and submit to move the camera, e.g. to zoom out.

Markers are found by `id: tile-marker`, which sits on the marker's content view: react-native-maps'
Fabric `Marker` doesn't pass its own `testID` on to iOS.

## Writing a flow that creates data
- Prefix all test content with `e2e-`; `scripts/cleanup-posts.js` deletes the author's
  posts with that prefix via the API.
- Register it with `onFlowComplete` in the flow header -- it runs on pass **and** fail
  (verified with a deliberately failing flow), so an aborted run can't leave posts behind.
- Use `setLocation` *before* launching: the map reads the device location once on mount.
  The create-post flow uses open water in the Yellow Sea (37.2, 126.3).
- In YAML, quote any `inputText` containing ` #` -- it's otherwise parsed as a comment.

## Gotchas
- **The LogBox banner ("Open debugger to view warnings") eats taps** at the bottom of the
  screen in dev builds. Start Metro with `EXPO_PUBLIC_E2E=1` (see above).
- **Flows touch real data.** Every flow must delete what it creates (use
  `onFlowComplete` so cleanup runs on failure too).
- **System dialogs hide the app from Maestro** (location permission, "Save Password?").
  Dismiss them explicitly. `launchApp: permissions:` uses `always|inuse|never` on iOS and
  didn't survive `clearState`.
- **Text matches are full-string regexes.** A post card is one merged accessibility
  element ("Bright Birch, you, 🗑, <content>, ..."), so use `".*content.*"`.
- **Map markers are reachable** via `id: tile-marker`, but one too close to the screen edge
  didn't respond to taps -- pan it toward the middle first.
