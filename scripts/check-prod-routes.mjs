#!/usr/bin/env node
/**
 * CI safety check for GH issue #17.
 *
 * Boots the Fastify backend with NODE_ENV=production and verifies that
 * dev-only / debug routes are NOT reachable. Fails (non-zero exit) if
 * any of them respond with anything other than 404.
 *
 * Run from apps/backend:
 *   node ../../scripts/check-prod-routes.mjs
 *
 * No build step required — runs the server via `tsx` the same way your
 * dev server does. If your backend actually uses ts-node instead of tsx,
 * change the `spawn("npx", ["tsx", ...])` call below to match.
 *
 * Hang protections (added after a CI run stalled for 6+ minutes):
 *   1. Every individual fetch() has its own hard timeout via AbortController,
 *      so a stalled connection attempt can't stall the whole poll loop.
 *   2. Child process gets SIGTERM, then SIGKILL if it's still alive after
 *      a grace period (covers tsx spawning sub-processes that ignore SIGTERM).
 *   3. A top-level watchdog force-exits the whole script after
 *      OVERALL_WATCHDOG_MS no matter what else is happening, so a bug
 *      here can never hang a CI job indefinitely again.
 */

import { spawn } from "node:child_process"
import process from "node:process"

const PORT = process.env.CHECK_PORT || 4999
const HOST = "127.0.0.1"
const BASE_URL = `http://${HOST}:${PORT}`
const BOOT_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 300
const FETCH_TIMEOUT_MS = 2_000 // per-request timeout, so a stalled connect can't stall the loop
const KILL_GRACE_MS = 3_000 // time to wait after SIGTERM before escalating to SIGKILL
const OVERALL_WATCHDOG_MS = 45_000 // absolute upper bound on the whole script's runtime

// Add new dev-only routes here as they're introduced.
const ROUTES_THAT_MUST_BE_BLOCKED = [
  "/db-test",
  "/debug/posts",
  "/api/dev/login", // dev-auth.ts — creates/signs in test users
  "/api/dev/me", // dev-auth.ts — requires auth, but must 404 unauthenticated too
  "/api/dev/verify", // dev-auth.ts — lets a caller self-set verification_status; highest severity if leaked
  "/api/seed",
]

// Routes that MUST remain reachable in production.
const ROUTES_THAT_MUST_STAY_OPEN = ["/health"]

let server = null

function log(msg) {
  console.log(`[check-prod-routes] ${msg}`)
}

// Absolute safety net: no matter what hangs, this fires eventually.
const watchdog = setTimeout(() => {
  console.error(
    `[check-prod-routes] WATCHDOG: script exceeded ${OVERALL_WATCHDOG_MS}ms overall. ` +
      `Force-killing and failing. This indicates a hang the normal logic didn't catch — ` +
      `please report it, this is a bug in the check itself, not necessarily your code.`
  )
  killServer(true)
  process.exit(1)
}, OVERALL_WATCHDOG_MS)
watchdog.unref?.() // don't let the watchdog itself keep the process alive if everything else finishes cleanly

function killServer(force = false) {
  if (!server || server.killed) return
  try {
    server.kill(force ? "SIGKILL" : "SIGTERM")
  } catch {
    // already dead, ignore
  }
  if (!force) {
    setTimeout(() => {
      if (server && !server.killed) {
        log("Server did not exit after SIGTERM, sending SIGKILL...")
        try {
          server.kill("SIGKILL")
        } catch {
          // already dead, ignore
        }
      }
    }, KILL_GRACE_MS).unref?.()
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

async function waitForServer() {
  const start = Date.now()
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/health`, FETCH_TIMEOUT_MS)
      if (res.ok) return true
    } catch {
      // not up yet, or this attempt timed out — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return false
}

async function main() {
  log(`Booting server with NODE_ENV=production on port ${PORT}...`)

  server = spawn("npx", ["tsx", "src/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOST,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  })

  let serverOutput = ""
  server.stdout.on("data", (d) => (serverOutput += d.toString()))
  server.stderr.on("data", (d) => (serverOutput += d.toString()))

  const up = await waitForServer()
  if (!up) {
    console.error("Server did not become healthy in time. Output:\n" + serverOutput)
    killServer()
    clearTimeout(watchdog)
    process.exit(1)
  }

  let failed = false

  for (const route of ROUTES_THAT_MUST_BE_BLOCKED) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}${route}`, FETCH_TIMEOUT_MS)
      if (res.status !== 404) {
        console.error(
          `❌ FAIL: ${route} returned ${res.status} in production mode (expected 404). ` +
            `This route must be gated behind NODE_ENV !== "production".`
        )
        failed = true
      } else {
        log(`✅ ${route} correctly blocked (404)`)
      }
    } catch (err) {
      console.error(`❌ FAIL: request to ${route} errored/timed out: ${err.message}`)
      failed = true
    }
  }

  for (const route of ROUTES_THAT_MUST_STAY_OPEN) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}${route}`, FETCH_TIMEOUT_MS)
      if (!res.ok) {
        console.error(`❌ FAIL: ${route} returned ${res.status}, expected it to stay open in production.`)
        failed = true
      } else {
        log(`✅ ${route} correctly reachable`)
      }
    } catch (err) {
      console.error(`❌ FAIL: request to ${route} errored/timed out: ${err.message}`)
      failed = true
    }
  }

  killServer(true)
  clearTimeout(watchdog)

  if (failed) {
    console.error("\nProduction route safety check FAILED.")
    process.exit(1)
  }

  log("All checks passed. No dev routes are reachable in production mode.")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  killServer(true)
  clearTimeout(watchdog)
  process.exit(1)
})
