// Seeds the local stack with posts for the map captures (see README.md here).
//
//   node scripts/local-env/seed.mjs            # against http://localhost:3000
//
// Run it while a pre-#63 backend (the 726dd22 worktree) is up, so every post
// also gets a tile_id -- post-#63 backends ignore the column, so the same
// posts then show up identically at every commit.
//
// Around Seoul (37.5665, 126.9780) and 80°N (Arctic Ocean, -150.0), it posts:
//  - the fixed 20-post spread the marker-stability flows use
//    (apps/mobile/.maestro/scripts/seed-spread.js), and
//  - a lattice every 40m from 80m west to 160m east and 280m south to north,
//    filling most of the launch view and its pans, so the grid outline shows
//    many cells side by side. It stops short on the west so the left edge of
//    the screen stays clear: the capture flows double-tap there to zoom in,
//    and a tap on a marker would open its post list instead.
// Refuses to run against anything but localhost.

const API = process.env.LOCAL_API_URL ?? "http://localhost:3000"
const EMAIL = "capture-author@loba.local"
const PASSWORD = "local-capture-pass"
const METERS_PER_DEGREE = 111320

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) {
  console.error(`seed: refusing to seed ${API} -- local backends only`)
  process.exit(1)
}

const CENTERS = [
  { name: "Seoul", lat: 37.5665, lng: 126.978 },
  { name: "80N", lat: 80.0, lng: -150.0 },
]

// Same offsets as seed-spread.js: [north, east] in meters.
const SPREAD = [
  [-220, -50], [-200, 40], [-160, 0], [-150, 5], [-110, -30],
  [-70, 55], [-40, -45], [-35, -40], [-10, 20], [25, -10],
  [30, 50], [60, -55], [90, 15], [95, 20], [100, 25],
  [130, -20], [165, 45], [190, -35], [210, 10], [220, -5],
]
const LATTICE = []
for (let north = -280; north <= 280; north += 40) {
  for (let east = -80; east <= 160; east += 40) LATTICE.push([north, east])
}

const login = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
const { access_token: token } = await login.json()
if (!token) {
  console.error("seed: couldn't log in -- run scripts/local-env/setup.sh first")
  process.exit(1)
}

for (const c of CENTERS) {
  const cos = Math.cos((c.lat * Math.PI) / 180)
  let created = 0
  for (const [i, [north, east]] of [...SPREAD, ...LATTICE].entries()) {
    const res = await fetch(`${API}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        content: `local-${c.name}-${i}`,
        tags: [],
        latitude: c.lat + north / METERS_PER_DEGREE,
        longitude: c.lng + east / (METERS_PER_DEGREE * cos),
        // Required since #43, ignored by older backends.
        locationAccuracy: 10,
        locationTimestamp: Date.now(),
      }),
    })
    if (!res.ok) {
      console.error(`seed: post ${i} at ${c.name} failed (HTTP ${res.status}): ${await res.text()}`)
      process.exit(1)
    }
    created++
  }
  console.log(`seed: ${created} posts around ${c.name}`)
}
