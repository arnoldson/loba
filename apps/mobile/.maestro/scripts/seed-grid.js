// Setup step for the marker-coverage flows: seeds posts across (and past)
// the whole screen at several zoom levels around CENTER_LAT/CENTER_LNG, so
// map-state.js can check no part of the screen is left without markers.
//
// For each longitude span in SPARSE_ZOOMS: a lattice around the screen's
// edges and corners (and a little past them). For DENSE_ZOOM: a lattice at
// 0.9x that zoom's cell size over the whole screen, so every cell on screen
// holds a post -- the most markers the map can be asked to show.
//
// Laid out in Web Mercator space (like the grid itself), assuming a portrait
// phone: screen height up to 2.2x its width, overshot to 1.2x in case it's
// taller. Posts that land off screen are simply ignored by the check.
// Returns output.gridPosts: JSON [[lat, lng], ...].
//
// Every post carries the "e2e-" prefix, so cleanup-posts.js (run from the
// flow's onFlowComplete) deletes them whether the flow passes or fails.
//
// Env: E2E_API_URL, E2E_AUTHOR_EMAIL, E2E_AUTHOR_PASSWORD, CENTER_LAT,
//      CENTER_LNG, SPARSE_ZOOMS (comma-separated longitudeDeltas), DENSE_ZOOM

const METERS_PER_DEGREE = 111320
const MERCATOR_RADIUS = (METERS_PER_DEGREE * 180) / Math.PI
// Mirrors apps/backend/src/utils/grouping.ts, for the dense lattice spacing.
const ASSUMED_WIDTH_PX = 402
const ASPECT = 2.2

function mercY(lat) {
  const phi = (lat * Math.PI) / 180
  return MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2))
}
function invMercY(y) {
  return ((2 * Math.atan(Math.exp(y / MERCATOR_RADIUS)) - Math.PI / 2) * 180) / Math.PI
}
function cellMeters(lngDelta) {
  const raw = (36 * lngDelta * METERS_PER_DEGREE) / ASSUMED_WIDTH_PX / 3
  return 3 * Math.min(8192, Math.pow(2, Math.ceil(Math.log(Math.max(raw, 1)) / Math.LN2 - 1e-9)))
}

const lat0 = Number(CENTER_LAT)
const lng0 = Number(CENTER_LNG)
const x0 = lng0 * METERS_PER_DEGREE
const y0 = mercY(lat0)
const points = []
function add(dx, dy) {
  points.push([invMercY(y0 + dy), (x0 + dx) / METERS_PER_DEGREE])
}

const FX = [-0.95, -0.75, -0.4, 0, 0.4, 0.75, 0.95]
const FY = [-1.2, -0.95, -0.75, -0.5, 0, 0.5, 0.75, 0.95, 1.2]
SPARSE_ZOOMS.split(",").map(Number).forEach(function (lngDelta) {
  const halfW = (lngDelta * METERS_PER_DEGREE) / 2
  const halfH = halfW * ASPECT
  FX.forEach(function (fx) {
    FY.forEach(function (fy) {
      // Edges and corners; the middle is covered by the other checks.
      if (Math.abs(fx) >= 0.75 || Math.abs(fy) >= 0.75) add(fx * halfW, fy * halfH)
    })
  })
})

const denseDelta = Number(DENSE_ZOOM)
const halfW = (denseDelta * METERS_PER_DEGREE) / 2
const step = 0.9 * cellMeters(denseDelta)
for (let dx = -1.05 * halfW; dx <= 1.05 * halfW; dx += step) {
  for (let dy = -1.2 * ASPECT * halfW; dy <= 1.2 * ASPECT * halfW; dy += step) {
    add(dx, dy)
  }
}

const headers = { "Content-Type": "application/json" }
const login = http.post(E2E_API_URL + "/api/auth/login", {
  headers: headers,
  body: JSON.stringify({ email: E2E_AUTHOR_EMAIL, password: E2E_AUTHOR_PASSWORD }),
})
const token = JSON.parse(login.body).access_token
if (!token) throw new Error("seed-grid: could not log in as the E2E author: " + login.body)

const stamp = new Date().getTime()
for (let i = 0; i < points.length; i++) {
  const res = http.post(E2E_API_URL + "/api/posts", {
    headers: Object.assign({ Authorization: "Bearer " + token }, headers),
    body: JSON.stringify({
      content: "e2e-grid-" + i + "-" + stamp,
      latitude: points[i][0],
      longitude: points[i][1],
      tags: [],
      locationAccuracy: 10,
      locationTimestamp: new Date().getTime(),
    }),
  })
  if (!JSON.parse(res.body).success) {
    throw new Error("seed-grid: API rejected post " + i + ": " + res.body)
  }
}
output.gridPosts = JSON.stringify(points)
console.log("seed-grid: created " + points.length + " posts around " + CENTER_LAT + ", " + CENTER_LNG)
