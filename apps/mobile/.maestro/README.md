# Maestro E2E flows (#30, phase 2)

Local, on-demand. Not run in CI yet -- see issue #30 for why.

## One-time setup
- `brew install mobile-dev-inc/tap/maestro cocoapods` (Xcode + Java 17+ also required)
- Two test accounts in `.maestro/.env` (gitignored):
  `E2E_AUTHOR_EMAIL/PASSWORD`, `E2E_REACTOR_EMAIL/PASSWORD`. Create them with the
  dev-only `POST /api/dev/login` on a locally running backend (it creates + confirms).

## Each run
1. `npm run backend` (local backend; talks to whatever `apps/backend/.env` points at)
2. `npx expo run:ios` from `apps/mobile` (builds the dev client, starts Metro on :8081)
3. `.maestro/run.sh` (all flows) or `.maestro/run.sh flows/login.yaml`

## Layout
- `flows/` -- runnable tests (`maestro test flows` runs every file here)
- `subflows/` -- reusable steps, deliberately outside `flows/` so they aren't run as tests
- `scripts/` -- JS run by flows (`cleanup-posts.js`)

## Writing a flow that creates data
- Prefix all test content with `e2e-`; `scripts/cleanup-posts.js` deletes the author's
  posts with that prefix via the API.
- Register it with `onFlowComplete` in the flow header -- it runs on pass **and** fail
  (verified with a deliberately failing flow), so an aborted run can't leave posts behind.
- Use `setLocation` *before* launching: the map reads the device location once on mount.
  The create-post flow uses open water in the Yellow Sea (37.2, 126.3).
- In YAML, quote any `inputText` containing ` #` -- it's otherwise parsed as a comment.

## Gotchas
- **Flows touch real data.** Every flow must delete what it creates (use
  `onFlowComplete` so cleanup runs on failure too).
- **System dialogs hide the app from Maestro** (location permission, "Save Password?").
  Dismiss them explicitly. `launchApp: permissions:` uses `always|inuse|never` on iOS and
  didn't survive `clearState`.
- **Text matches are full-string regexes.** A post card is one merged accessibility
  element ("Bright Birch, you, 🗑, <content>, ..."), so use `".*content.*"`.
- **Map markers are reachable** via `id: tile-marker`, but one too close to the screen edge
  didn't respond to taps -- pan it toward the middle first.
