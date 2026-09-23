import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { authHeader } from "./helpers/fake-auth.js"
import { buildTestApp } from "./helpers/app.js"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const POST_AT = { latitude: 37.5665, longitude: 126.978 }
// ~1 degree of latitude is ~111,320m, so 0.0004 deg ~ 44m and 0.0006 deg ~ 67m
// (the gate is 50m).
const NEAR = { latitude: POST_AT.latitude + 0.0004, longitude: POST_AT.longitude }
const FAR = { latitude: POST_AT.latitude + 0.0006, longitude: POST_AT.longitude }

const postRow = (overrides: Record<string, unknown> = {}) => {
  const created = Date.now() - 2 * HOUR
  return {
    id: "post-1",
    user_id: "author",
    ...POST_AT,
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + DAY).toISOString(),
    archived_at: null,
    upvote_count: 3,
    downvote_count: 1,
    ...overrides,
  }
}

describe("POST /api/posts/:id/react", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    ;({ app } = await buildTestApp("production"))
  })
  afterAll(() => app.close())

  const react = (
    body: Record<string, unknown>,
    { user = "reactor", id = "post-1" } = {},
  ) =>
    app.inject({
      method: "POST",
      url: `/api/posts/${id}/react`,
      headers: authHeader(user),
      payload: {
        reaction: "upvote",
        ...NEAR,
        locationAccuracy: 10,
        locationTimestamp: Date.now(),
        ...body,
      },
    })

  const wrote = (re: RegExp) => fakeDb.find(re).length > 0

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/posts/post-1/react",
      payload: { reaction: "upvote" },
    })
    expect(res.statusCode).toBe(401)
  })

  describe("input validation", () => {
    it.each([
      ["a missing reaction", { reaction: undefined }],
      ["an unknown reaction", { reaction: "love" }],
      ["missing coordinates", { latitude: undefined, longitude: undefined }],
      ["missing location quality fields", { locationAccuracy: undefined }],
    ])("400s on %s", async (_label, override) => {
      const res = await react(override)
      expect(res.statusCode).toBe(400)
      expect(res.json().success).toBe(false)
      expect(fakeDb.find(/from "posts"/)).toHaveLength(0)
    })

    it("403s a stale location reading before touching the DB", async () => {
      const res = await react({ locationTimestamp: Date.now() - 2 * 60_000 })
      expect(res.statusCode).toBe(403)
      expect(fakeDb.find(/from "posts"/)).toHaveLength(0)
    })
  })

  describe("post state", () => {
    it("404s for a post that doesn't exist", async () => {
      const res = await react({})
      expect(res.statusCode).toBe(404)
    })

    it("410s for an archived post", async () => {
      fakeDb.when(/^select .* from "posts"/, [postRow({ archived_at: new Date().toISOString() })])
      const res = await react({})
      expect(res.statusCode).toBe(410)
      expect(wrote(/^insert into "post_reactions"/)).toBe(false)
    })

    it("refuses to let an author react to their own post", async () => {
      fakeDb.when(/^select .* from "posts"/, [postRow()])
      const res = await react({}, { user: "author" })
      expect(res.json().success).toBe(false)
      expect(wrote(/^insert into "post_reactions"/)).toBe(false)
    })
  })

  describe("proximity gate (50m)", () => {
    beforeAll(() => {})

    it("accepts a reaction from within range", async () => {
      fakeDb.when(/^select .* from "posts"/, [postRow()])

      const res = await react(NEAR)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ success: true, reaction: "upvote", upvote_count: 4 })
      expect(wrote(/^insert into "post_reactions"/)).toBe(true)
    })

    it("rejects a reaction from out of range with 403 and records nothing", async () => {
      fakeDb.when(/^select .* from "posts"/, [postRow()])

      const res = await react(FAR)

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toMatch(/near this post/)
      expect(wrote(/^insert into "post_reactions"/)).toBe(false)
      expect(wrote(/^update "posts"/)).toBe(false)
    })

    it("gates on the post's coordinates even when they arrive as strings (pg numerics)", async () => {
      fakeDb.when(/^select .* from "posts"/, [
        postRow({ latitude: String(POST_AT.latitude), longitude: String(POST_AT.longitude) }),
      ])

      expect((await react(NEAR)).statusCode).toBe(200)
      fakeDb.reset()
      fakeDb.when(/^select .* from "posts"/, [
        postRow({ latitude: String(POST_AT.latitude), longitude: String(POST_AT.longitude) }),
      ])
      expect((await react(FAR)).statusCode).toBe(403)
    })
  })

  describe("reaction toggling and TTL", () => {
    it("extends the TTL by 2h on an upvote", async () => {
      const row = postRow()
      fakeDb.when(/^select .* from "posts"/, [row])

      const res = await react({})

      const expected = new Date(row.expires_at).getTime() + 2 * HOUR
      expect(new Date(res.json().new_expires_at).getTime()).toBe(expected)
      const [update] = fakeDb.find(/^update "posts"/)
      expect(update.parameters).toContain(new Date(expected).toISOString())
    })

    it("caps the extended TTL at 7 days from creation", async () => {
      const created = Date.now() - 6.9 * DAY
      const row = postRow({
        created_at: new Date(created).toISOString(),
        expires_at: new Date(created + 6.9 * DAY + HOUR).toISOString(), // already 1h out
      })
      fakeDb.when(/^select .* from "posts"/, [row])

      const res = await react({})

      // +2h would overshoot the cap, so it clamps to created + 7d
      expect(new Date(res.json().new_expires_at).getTime()).toBe(created + 7 * DAY)
    })

    it("does not extend the TTL on a downvote", async () => {
      const row = postRow()
      fakeDb.when(/^select .* from "posts"/, [row])

      const res = await react({ reaction: "downvote" })

      expect(res.json()).toMatchObject({ reaction: "downvote", downvote_count: 2 })
      expect(new Date(res.json().new_expires_at).getTime()).toBe(
        new Date(row.expires_at).getTime(),
      )
    })

    it("toggles off when the same reaction is sent twice, without touching the TTL", async () => {
      const row = postRow()
      fakeDb.when(/^select .* from "posts"/, [row])
      fakeDb.when(/^select .* from "post_reactions"/, [{ id: "r1", reaction: "upvote" }])

      const res = await react({ reaction: "upvote" })

      expect(res.json()).toMatchObject({ reaction: null, upvote_count: 2 })
      expect(new Date(res.json().new_expires_at).getTime()).toBe(
        new Date(row.expires_at).getTime(),
      )
      expect(wrote(/^delete from "post_reactions"/)).toBe(true)
    })

    it("switching downvote -> upvote moves both counts and extends the TTL", async () => {
      const row = postRow()
      fakeDb.when(/^select .* from "posts"/, [row])
      fakeDb.when(/^select .* from "post_reactions"/, [{ id: "r1", reaction: "downvote" }])

      const res = await react({ reaction: "upvote" })

      expect(res.json()).toMatchObject({ reaction: "upvote", upvote_count: 4, downvote_count: 0 })
      expect(new Date(res.json().new_expires_at).getTime()).toBe(
        new Date(row.expires_at).getTime() + 2 * HOUR,
      )
    })

    it("never lets a denormalized count go negative", async () => {
      fakeDb.when(/^select .* from "posts"/, [postRow({ upvote_count: 0 })])
      fakeDb.when(/^select .* from "post_reactions"/, [{ id: "r1", reaction: "upvote" }])

      const res = await react({ reaction: "upvote" })

      expect(res.json().upvote_count).toBe(0)
    })
  })
})
