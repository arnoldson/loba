#!/usr/bin/env node
/**
 * Pre-commit hook (invoked via .husky/pre-commit).
 *
 * - Does nothing (instantly) if no staged files touch route registration.
 * - If they do, boots the app in dev + prod mode, diffs against the
 *   committed route snapshots.
 * - No diff → does nothing.
 * - New route(s) found → auto-detects whether each is actually reachable
 *   in production mode (not self-reported — computed by literally running
 *   the app both ways) and prompts accordingly.
 * - On proceed, updates + stages the snapshot files so the commit carries
 *   its own record of the route-table change.
 * - Ungated-but-acknowledged routes get one line appended to
 *   scripts/route-acknowledgments.log (visibility, not enforcement).
 *
 * Exit code 0 = allow the commit. Nonzero = git aborts the commit.
 */

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, openSync, createReadStream } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"
import readline from "node:readline"
import process from "node:process"
import { getRouteTable, diffRouteTables } from "./lib/route-table.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const BACKEND_DIR = join(REPO_ROOT, "apps", "backend")
const SNAPSHOT_DEV = join(__dirname, "routes.dev.snapshot")
const SNAPSHOT_PROD = join(__dirname, "routes.prod.snapshot")
const ACK_LOG = join(__dirname, "route-acknowledgments.log")

const ROUTE_RELEVANT_PATTERN = /apps\/backend\/src\/(index\.ts|routes\/.*\.ts)$/

function getStagedFiles() {
  const out = execSync("git diff --cached --name-only", { cwd: REPO_ROOT, encoding: "utf8" })
  return out.split("\n").filter(Boolean)
}

function readSnapshot(path) {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeSnapshot(path, routes) {
  writeFileSync(path, JSON.stringify(routes, null, 2) + "\n")
}

function stageFile(absPath, { force = false } = {}) {
  const flag = force ? "-f " : ""
  execSync(`git add ${flag}"${relative(REPO_ROOT, absPath)}"`, { cwd: REPO_ROOT })
}

function appendAck(line) {
  const ts = new Date().toISOString()
  const entry = `${ts}  ${line}\n`
  const existing = existsSync(ACK_LOG) ? readFileSync(ACK_LOG, "utf8") : ""
  writeFileSync(ACK_LOG, existing + entry)
}

function openTtyInput() {
  // process.stdin is unreliable inside git hooks — git itself uses stdin
  // during commit, and Husky's shell wrapper doesn't reliably forward the
  // real terminal through to this child process. /dev/tty always refers
  // to the actual controlling terminal, regardless of stdin redirection.
  try {
    const fd = openSync("/dev/tty", "r")
    return createReadStream(null, { fd })
  } catch {
    return null // no controlling terminal available (e.g. CI) — caller must handle
  }
}

async function ask(lineIterator, question, { defaultYes }) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]"
  process.stdout.write(`${question} ${suffix} `)
  const { value, done } = await lineIterator.next()
  const answer = (done ? "" : value).trim().toLowerCase()
  if (answer === "") return defaultYes
  return answer === "y" || answer === "yes"
}

async function main() {
  const staged = getStagedFiles()
  const relevant = staged.some((f) => ROUTE_RELEVANT_PATTERN.test(f))
  if (!relevant) {
    process.exit(0) // nothing route-related staged — instant no-op
  }

  console.log("[route-check] Route-related files staged, checking route table...")

  const [devActual, prodActual] = await Promise.all([
    getRouteTable("development", BACKEND_DIR),
    getRouteTable("production", BACKEND_DIR),
  ])

  const devSnapshot = readSnapshot(SNAPSHOT_DEV)
  const prodSnapshot = readSnapshot(SNAPSHOT_PROD)

  if (devSnapshot === null || prodSnapshot === null) {
    console.log("[route-check] No existing snapshot found — creating baseline (no prompts for existing routes).")
    writeSnapshot(SNAPSHOT_DEV, devActual)
    writeSnapshot(SNAPSHOT_PROD, prodActual)
    stageFile(SNAPSHOT_DEV)
    stageFile(SNAPSHOT_PROD)
    console.log("[route-check] Baseline created and staged. Commit proceeding.")
    process.exit(0)
  }

  const { added, removed } = diffRouteTables(devSnapshot, devActual)

  if (added.length === 0 && removed.length === 0) {
    process.exit(0) // route files touched, but route table itself unchanged
  }

  for (const route of removed) {
    console.log(`[route-check] ℹ️  Route removed: ${route}`)
  }

  if (added.length > 0) {
    const ttyInput = openTtyInput()
    if (!ttyInput) {
      console.error(
        "[route-check] No controlling terminal available to prompt for new routes " +
          `(${added.join(", ")}). Blocking commit to be safe — run this commit from ` +
          "an interactive terminal, or review and re-run.",
      )
      process.exit(1)
    }
    const rl = readline.createInterface({ input: ttyInput })
    const lineIterator = rl[Symbol.asyncIterator]()
    try {
      for (const route of added) {
        const liveInProd = prodActual.includes(route)
        console.log(`\n[route-check] New route detected: ${route}`)

        if (liveInProd) {
          console.log("[route-check] ⚠️  This route is reachable in PRODUCTION mode (not gated behind NODE_ENV).")
          const proceed = await ask(
            lineIterator,
            "[route-check] Is that intentional — should this route really be public in production?",
            { defaultYes: false }
          )
          if (!proceed) {
            console.log("\n[route-check] Commit aborted. Gate this route behind NODE_ENV !== \"production\" if it's dev/test-only, then commit again.")
            rl.close()
            process.exit(1)
          }
          appendAck(`ACKNOWLEDGED ungated production route: ${route}`)
          console.log("[route-check] Acknowledged — proceeding. Logged to scripts/route-acknowledgments.log.")
        } else {
          console.log("[route-check] ✅ Not reachable in production mode (correctly gated or dev-only by nature).")
          const confirmed = await ask(
            lineIterator,
            "[route-check] Confirm this is intentionally dev/test-only —",
            { defaultYes: true }
          )
          if (!confirmed) {
            console.log("\n[route-check] Commit aborted. Resolve the route's intended scope, then commit again.")
            rl.close()
            process.exit(1)
          }
        }
      }
    } finally {
      rl.close()
    }
  }

  writeSnapshot(SNAPSHOT_DEV, devActual)
  writeSnapshot(SNAPSHOT_PROD, prodActual)
  stageFile(SNAPSHOT_DEV)
  stageFile(SNAPSHOT_PROD)
  if (existsSync(ACK_LOG)) stageFile(ACK_LOG, { force: true })

  console.log("\n[route-check] Snapshot updated and staged. Commit proceeding.")
  process.exit(0)
}

main().catch((err) => {
  console.error("[route-check] Unexpected error, blocking commit to be safe:", err)
  process.exit(1)
})
