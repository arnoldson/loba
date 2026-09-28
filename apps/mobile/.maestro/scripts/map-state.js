// Checks for the marker-stability flows (#93), run against the map's E2E
// readout (components/E2EMapState.tsx). Before calling this, the flow copies
// the readout with `copyTextFrom: id: e2e-map-state`.
//
// ACTION=capture NAME=<name>
//   Parses the readout, stores it as output[NAME], and checks that cell size
//   depends only on zoom: every sector is a square exactly 3·g Web Mercator
//   meters on a side, and g is what the zoom alone calls for.
// ACTION=check NAME=<new> BASE=<old> EXPECT=pan|zoom-in|same
//   Checks the two snapshots describe one world-anchored grid -- at the same
//   grouping factor, cells are identical (same bounds, same posts, same
//   center) or don't overlap at all; across a zoom step, each small cell sits
//   inside exactly one big one. EXPECT adds what the gesture should have done.
//
// The Mercator constants and grouping-factor formula mirror
// apps/backend/src/utils/grouping.ts.

const METERS_PER_DEGREE = 111320
const MERCATOR_RADIUS = (METERS_PER_DEGREE * 180) / Math.PI
const TILE_SIZE_METERS = 3
const MARKER_SIZE_PX = 36
const CITY_CAP_GROUPING_FACTOR = 8192

// Same Math.log2 as the server where the JS engine has it, so the
// power-of-two rounding lands identically.
const log2 = Math.log2 || function (x) { return Math.log(x) / Math.LN2 }

function fail(msg) {
  throw new Error("map-state (" + NAME + "): " + msg)
}

function mercY(lat) {
  const phi = (lat * Math.PI) / 180
  return MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2))
}

function expectedGroupingFactor(longitudeDelta, widthPx) {
  const metersPerPixel = (longitudeDelta * METERS_PER_DEGREE) / widthPx
  const rawFactor = (MARKER_SIZE_PX * metersPerPixel) / TILE_SIZE_METERS
  const factor = Math.pow(2, Math.ceil(log2(Math.max(rawFactor, 1))))
  return Math.min(CITY_CAP_GROUPING_FACTOR, Math.max(1, factor))
}

function parse(text) {
  const space = text.indexOf(" ")
  if (text.indexOf("n=") !== 0 || space < 0) fail("unexpected readout: " + text)
  const snap = JSON.parse(text.slice(space + 1))
  snap.n = Number(text.slice(2, space))
  snap.sectors = snap.s.map(function (s) {
    return {
      key: s[0], count: s[1], lat: s[2], lng: s[3],
      minLat: s[4], maxLat: s[5], minLng: s[6], maxLng: s[7],
    }
  })
  return snap
}

function close(a, b, tol) {
  return Math.abs(a - b) <= tol
}

function sameCell(a, b) {
  return a.minLat === b.minLat && a.maxLat === b.maxLat &&
    a.minLng === b.minLng && a.maxLng === b.maxLng
}

// Overlap with positive area (touching edges don't count).
function overlaps(a, b) {
  const eps = 1e-12
  return a.minLat < b.maxLat - eps && b.minLat < a.maxLat - eps &&
    a.minLng < b.maxLng - eps && b.minLng < a.maxLng - eps
}

function contains(outer, inner) {
  const eps = 1e-9
  return inner.minLat >= outer.minLat - eps && inner.maxLat <= outer.maxLat + eps &&
    inner.minLng >= outer.minLng - eps && inner.maxLng <= outer.maxLng + eps
}

function capture() {
  const snap = parse(maestro.copiedText)
  if (!snap.r) fail("no fetch has completed yet")
  if (snap.sectors.length === 0) fail("no markers in view -- the seeded posts should be")

  const lngDelta = snap.r[3]
  const expected = expectedGroupingFactor(lngDelta, snap.w)
  if (snap.g !== expected) {
    fail("grouping factor " + snap.g + " but the zoom (longitudeDelta " + lngDelta +
      " over " + snap.w + "px) calls for " + expected + " -- cell size depends on more than zoom")
  }

  const cell = snap.g * TILE_SIZE_METERS
  snap.sectors.forEach(function (s) {
    const width = (s.maxLng - s.minLng) * METERS_PER_DEGREE
    const height = mercY(s.maxLat) - mercY(s.minLat)
    if (!close(width, cell, 1e-6) || !close(height, cell, 1e-6)) {
      fail("sector " + s.key + " is " + width + " x " + height +
        " Mercator m, expected a " + cell + " m square")
    }
    const midY = (mercY(s.minLat) + mercY(s.maxLat)) / 2
    if (!close(mercY(s.lat), midY, 1e-6) || !close(s.lng, (s.minLng + s.maxLng) / 2, 1e-12)) {
      fail("sector " + s.key + "'s marker isn't at its cell's on-screen center")
    }
  })

  const cellPx = cell / ((lngDelta * METERS_PER_DEGREE) / snap.w)
  console.log("map-state " + NAME + ": n=" + snap.n + " g=" + snap.g + " cell=" +
    cellPx.toFixed(1) + "px sectors=" + snap.sectors.length +
    " center=" + snap.r[0].toFixed(6) + "," + snap.r[1].toFixed(6))

  output[NAME] = maestro.copiedText
  output.lastN = String(snap.n)
}

function check() {
  const a = parse(output[BASE])
  const b = parse(output[NAME])

  if (EXPECT === "pan" || EXPECT === "same") {
    if (b.g !== a.g) fail(EXPECT + " changed the grouping factor " + a.g + " -> " + b.g)
  }
  if (EXPECT === "pan" && a.r[0] === b.r[0] && a.r[1] === b.r[1]) {
    fail("the pan didn't move the map (both snapshots are for the same region)")
  }
  if (EXPECT === "zoom-in" && !(b.g < a.g)) {
    fail("zooming in didn't shrink the cells (g " + a.g + " -> " + b.g + ")")
  }

  let matched = 0
  if (a.g === b.g) {
    a.sectors.forEach(function (x) {
      b.sectors.forEach(function (y) {
        if (x.key === y.key && (x.lat !== y.lat || x.lng !== y.lng)) {
          fail("marker " + x.key + " moved: " + x.lat + "," + x.lng + " -> " + y.lat + "," + y.lng)
        }
        if (!overlaps(x, y)) return
        if (!sameCell(x, y)) {
          fail("cells overlap without matching -- the grid shifted: " +
            JSON.stringify(x) + " vs " + JSON.stringify(y))
        }
        if (x.key !== y.key || x.count !== y.count) {
          fail("the same cell holds different posts: " + JSON.stringify(x) + " vs " + JSON.stringify(y))
        }
        matched++
      })
    })
    if (matched === 0) fail("no cell is in both snapshots, so nothing was compared")
  } else {
    const coarse = a.g > b.g ? a : b
    const fine = a.g > b.g ? b : a
    const ratio = coarse.g / fine.g
    if (Math.pow(2, Math.round(log2(ratio))) !== ratio) fail("grouping factors " + a.g + " and " + b.g + " don't nest")
    fine.sectors.forEach(function (f) {
      coarse.sectors.forEach(function (c) {
        if (!overlaps(f, c)) return
        if (!contains(c, f)) {
          fail("a small cell straddles a big one -- the zoom levels' grids don't nest: " +
            JSON.stringify(f) + " vs " + JSON.stringify(c))
        }
        matched++
      })
    })
    if (matched === 0) fail("no small cell falls inside a big one, so nothing was compared")
  }
  console.log("map-state " + NAME + " vs " + BASE + " (" + EXPECT + "): " + matched + " cell(s) compared, all consistent")
}

if (ACTION === "capture") capture()
else if (ACTION === "check") check()
else fail("unknown ACTION " + ACTION)
