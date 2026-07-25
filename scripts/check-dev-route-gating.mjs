#!/usr/bin/env node
/**
 * Static guard for GH issue #17.
 *
 * Fails fast if index.ts registers a known dev-only import/handler
 * outside the `if (process.env.NODE_ENV !== "production")` block.
 * This is a lightweight complement to check-prod-routes.mjs (which
 * actually boots the server) — it catches the mistake immediately in
 * review/CI without needing a DB connection.
 *
 * Run from apps/backend:
 *   node ../../scripts/check-dev-route-gating.mjs src/index.ts
 */

import { readFileSync } from "node:fs"
import process from "node:process"

const filePath = process.argv[2]
if (!filePath) {
  console.error("Usage: check-dev-route-gating.mjs <path-to-index.ts>")
  process.exit(1)
}

// Symbols/paths that should only ever appear inside the NODE_ENV gate.
const DEV_MARKERS = ["devAuthRoutes", "/db-test", "/debug/", "seedRoutes"]

const src = readFileSync(filePath, "utf8")
const lines = src.split("\n")

const GATE_OPEN = /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*["']production["']\s*\)/
let braceDepth = null // null = not inside gate; number = current depth inside gate
let failed = false

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const lineNo = i + 1

  if (braceDepth === null && GATE_OPEN.test(line)) {
    braceDepth = 0
    continue
  }

  if (braceDepth !== null) {
    braceDepth += (line.match(/{/g) || []).length
    braceDepth -= (line.match(/}/g) || []).length
    if (braceDepth <= 0) {
      braceDepth = null
      continue
    }
  }

  const insideGate = braceDepth !== null
  for (const marker of DEV_MARKERS) {
    if (line.includes(marker) && !insideGate) {
      console.error(
        `❌ FAIL: ${filePath}:${lineNo} references "${marker}" outside the ` +
          `NODE_ENV !== "production" gate:\n    ${line.trim()}`
      )
      failed = true
    }
  }
}

if (failed) {
  console.error("\nDev-route gating check FAILED. Move the flagged code inside the NODE_ENV gate.")
  process.exit(1)
}

console.log("✅ Dev-route gating check passed.")
