// Setup step: creates a post as the E2E author straight through the API, so
// reaction flows start from a known post without depending on the create-post
// UI (which has its own flow). Returns output.<key>Id / output.<key>Text, where
// <key> is POST_KEY (default "post" -> output.postId / output.postText). Call it
// more than once with different POST_KEYs to create several posts in one flow.
//
// The post's content carries the "e2e-" prefix, so cleanup-posts.js (run from
// the flow's onFlowComplete) deletes it whether the flow passes or fails.
//
// Env: E2E_API_URL, E2E_AUTHOR_EMAIL, E2E_AUTHOR_PASSWORD, POST_LAT, POST_LNG,
//      POST_KEY (optional)

const key = typeof POST_KEY === "undefined" ? "post" : POST_KEY

const headers = { "Content-Type": "application/json" }

const login = http.post(E2E_API_URL + "/api/auth/login", {
  headers: headers,
  body: JSON.stringify({ email: E2E_AUTHOR_EMAIL, password: E2E_AUTHOR_PASSWORD }),
})
const token = JSON.parse(login.body).access_token
if (!token) throw new Error("create-post: could not log in as the E2E author: " + login.body)

const postText = "e2e-" + key + "-" + new Date().getTime()
const created = http.post(E2E_API_URL + "/api/posts", {
  headers: Object.assign({ Authorization: "Bearer " + token }, headers),
  body: JSON.stringify({
    content: postText,
    latitude: Number(POST_LAT),
    longitude: Number(POST_LNG),
    tags: [],
    locationAccuracy: 10,
    locationTimestamp: new Date().getTime(),
  }),
})
const body = JSON.parse(created.body)
if (!body.success) throw new Error("create-post: API rejected the post: " + created.body)

output[key + "Id"] = body.post.id
output[key + "Text"] = postText
