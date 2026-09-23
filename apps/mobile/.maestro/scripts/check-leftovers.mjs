// Post-run safety net for the E2E suite: every flow cleans up after itself
// (scripts/cleanup-posts.js via onFlowComplete), but if that ever silently
// fails, "e2e-" test posts would sit on the real map. This checks for
// leftovers, deletes any it finds, and exits non-zero so the run is flagged.
//
// Run by e2e.sh with the .maestro/.env vars exported. Node 22 (global fetch).

const { E2E_API_URL = "http://localhost:3000", E2E_AUTHOR_EMAIL, E2E_AUTHOR_PASSWORD } = process.env
const PREFIX = "e2e-"

const login = await fetch(`${E2E_API_URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: E2E_AUTHOR_EMAIL, password: E2E_AUTHOR_PASSWORD }),
})
const { access_token: token } = await login.json()
if (!token) {
  console.error("check-leftovers: could not log in as the E2E author")
  process.exit(2)
}
const headers = { Authorization: `Bearer ${token}` }

const { posts = [] } = await (await fetch(`${E2E_API_URL}/api/posts/mine`, { headers })).json()
const leftovers = posts.filter((p) => p.content.startsWith(PREFIX))

if (leftovers.length === 0) {
  console.log("check-leftovers: no e2e- posts left behind")
  process.exit(0)
}

for (const post of leftovers) {
  await fetch(`${E2E_API_URL}/api/posts/${post.id}`, { method: "DELETE", headers })
}
console.error(
  `check-leftovers: FOUND ${leftovers.length} leftover e2e- post(s) (deleted now) -- ` +
    "a flow's cleanup did not run or failed; investigate.",
)
process.exit(1)
