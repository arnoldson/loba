import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { authHeader } from "./helpers/fake-auth.js"
import { buildTestApp } from "./helpers/app.js"

const HOUR = 60 * 60 * 1000

// Seoul City Hall. 127.0.0.1 (inject's default) has no geo record, so it
// counts as "consistent"; 8.8.8.8 geolocates to the US, ~9,000km away.
const SEOUL = { latitude: 37.5665, longitude: 126.978 }

const validBody = (overrides: Record<string, unknown> = {}) => ({
  content: "hello loba",
  ...SEOUL,
  tags: ["Coffee", "coffee", "Seoul"],
  locationAccuracy: 10,
  locationTimestamp: Date.now(),
  ...overrides,
})

const storedRow = (overrides: Record<string, unknown> = {}) => ({
  id: "post-1",
  user_id: "author",
  content: "hello loba",
  photo_url: null,
  ...SEOUL,
  tags: ["coffee", "seoul"],
  comment_count: 0,
  upvote_count: 0,
  downvote_count: 0,
  expires_at: new Date(Date.now() + 24 * HOUR).toISOString(),
  archived_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  flagged_ip_mismatch: false,
  ...overrides,
})

describe("POST /api/posts", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    ;({ app } = await buildTestApp("production"))
  })
  afterAll(() => app.close())

  const create = (body: unknown, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/posts",
      headers: authHeader("author"),
      payload: body as object,
      ...extra,
    })

  const insertedPost = () => {
    const inserts = fakeDb.find(/^insert into "posts"/)
    expect(inserts).toHaveLength(1)
    return fakeDb.insertedValues(inserts[0])
  }

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "POST", url: "/api/posts", payload: validBody() })
    expect(res.statusCode).toBe(401)
    expect(fakeDb.find(/^insert into "posts"/)).toHaveLength(0)
  })

  it("requires locationAccuracy and locationTimestamp", async () => {
    const res = await create(validBody({ locationAccuracy: undefined }))
    expect(res.statusCode).toBe(400)
    expect(fakeDb.find(/^insert into "posts"/)).toHaveLength(0)
  })

  it.each([
    ["a stale reading", { locationTimestamp: Date.now() - 2 * 60_000 }],
    ["a timestamp from the future", { locationTimestamp: Date.now() + 60_000 }],
    ["an imprecise reading", { locationAccuracy: 500 }],
    ["a zero accuracy", { locationAccuracy: 0 }],
  ])("rejects %s with 403 and writes nothing", async (_label, override) => {
    const res = await create(validBody(override))
    expect(res.statusCode).toBe(403)
    expect(res.json().success).toBe(false)
    expect(fakeDb.find(/^insert into "posts"/)).toHaveLength(0)
  })

  it("stores the post with a 24h TTL, normalized tags and the caller as author", async () => {
    fakeDb.when(/^insert into "posts"/, [storedRow()])

    const before = Date.now()
    const res = await create(validBody())
    const after = Date.now()

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)

    const values = insertedPost()
    expect(values.user_id).toBe("author")
    expect(values.content).toBe("hello loba")
    expect(values.latitude).toBe(SEOUL.latitude)
    expect(values.longitude).toBe(SEOUL.longitude)
    expect(values.tags).toEqual(["coffee", "seoul"]) // lowercased + deduped
    expect(values.archived_at).toBeNull()

    const expiresAt = new Date(values.expires_at as string).getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 24 * HOUR)
    expect(expiresAt).toBeLessThanOrEqual(after + 24 * HOUR)
  })

  it("flags a post whose claimed location contradicts the request IP", async () => {
    fakeDb.when(/^insert into "posts"/, [storedRow()])

    const res = await create(validBody(), { remoteAddress: "8.8.8.8" })

    expect(res.statusCode).toBe(200)
    expect(insertedPost().flagged_ip_mismatch).toBe(true)
  })

  it("does not flag a post when the IP can't be geolocated", async () => {
    fakeDb.when(/^insert into "posts"/, [storedRow()])

    await create(validBody())

    expect(insertedPost().flagged_ip_mismatch).toBe(false)
  })

  it("never leaks the moderation flag to the author, even when set", async () => {
    fakeDb.when(/^insert into "posts"/, [storedRow({ flagged_ip_mismatch: true })])

    const res = await create(validBody())

    expect(res.json().post).not.toHaveProperty("flagged_ip_mismatch")
  })
})

describe("GET /api/posts/:id", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    ;({ app } = await buildTestApp("production"))
  })
  afterAll(() => app.close())

  it("404s when the post is missing or archived, and asks the DB to exclude archived rows", async () => {
    const res = await app.inject({ method: "GET", url: "/api/posts/some-id" })

    expect(res.statusCode).toBe(404)
    const [select] = fakeDb.find(/^select .* from "posts"/)
    expect(select.sql).toMatch(/"archived_at" is null/)
  })

  it("strips author identity and moderation flags from a public post", async () => {
    fakeDb.when(/^select .* from "posts"/, [storedRow({ flagged_ip_mismatch: true })])

    const res = await app.inject({ method: "GET", url: "/api/posts/post-1" })

    expect(res.statusCode).toBe(200)
    const { post } = res.json()
    expect(post).not.toHaveProperty("user_id")
    expect(post).not.toHaveProperty("flagged_ip_mismatch")
    expect(post.is_own).toBe(false)
  })

  it("marks the post is_own for its author", async () => {
    fakeDb.when(/^select .* from "posts"/, [storedRow()])

    const res = await app.inject({
      method: "GET",
      url: "/api/posts/post-1",
      headers: authHeader("author"),
    })

    expect(res.json().post.is_own).toBe(true)
  })
})
