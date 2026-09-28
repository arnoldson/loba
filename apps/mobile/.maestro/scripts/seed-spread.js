// Setup step for the marker-stability flows (#93): creates a fixed spread of
// posts around CENTER_LAT/CENTER_LNG as the E2E author, straight through the
// API. Fixed offsets (not random) so every run exercises the same layout:
// ~440m of latitude by ~120m of longitude, with a few tight pairs that
// cluster into one marker and a few loners.
//
// Every post carries the "e2e-" prefix, so cleanup-posts.js (run from the
// flow's onFlowComplete) deletes them whether the flow passes or fails.
//
// Env: E2E_API_URL, E2E_AUTHOR_EMAIL, E2E_AUTHOR_PASSWORD, CENTER_LAT, CENTER_LNG

const METERS_PER_DEGREE = 111320

// [north, east] offsets in real meters from the center.
const OFFSETS = [
  [-220, -50], [-200, 40], [-160, 0], [-150, 5], [-110, -30],
  [-70, 55], [-40, -45], [-35, -40], [-10, 20], [25, -10],
  [30, 50], [60, -55], [90, 15], [95, 20], [100, 25],
  [130, -20], [165, 45], [190, -35], [210, 10], [220, -5],
]

const centerLat = Number(CENTER_LAT)
const centerLng = Number(CENTER_LNG)
const cosLat = Math.cos((centerLat * Math.PI) / 180)

const headers = { "Content-Type": "application/json" }
const login = http.post(E2E_API_URL + "/api/auth/login", {
  headers: headers,
  body: JSON.stringify({ email: E2E_AUTHOR_EMAIL, password: E2E_AUTHOR_PASSWORD }),
})
const token = JSON.parse(login.body).access_token
if (!token) throw new Error("seed-spread: could not log in as the E2E author: " + login.body)

const stamp = new Date().getTime()
for (let i = 0; i < OFFSETS.length; i++) {
  const res = http.post(E2E_API_URL + "/api/posts", {
    headers: Object.assign({ Authorization: "Bearer " + token }, headers),
    body: JSON.stringify({
      content: "e2e-spread-" + i + "-" + stamp,
      latitude: centerLat + OFFSETS[i][0] / METERS_PER_DEGREE,
      longitude: centerLng + OFFSETS[i][1] / (METERS_PER_DEGREE * cosLat),
      tags: [],
      locationAccuracy: 10,
      locationTimestamp: new Date().getTime(),
    }),
  })
  if (!JSON.parse(res.body).success) {
    throw new Error("seed-spread: API rejected post " + i + ": " + res.body)
  }
}
console.log("seed-spread: created " + OFFSETS.length + " posts around " + CENTER_LAT + ", " + CENTER_LNG)
