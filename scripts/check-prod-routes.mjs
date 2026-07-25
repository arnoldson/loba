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
 */

import { spawn } from "node:child_process"
import process from "node:process"

const PORT = process.env.CHECK_PORT || 4999
const HOST = "127.0.0.1"
const BASE_URL = `http://${HOST}:${PORT}`
const BOOT_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 300

// Add new dev-only routes here as they're introduced.
const ROUTES_THAT_MUST_BE_BLOCKED = [
  "/db-test",
  "/debug/posts",
  "/api/dev/login", // dev-auth.ts — creates/signs in test users
  "/api/dev/me", // dev-auth.ts — requires auth, but must 404 unauthenticated too
  "/api/dev/verify", // dev-auth.ts — lets a caller self-set verification_status; highest severity if leaked
  "/api/seed",
]

// /api/dev/me and /api/dev/verify require a Bearer token via requireAuth,
// so hitting them with no auth header could in principle 401 rather than
// 404 if fastify matched the route. We still assert 404 here because the
// whole point is the route must not be *registered* at all in production —
// if it 401s instead of 404s, that's still a FAIL (means it's live).

// Routes that MUST remain reachable in production.
const ROUTES_THAT_MUST_STAY_OPEN = ["/health"]

function log(msg) {
  console.log(`[check-prod-routes] ${msg}`)
}

async function waitForServer() {
  const start = Date.now()
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/health`)
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return false
}

async function main() {
  log(`Booting server with NODE_ENV=production on port ${PORT}...`)

  const server = spawn("npx", ["tsx", "src/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOST,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let serverOutput = ""
  server.stdout.on("data", (d) => (serverOutput += d.toString()))
  server.stderr.on("data", (d) => (serverOutput += d.toString()))

  const cleanup = () => {
    server.kill("SIGTERM")
  }
  process.on("exit", cleanup)

  const up = await waitForServer()
  if (!up) {
    console.error("Server did not become healthy in time. Output:\n" + serverOutput)
    cleanup()
    process.exit(1)
  }

  let failed = false

  for (const route of ROUTES_THAT_MUST_BE_BLOCKED) {
    try {
      const res = await fetch(`${BASE_URL}${route}`)
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
      console.error(`❌ FAIL: request to ${route} errored: ${err.message}`)
      failed = true
    }
  }

  for (const route of ROUTES_THAT_MUST_STAY_OPEN) {
    try {
      const res = await fetch(`${BASE_URL}${route}`)
      if (!res.ok) {
        console.error(`❌ FAIL: ${route} returned ${res.status}, expected it to stay open in production.`)
        failed = true
      } else {
        log(`✅ ${route} correctly reachable`)
      }
    } catch (err) {
      console.error(`❌ FAIL: request to ${route} errored: ${err.message}`)
      failed = true
    }
  }

  cleanup()

  if (failed) {
    console.error("\nProduction route safety check FAILED.")
    process.exit(1)
  }

  log("All checks passed. No dev routes are reachable in production mode.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
