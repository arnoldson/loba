// Deletes every post the E2E author account created during a flow run
// (identified by the "e2e-" content prefix). Runs from `onFlowComplete`, which
// Maestro calls whether the flow passed or failed, so an aborted flow can't
// leave test posts on the real map. Talks to the API directly rather than
// through the UI so cleanup doesn't depend on the app being in a usable state.
//
// Env (passed by .maestro/run.sh): E2E_API_URL, E2E_AUTHOR_EMAIL, E2E_AUTHOR_PASSWORD

const TEST_POST_PREFIX = "e2e-"

const login = http.post(E2E_API_URL + "/api/auth/login", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: E2E_AUTHOR_EMAIL, password: E2E_AUTHOR_PASSWORD }),
})
const token = JSON.parse(login.body).access_token
if (!token) {
  throw new Error("cleanup: could not log in as the E2E author: " + login.body)
}
const auth = { Authorization: "Bearer " + token }

const mine = JSON.parse(http.get(E2E_API_URL + "/api/posts/mine", { headers: auth }).body)
const leftovers = (mine.posts || []).filter((p) => p.content.indexOf(TEST_POST_PREFIX) === 0)

let failed = 0
for (const post of leftovers) {
  const res = http.delete(E2E_API_URL + "/api/posts/" + post.id, { headers: auth })
  if (!res.ok) failed++
}
console.log("cleanup: deleted " + (leftovers.length - failed) + "/" + leftovers.length + " e2e post(s)")
if (failed > 0) throw new Error("cleanup: failed to delete " + failed + " post(s)")
