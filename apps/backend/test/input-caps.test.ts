import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import {
  MAX_BBOX_SPAN_DEGREES,
  MAX_COMMENT_LENGTH,
  MAX_POST_LENGTH,
  MAX_FILTER_TAGS,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_POST,
} from "@loba/shared"
import { fakeDb } from "./helpers/fake-db.js"
import { authHeader } from "./helpers/fake-auth.js"
import { buildTestApp } from "./helpers/app.js"

// Input caps (#76): every rejection must happen before any write, and
// the spatial ones before any query runs.

const SEOUL = { latitude: 37.5665, longitude: 126.978 }
const tagList = (n: number) => Array.from({ length: n }, (_, i) => `#tag${i}`)
const noQueries = () => expect(fakeDb.find(/.*/)).toHaveLength(0)

let app: FastifyInstance

beforeAll(async () => {
  ;({ app } = await buildTestApp("production"))
})
afterAll(() => app.close())

describe("POST /api/posts content length", () => {
  const create = (content: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/posts",
      headers: authHeader("author"),
      payload: {
        content,
        ...SEOUL,
        tags: [],
        locationAccuracy: 10,
        locationTimestamp: Date.now(),
      },
    })

  it.each([
    ["content over the length cap", "a".repeat(MAX_POST_LENGTH + 1)],
    ["blank content", "   "],
    ["missing content", undefined],
    ["non-string content", 42],
  ])("rejects %s with 400 and writes nothing", async (_label, content) => {
    const res = await create(content)
    expect(res.statusCode).toBe(400)
    expect(fakeDb.find(/^insert into "posts"/)).toHaveLength(0)
  })

  it("accepts content exactly at the cap", async () => {
    fakeDb.when(/^insert into "posts"/, [{ id: "post-1", tags: [] }])

    const res = await create("a".repeat(MAX_POST_LENGTH))

    expect(res.statusCode).toBe(200)
  })
})

describe("POST /api/posts/:postId/comments content length", () => {
  const comment = (content: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/posts/post-1/comments",
      headers: authHeader("commenter"),
      payload: { content, ...SEOUL, locationAccuracy: 10, locationTimestamp: Date.now() },
    })

  it.each([
    ["content over the length cap", "a".repeat(MAX_COMMENT_LENGTH + 1)],
    ["non-string content", 42],
  ])("rejects %s with 400 and writes nothing", async (_label, content) => {
    const res = await comment(content)
    expect(res.statusCode).toBe(400)
    expect(fakeDb.find(/^insert into "comments"/)).toHaveLength(0)
  })
})

describe("POST /api/posts tag caps", () => {
  const create = (tags: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/posts",
      headers: authHeader("author"),
      payload: {
        content: "hello loba",
        ...SEOUL,
        tags,
        locationAccuracy: 10,
        locationTimestamp: Date.now(),
      },
    })

  it.each([
    ["too many tags", tagList(MAX_TAGS_PER_POST + 1)],
    ["a tag over the length cap", [`#${"a".repeat(MAX_TAG_LENGTH + 1)}`]],
    ["tags that aren't an array", "#coffee"],
    ["non-string tags", [42]],
    ["missing tags", undefined],
  ])("rejects %s with 400 and writes nothing", async (_label, tags) => {
    const res = await create(tags)
    expect(res.statusCode).toBe(400)
    expect(res.json().success).toBe(false)
    expect(fakeDb.find(/^insert into "posts"/)).toHaveLength(0)
  })

  it("accepts exactly the caps, counting the tag without its '#'", async () => {
    fakeDb.when(/^insert into "posts"/, [{ id: "post-1", tags: [] }])

    const tags = [...tagList(MAX_TAGS_PER_POST - 1), `#${"a".repeat(MAX_TAG_LENGTH)}`]
    const res = await create(tags)

    expect(res.statusCode).toBe(200)
  })

  it("counts case-duplicates once, the way they're stored", async () => {
    fakeDb.when(/^insert into "posts"/, [{ id: "post-1", tags: [] }])

    const tags = [...tagList(MAX_TAGS_PER_POST), "#TAG0", "#Tag1"]
    const res = await create(tags)

    expect(res.statusCode).toBe(200)
  })
})

describe("spatial route caps", () => {
  const box = (span: number) => ({
    minLat: SEOUL.latitude,
    maxLat: SEOUL.latitude + span,
    minLng: SEOUL.longitude,
    maxLng: SEOUL.longitude + span,
  })
  const viewport = (span: number) => ({
    ...SEOUL,
    latitudeDelta: span,
    longitudeDelta: span,
    viewportWidthPx: 390,
  })

  const routes = {
    "in-bounds": (span: number, tags?: string[]) =>
      app.inject({ method: "POST", url: "/api/posts/in-bounds", payload: { ...box(span), tags } }),
    "by-bounds": (span: number, tags?: string[]) =>
      app.inject({ method: "POST", url: "/api/posts/by-bounds", payload: { ...box(span), tags } }),
    "density-in-bounds": (span: number, tags?: string[]) =>
      app.inject({ method: "POST", url: "/api/posts/density-in-bounds", payload: { ...viewport(span), tags } }),
  }

  describe.each(Object.entries(routes))("%s", (_name, call) => {
    it("rejects a bbox over the span cap", async () => {
      const res = await call(MAX_BBOX_SPAN_DEGREES + 0.01)
      expect(res.statusCode).toBe(400)
      noQueries()
    })

    it("rejects too many filter tags", async () => {
      const res = await call(0.01, tagList(MAX_FILTER_TAGS + 1))
      expect(res.statusCode).toBe(400)
      noQueries()
    })

    it("accepts a bbox at the span cap with the max filter tags", async () => {
      const res = await call(MAX_BBOX_SPAN_DEGREES, tagList(MAX_FILTER_TAGS))
      expect(res.statusCode).toBe(200)
    })
  })

  it("rejects a reversed bbox whose span is over the cap", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/posts/in-bounds",
      payload: { minLat: 0, maxLat: 1, minLng: 170, maxLng: -170 },
    })
    expect(res.statusCode).toBe(400)
    noQueries()
  })

  it("GET /api/tags/popular rejects a bbox over the span cap", async () => {
    const b = box(MAX_BBOX_SPAN_DEGREES + 0.01)
    const res = await app.inject({
      method: "GET",
      url: "/api/tags/popular",
      query: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v)])),
    })
    expect(res.statusCode).toBe(400)
    noQueries()
  })

  it("clamps an oversized in-bounds limit", async () => {
    await app.inject({
      method: "POST",
      url: "/api/posts/in-bounds",
      payload: { ...box(0.01), limit: 1_000_000 },
    })
    const [query] = fakeDb.find(/from "posts"/)
    expect(query.parameters).toContain(5000)
    expect(query.parameters).not.toContain(1_000_000)
  })
})
