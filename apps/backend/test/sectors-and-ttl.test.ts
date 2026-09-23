import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { buildTestApp } from "./helpers/app.js"
import { PostService } from "../src/services/posts.js"
import {
  computeSectorGeometry,
  cellBounds,
  cellCenter,
  getGroupingFactor,
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

describe("sector geometry (#63, replaces the old tile_id math)", () => {
  it("picks a power-of-two grouping factor that grows as the viewport zooms out", () => {
    const near = getGroupingFactor(0.002, VIEW.lat, VIEW.widthPx)
    const far = getGroupingFactor(0.2, VIEW.lat, VIEW.widthPx)

    expect(Math.log2(near) % 1).toBe(0)
    expect(Math.log2(far) % 1).toBe(0)
    expect(far).toBeGreaterThan(near)
  })

  it("caps the grouping factor at city scale", () => {
    expect(getGroupingFactor(90, VIEW.lat, VIEW.widthPx)).toBe(4096)
  })

  it("agrees on sector boundaries across a small pan (marker/cache key stability)", () => {
    const a = geometry()
    const b = geometry({ lat: VIEW.lat + 0.0001, lng: VIEW.lng + 0.0001 })

    expect(b.groupingFactor).toBe(a.groupingFactor)
    expect(b.queryBounds).toEqual(a.queryBounds)
  })

  it("tiles the query envelope with contiguous, equal-sized cells", () => {
    const g = geometry()
    const c00 = cellBounds(g, 0, 0)
    const c01 = cellBounds(g, 0, 1)
    const c10 = cellBounds(g, 1, 0)

    expect(c01.minLng).toBeCloseTo(c00.maxLng, 10)
    expect(c10.minLat).toBeCloseTo(c00.maxLat, 10)
    expect(c00.minLat).toBeCloseTo(g.queryBounds.minLat, 10)
    expect(c00.minLng).toBeCloseTo(g.queryBounds.minLng, 10)

    const center = cellCenter(g, 0, 0)
    expect(center.latitude).toBeCloseTo((c00.minLat + c00.maxLat) / 2, 10)
    expect(center.longitude).toBeCloseTo((c00.minLng + c00.maxLng) / 2, 10)
  })

  it("makes cells roughly square in real meters at Seoul's latitude", () => {
    const g = geometry()
    const b = cellBounds(g, 0, 0)
    const heightM = (b.maxLat - b.minLat) * 111_320
    const widthM = (b.maxLng - b.minLng) * 111_320 * Math.cos((VIEW.lat * Math.PI) / 180)

    expect(widthM / heightM).toBeCloseTo(1, 1)
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
    expect(body.sectors[0].bounds).toEqual(cellBounds(geometry(), 0, 1))
    expect(body.sectors[0].center).toEqual(cellCenter(geometry(), 0, 1))
  })
})
