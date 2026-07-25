#!/usr/bin/env node
/**
 * Static guard for GH issue #17.
 *
 * Fails fast if index.ts registers/defines a known dev-only route outside
 * the `if (process.env.NODE_ENV !== "production")` block. Complements
 * check-prod-routes.mjs (which actually boots the server) by catching the
 * mistake immediately in review/CI without needing a DB connection.
 *
 * NOTE: static `import` statements are intentionally excluded from the
 * marker check. In JS/TS, imports must live at module top-level and can
 * never be placed inside a runtime if-block — what matters is where the
 * imported symbol is *used* (e.g. fastify.register(seedRoutes, ...)), not
 * where it's imported.
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

// Symbols/paths that should only ever appear (in USE, not import) inside the NODE_ENV gate.
const DEV_MARKERS = ["devAuthRoutes", "/db-test", "/debug/", "seedRoutes"]

const GATE_OPEN = /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*["']production["']\s*\)/
const IMPORT_LINE = /^\s*import\s/

const src = readFileSync(filePath, "utf8")
const lines = src.split("\n")

let braceDepth = null // null = outside the gate; number = current depth inside gate
let failed = false

function countBraces(line) {
  const opens = (line.match(/{/g) || []).length
  const closes = (line.match(/}/g) || []).length
  return opens - closes
}

function checkMarkers(line, lineNo) {
  for (const marker of DEV_MARKERS) {
    if (line.includes(marker)) {
      console.error(
        `❌ FAIL: ${filePath}:${lineNo} references "${marker}" outside the ` +
          `NODE_ENV !== "production" gate:\n    ${line.trim()}`
      )
      failed = true
    }
  }
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const lineNo = i + 1
  const isImportLine = IMPORT_LINE.test(line)

  if (braceDepth === null) {
    // Currently outside the gate.
    if (GATE_OPEN.test(line)) {
      // Entering the gate — count braces on THIS line too (fixes the
      // off-by-one bug where the opening "{" was never counted).
      braceDepth = countBraces(line)
      if (braceDepth <= 0) braceDepth = null // single-line/no-brace edge case
      continue
    }
    if (!isImportLine) checkMarkers(line, lineNo)
    continue
  }

  // Currently inside the gate — this line's content is protected, no check needed.
  braceDepth += countBraces(line)
  if (braceDepth <= 0) {
    braceDepth = null
  }
}

if (failed) {
  console.error("\nDev-route gating check FAILED. Move the flagged code inside the NODE_ENV gate.")
  process.exit(1)
}

console.log("✅ Dev-route gating check passed.")
