#!/usr/bin/env node
/**
 * CI safety check for GH issues #17 and #23.
 *
 * scripts/routes.{dev,prod}.snapshot are the single source of truth for
 * "which routes are dev-only", normally kept current by the pre-commit hook
 * (pre-commit-route-check.mjs), which regenerates + stages them whenever
 * route files change and prompts a human to confirm any new route's
 * intended visibility.
 *
 * This check is the backstop for that hook being skipped (--no-verify, a
 * fresh clone that never ran `npm install`/husky's prepare step, a direct
 * push, etc.) and the runtime proof that gating actually works:
 *
 *   1. Boots the backend in dev mode (introspection only) and in production
 *      mode (a real listening server), and fails if either's live route
 *      table doesn't match the committed snapshot. If this fails, the fix
 *      is to re-commit the route change locally with hooks enabled so the
 *      hook can update and stage the snapshot files — not to hand-edit them.
 *   2. Using that same production boot, actually requests every route that's
 *      dev-only (present in the dev route table but not the prod one) and
 *      asserts it 404s, proving the gating works at the HTTP level and not
 *      just in the registration list.
 *
 * Run from apps/backend:
 *   node ../../scripts/check-routes.mjs
 *
 * Hang protections (added after a CI run stalled for 6+ minutes):
 *   1. Every individual fetch() has its own hard timeout via AbortController,
 *      so a stalled connection attempt can't stall the whole poll loop.
 *   2. Child process gets SIGTERM, then SIGKILL if it's still alive after
 *      a grace period (covers tsx spawning sub-processes that ignore SIGTERM).
 *   3. A top-level watchdog force-exits the whole script after
 *      OVERALL_WATCHDOG_MS no matter what else is happening.
 */

import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import process from "node:process"
import { getRouteTable, parseRouteTable, diffRouteTables } from "./lib/route-table.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = process.cwd()
const SNAPSHOT_DEV = join(__dirname, "routes.dev.snapshot")
const SNAPSHOT_PROD = join(__dirname, "routes.prod.snapshot")

const PORT = process.env.CHECK_PORT || 4999
const HOST = "127.0.0.1"
const BASE_URL = `http://${HOST}:${PORT}`
const BOOT_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 300
const FETCH_TIMEOUT_MS = 2_000 // per-request timeout, so a stalled connect can't stall the loop
const KILL_GRACE_MS = 3_000 // time to wait after SIGTERM before escalating to SIGKILL
const OVERALL_WATCHDOG_MS = 45_000 // absolute upper bound on the whole script's runtime

const ROUTES_THAT_MUST_STAY_OPEN = ["/health"]

const pathOf = (routeEntry) => routeEntry.slice(routeEntry.indexOf(" ") + 1)

let server = null

function log(msg) {
  console.log(`[check-routes] ${msg}`)
}

const watchdog = setTimeout(() => {
  console.error(
    `[check-routes] WATCHDOG: script exceeded ${OVERALL_WATCHDOG_MS}ms overall. ` +
      `Force-killing and failing. This indicates a hang the normal logic didn't catch — ` +
      `please report it, this is a bug in the check itself, not necessarily your code.`
  )
  killServer(true)
  process.exit(1)
}, OVERALL_WATCHDOG_MS)
watchdog.unref?.()

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

async function fetchWithTimeout(url, timeoutMs, method = "GET") {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { method, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

async function bootProdServer() {
  // If something already answers on PORT (e.g. a server a previous run
  // failed to kill), our spawned server can't bind, yet the health poll
  // below would succeed against the stale one and every probe would test
  // old code. Refuse to run instead.
  try {
    await fetchWithTimeout(`${BASE_URL}/health`, FETCH_TIMEOUT_MS)
    throw new Error(
      `Port ${PORT} is already in use by another server. Stop it ` +
        `(lsof -ti tcp:${PORT} | xargs kill) or set CHECK_PORT, then re-run.`
    )
  } catch (err) {
    if (err.message.startsWith(`Port ${PORT}`)) throw err
    // connection refused/timed out: the port is free, which is what we want
  }

  server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), HOST },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  })

  let output = ""
  server.stdout.on("data", (d) => (output += d.toString()))
  server.stderr.on("data", (d) => (output += d.toString()))

  const start = Date.now()
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/health`, FETCH_TIMEOUT_MS)
      if (res.ok) return { output: () => output }
    } catch {
      // not up yet, or this attempt timed out — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Production server did not become healthy in time. Output:\n${output}`)
}

function reportSnapshotDiff(label, snapshotPath, expected, actual) {
  const { added, removed } = diffRouteTables(expected, actual)
  if (added.length === 0 && removed.length === 0) {
    log(`✅ ${label} snapshot matches the live route table.`)
    return false
  }
  console.error(`❌ FAIL: ${label} snapshot (${snapshotPath}) is out of date.`)
  for (const route of added) console.error(`    + ${route} (registered, but missing from the snapshot)`)
  for (const route of removed) console.error(`    - ${route} (in the snapshot, but no longer registered)`)
  return true
}

async function main() {
  const devExpected = JSON.parse(readFileSync(SNAPSHOT_DEV, "utf8"))
  const prodExpected = JSON.parse(readFileSync(SNAPSHOT_PROD, "utf8"))

  log(`Booting server with NODE_ENV=production on port ${PORT}, and NODE_ENV=development for introspection...`)
  const [devActual, prodBoot] = await Promise.all([
    getRouteTable("development", BACKEND_DIR),
    bootProdServer(),
  ])
  const prodActual = parseRouteTable(prodBoot.output())

  const devStale = reportSnapshotDiff("Dev", SNAPSHOT_DEV, devExpected, devActual)
  const prodStale = reportSnapshotDiff("Prod", SNAPSHOT_PROD, prodExpected, prodActual)

  if (devStale || prodStale) {
    console.error(
      "\nRoute snapshot check FAILED. The committed snapshot doesn't match the app's " +
        "actual routes — this usually means a route was added/removed without going " +
        "through the pre-commit hook (scripts/pre-commit-route-check.mjs). Re-commit " +
        "the route change locally with hooks enabled so it can update and stage the " +
        "snapshot files."
    )
    killServer(true)
    clearTimeout(watchdog)
    process.exit(1)
  }

  // Dev-only routes are whatever's in the dev route table but not the prod
  // one — derived from the boots above instead of a hand-maintained list.
  const devOnlyPaths = [...new Set(devActual.filter((r) => !prodActual.includes(r)).map(pathOf))]

  let failed = false

  for (const route of devOnlyPaths) {
    // A wildcard route (e.g. CORS's `OPTIONS *`, dev-only since #79) has
    // no literal URL. Probe it with its own method on a path that does
    // exist, so a 404 means the wildcard handler itself is gone.
    const wildcard = route === "*"
    const url = `${BASE_URL}${wildcard ? "/health" : route}`
    const method = wildcard ? "OPTIONS" : "GET"
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, method)
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
    console.error("\nRoute safety check FAILED.")
    process.exit(1)
  }

  log("All checks passed. Snapshots are current and no dev routes are reachable in production mode.")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  killServer(true)
  clearTimeout(watchdog)
  process.exit(1)
})
