/**
 * Shared route-table extraction, used by check-routes.mjs (CI, hard-fail)
 * and pre-commit-route-check.mjs (local, interactive).
 *
 * Both consume the exact same "METHOD /path" JSON array that index.ts
 * always prints on boot (see the comment above its PRINT_ROUTES_AND_EXIT
 * check), so there's one definition of "what does the route table
 * currently look like" shared by both — whether that boot exits
 * immediately (pure introspection) or keeps listening for real (a boot
 * check-routes.mjs also uses to run HTTP-level checks against).
 */

import { spawn } from "node:child_process"
import process from "node:process"

const BOOT_TIMEOUT_MS = 15_000

/**
 * @param {string} output - accumulated stdout+stderr from a backend boot
 * @returns {string[]} sorted array of "METHOD /path" strings
 */
export function parseRouteTable(output) {
  const match = output.match(/<<<ROUTES_START>>>([\s\S]*?)<<<ROUTES_END>>>/)
  if (!match) {
    throw new Error(`Could not find route table markers in output. Full output:\n${output}`)
  }
  try {
    return JSON.parse(match[1].trim())
  } catch (err) {
    throw new Error(`Route table output wasn't valid JSON: ${err.message}\nRaw: ${match[1]}`)
  }
}

/**
 * Boots the backend just to read its route table, then exits (never binds
 * a port — see PRINT_ROUTES_AND_EXIT in index.ts).
 *
 * @param {string} nodeEnv - "development" or "production"
 * @param {string} backendCwd - absolute path to apps/backend
 * @returns {Promise<string[]>} sorted array of "METHOD /path" strings
 */
export async function getRouteTable(nodeEnv, backendCwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: backendCwd,
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
        PRINT_ROUTES_AND_EXIT: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`Timed out waiting for route table (NODE_ENV=${nodeEnv}). Output so far:\n${output}`))
    }, BOOT_TIMEOUT_MS)
    timer.unref?.()

    child.stdout.on("data", (d) => (output += d.toString()))
    child.stderr.on("data", (d) => (output += d.toString()))

    child.on("close", (code) => {
      clearTimeout(timer)
      try {
        resolve(parseRouteTable(output))
      } catch (err) {
        reject(new Error(`${err.message} (NODE_ENV=${nodeEnv}, exit code ${code})`))
      }
    })

    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * @param {string[]} expected
 * @param {string[]} actual
 * @returns {{ added: string[], removed: string[] }}
 */
export function diffRouteTables(expected, actual) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const added = actual.filter((r) => !expectedSet.has(r))
  const removed = expected.filter((r) => !actualSet.has(r))
  return { added, removed }
}
