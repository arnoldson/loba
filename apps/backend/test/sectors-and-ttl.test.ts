import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { buildTestApp } from "./helpers/app.js"
import { PostService } from "../src/services/posts.js"
import {
  computeSectorGeometry,
  cellBounds,
  cellCenter,
  cellOf,
  getGroupingFactor,
  mercatorX,
  mercatorY,
} from "../src/utils/grouping.js"

// Seoul, at a typical phone-map zoom.
const VIEW = { lat: 37.5665, lng: 126.978, latDelta: 0.01, lngDelta: 0.005, widthPx: 390 }
const geometry = (o: Partial<typeof VIEW> = {}) => {
  const v = { ...VIEW, ...o }
  return computeSectorGeometry(v.lat, v.lng, v.latDelta, v.lngDelta, v.widthPx)
}

describe("TTL / archive behaviour", () => {
  const service = new PostService()

  it("archiveExpiredPosts archives only expired, not-yet-archived posts and reports the count", async () => {
    fakeDb.when(/^update "posts"/, [], 3n)

    const archived = await service.archiveExpiredPosts()

    expect(archived).toBe(3)
    const [update] = fakeDb.find(/^update "posts"/)
    expect(update.sql).toMatch(/"archived_at" = \$1/)
    expect(update.sql).toMatch(/"expires_at" <= \$2/)
    expect(update.sql).toMatch(/"archived_at" is null/)
  })

  it("map queries exclude archived and expired posts", async () => {
    const bounds = { minLat: 37, maxLat: 38, minLng: 126, maxLng: 127 }

    await service.getPostsInBounds(bounds)
    await service.getPostsInSector(bounds)
    await service.getPostDensity(VIEW.lat, VIEW.lng, VIEW.latDelta, VIEW.lngDelta, VIEW.widthPx)

    // Density is raw SQL (unquoted, uppercase), the others are Kysely-built.
    const reads = fakeDb.find(/from "?posts"?/i)
    expect(reads).toHaveLength(3)
    for (const q of reads) {
      expect(q.sql).toMatch(/archived_at"? is null/i)
      expect(q.sql).toMatch(/expires_at"? > /i)
    }
  })
})

describe("spatial queries use exact bounds, not just geography &&", () => {
  // On a geography column, && compares geocentric bounding boxes and also
  // matches points just outside a small lat/lng rectangle, so a sector's
  // list showed its neighbours' posts. Every spatial read must add the
  // half-open lat/lng range the density grid uses.
  const service = new PostService()
  const b = { minLat: 37.759, maxLat: 37.7595, minLng: -122.427, maxLng: -122.4265 }
  const exact = /latitude >= \$\d+ AND latitude < \$\d+\s+AND longitude >= \$\d+ AND longitude < \$\d+/

  it.each([
    ["sector list", () => service.getPostsInSector(b)],
    ["in-bounds", () => service.getPostsInBounds(b)],
    ["popular tags", () => service.getPopularTags(b, 20)],
    ["density", () => service.getPostDensity(VIEW.lat, VIEW.lng, VIEW.latDelta, VIEW.lngDelta, VIEW.widthPx)],
  ])("%s", async (_name, run) => {
    await run()
    const [query] = fakeDb.find(/ST_MakeEnvelope/)
    expect(query.sql).toMatch(exact)
  })

  it("passes the sector's own edges as the range", async () => {
    await service.getPostsInSector(b)
    const [query] = fakeDb.find(/ST_MakeEnvelope/)
    for (const edge of [b.minLat, b.maxLat, b.minLng, b.maxLng]) {
      expect(query.parameters).toContain(edge)
    }
  })
})

describe("sector geometry (#93: world-anchored Web Mercator grid)", () => {
  const SEOUL_POST = { lat: 37.5665, lng: 126.978 }
  const cellMeters = () => geometry().cellMeters

  it("picks a power-of-two grouping factor that grows as the viewport zooms out", () => {
    const near = getGroupingFactor(0.002, VIEW.widthPx)
    const far = getGroupingFactor(0.2, VIEW.widthPx)

    expect(Math.log2(near) % 1).toBe(0)
    expect(Math.log2(far) % 1).toBe(0)
    expect(far).toBeGreaterThan(near)
  })

  it("caps the grouping factor at city scale", () => {
    expect(getGroupingFactor(90, VIEW.widthPx)).toBe(8192)
  })

  it("reaches the cap exactly where the app's zoom-out lock engages, at any latitude", () => {
    // Mirrors apps/mobile/utils/tiles.ts's getMaxAllowedLongitudeDelta.
    const lock = ((8192 / 2) * 3 * VIEW.widthPx) / (36 * 111320)

    expect(getGroupingFactor(lock * 1.001, VIEW.widthPx)).toBe(8192)
    expect(getGroupingFactor(lock * 0.999, VIEW.widthPx)).toBe(4096)
  })

  it("gives the same cell size at the same zoom anywhere in the world", () => {
    const at = (lat: number, lng: number) =>
      computeSectorGeometry(lat, lng, VIEW.latDelta, VIEW.lngDelta, VIEW.widthPx).cellMeters

    const seoul = at(37.5665, 126.978)
    expect(at(-0.18, -78.47)).toBe(seoul) // Quito
    expect(at(71.2906, -156.7887)).toBe(seoul) // Utqiagvik
  })

  // The #93 bug: the old grid was rebuilt from each request's snapped
  // viewport, so crossing a snap step moved every column and marker.
  it("keeps a post in the same cell, with the same center, however the viewport pans", () => {
    const cell = cellOf(cellMeters(), SEOUL_POST.lat, SEOUL_POST.lng)
    const center = cellCenter(cellMeters(), cell.row, cell.col)

    for (let i = -20; i <= 20; i++) {
      const g = geometry({ lat: VIEW.lat + i * 0.0007, lng: VIEW.lng + i * 0.0011 })
      expect(g.cellMeters).toBe(cellMeters())
      expect(cellOf(g.cellMeters, SEOUL_POST.lat, SEOUL_POST.lng)).toEqual(cell)
      expect(cellCenter(g.cellMeters, cell.row, cell.col)).toEqual(center)
    }
  })

  it("nests each cell in exactly one cell of the next zoom step out", () => {
    const fine = cellMeters()
    const coarse = fine * 2
    const { row, col } = cellOf(coarse, SEOUL_POST.lat, SEOUL_POST.lng)
    const parent = cellBounds(coarse, row, col)

    const children = [0, 1].flatMap((r) =>
      [0, 1].map((c) => cellBounds(fine, row * 2 + r, col * 2 + c)),
    )
    expect(Math.min(...children.map((c) => c.minLat))).toBeCloseTo(parent.minLat, 10)
    expect(Math.max(...children.map((c) => c.maxLat))).toBeCloseTo(parent.maxLat, 10)
    expect(Math.min(...children.map((c) => c.minLng))).toBeCloseTo(parent.minLng, 10)
    expect(Math.max(...children.map((c) => c.maxLng))).toBeCloseTo(parent.maxLng, 10)
  })

  it("grows the query envelope to whole cells covering the viewport", () => {
    const g = geometry()
    const q = g.queryBounds

    expect(q.minLat).toBeLessThanOrEqual(VIEW.lat - VIEW.latDelta / 2)
    expect(q.maxLat).toBeGreaterThanOrEqual(VIEW.lat + VIEW.latDelta / 2)
    expect(q.minLng).toBeLessThanOrEqual(VIEW.lng - VIEW.lngDelta / 2)
    expect(q.maxLng).toBeGreaterThanOrEqual(VIEW.lng + VIEW.lngDelta / 2)

    for (const edge of [mercatorY(q.minLat), mercatorY(q.maxLat), mercatorX(q.minLng), mercatorX(q.maxLng)]) {
      expect(edge / g.cellMeters).toBeCloseTo(Math.round(edge / g.cellMeters), 6)
    }
  })

  it("tiles contiguously and centers each cell on screen", () => {
    const m = cellMeters()
    const c00 = cellBounds(m, 0, 0)
    const c01 = cellBounds(m, 0, 1)
    const c10 = cellBounds(m, 1, 0)

    expect(c01.minLng).toBeCloseTo(c00.maxLng, 10)
    expect(c10.minLat).toBeCloseTo(c00.maxLat, 10)

    const b = cellBounds(m, 5000, 3000)
    const center = cellCenter(m, 5000, 3000)
    expect(mercatorY(center.latitude)).toBeCloseTo((mercatorY(b.minLat) + mercatorY(b.maxLat)) / 2, 6)
    expect(center.longitude).toBeCloseTo((b.minLng + b.maxLng) / 2, 10)
  })

  it.each([
    ["Quito", -0.18],
    ["Seoul", 37.5665],
    ["Utqiagvik", 71.2906],
  ])("keeps cells square on screen at %s", (_name, lat) => {
    const m = cellMeters()
    const { row, col } = cellOf(m, lat, 0)
    const b = cellBounds(m, row, col)

    // On a Mercator map, on-screen size is Mercator size.
    const heightPx = mercatorY(b.maxLat) - mercatorY(b.minLat)
    const widthPx = mercatorX(b.maxLng) - mercatorX(b.minLng)
    expect(widthPx / heightPx).toBeCloseTo(1, 9)
  })
})

describe("POST /api/posts/density-in-bounds", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    ;({ app } = await buildTestApp("production"))
  })
  afterAll(() => app.close())

  const density = (payload: object) =>
    app.inject({ method: "POST", url: "/api/posts/density-in-bounds", payload })

  it("400s when viewport fields are missing", async () => {
    const res = await density({ latitude: 1, longitude: 1 })
    expect(res.statusCode).toBe(400)
  })

  it("returns each non-empty sector with its own bounds and center", async () => {
    fakeDb.when(/with sectors as/i, [{ row: "0", col: "1", count: "7", key_sum: "12345" }])

    const res = await density({
      latitude: VIEW.lat,
      longitude: VIEW.lng,
      latitudeDelta: VIEW.latDelta,
      longitudeDelta: VIEW.lngDelta,
      viewportWidthPx: VIEW.widthPx,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.groupingFactor).toBe(geometry().groupingFactor)
    expect(body.sectors).toHaveLength(1)
    expect(body.sectors[0]).toMatchObject({ key: "12345", count: 7 })
    expect(body.sectors[0].bounds).toEqual(cellBounds(geometry().cellMeters, 0, 1))
    expect(body.sectors[0].center).toEqual(cellCenter(geometry().cellMeters, 0, 1))
  })
})
