import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { authHeader } from "./helpers/fake-auth.js"
import { buildTestApp } from "./helpers/app.js"

// User-to-user blocking (#83). The filter's row-level behaviour is
// checked against real Postgres separately; these cover the routes and
// that every read path applies the filter.

const POST = "11111111-1111-1111-1111-111111111111"
const COMMENT = "22222222-2222-2222-2222-222222222222"

let app: FastifyInstance

beforeAll(async () => {
  ;({ app } = await buildTestApp("production"))
})
afterAll(() => app.close())

const insertedBlock = () => {
  const inserts = fakeDb.find(/^insert into "user_blocks"/)
  expect(inserts).toHaveLength(1)
  return fakeDb.insertedValues(inserts[0])
}

describe("POST /api/posts/:id/block-author", () => {
  const block = (headers: Record<string, string> = authHeader("viewer")) =>
    app.inject({ method: "POST", url: `/api/posts/${POST}/block-author`, headers })

  it("requires auth", async () => {
    expect((await block({})).statusCode).toBe(401)
  })

  it("resolves the author server-side and never returns who it was", async () => {
    fakeDb.when(/^select "user_id" from "posts"/, [{ user_id: "author" }])

    const res = await block()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    expect(res.body).not.toContain("author")
    expect(insertedBlock()).toMatchObject({
      blocker_user_id: "viewer",
      blocked_user_id: "author",
      post_id: POST,
    })
    expect(fakeDb.find(/^insert into "user_blocks"/)[0].sql).toMatch(/on conflict do nothing/)
  })

  it("rejects blocking yourself", async () => {
    fakeDb.when(/^select "user_id" from "posts"/, [{ user_id: "viewer" }])
    const res = await block()
    expect(res.statusCode).toBe(400)
    expect(fakeDb.find(/^insert into "user_blocks"/)).toHaveLength(0)
  })

  it("404s for a missing post", async () => {
    expect((await block()).statusCode).toBe(404)
  })

  it("410s when the post has no author left", async () => {
    fakeDb.when(/^select "user_id" from "posts"/, [{ user_id: null }])
    expect((await block()).statusCode).toBe(410)
  })
})

describe("POST /api/posts/:postId/comments/:commentId/block-author", () => {
  it("blocks the comment's author, scoped to that post", async () => {
    fakeDb.when(/^select "user_id" from "comments"/, [{ user_id: "commenter" }])

    const res = await app.inject({
      method: "POST",
      url: `/api/posts/${POST}/comments/${COMMENT}/block-author`,
      headers: authHeader("viewer"),
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain("commenter")
    const [lookup] = fakeDb.find(/^select "user_id" from "comments"/)
    expect(lookup.parameters).toEqual([COMMENT, POST])
    expect(insertedBlock()).toMatchObject({
      blocked_user_id: "commenter",
      comment_id: COMMENT,
    })
  })
})

describe("Settings: count and unblock all", () => {
  it("counts distinct blocked authors for the caller only", async () => {
    fakeDb.when(/count\(DISTINCT blocked_user_id\)/, [{ count: "3" }])
    const res = await app.inject({ method: "GET", url: "/api/blocks/count", headers: authHeader("viewer") })
    expect(res.json()).toEqual({ success: true, count: 3 })
    expect(fakeDb.find(/count\(DISTINCT/)[0].parameters).toEqual(["viewer"])
  })

  it("unblock all deletes only the caller's blocks", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/blocks", headers: authHeader("viewer") })
    expect(res.statusCode).toBe(200)
    const [del] = fakeDb.find(/^delete from "user_blocks"/)
    expect(del.sql).toMatch(/where "blocker_user_id" = \$1$/)
    expect(del.parameters).toEqual(["viewer"])
  })
})

describe("read paths apply the block filter for signed-in viewers", () => {
  const box = { minLat: 37.5, maxLat: 37.51, minLng: 127, maxLng: 127.01 }
  const reads = {
    density: (headers = {}) =>
      app.inject({
        method: "POST",
        url: "/api/posts/density-in-bounds",
        headers,
        payload: { latitude: 37.5, longitude: 127, latitudeDelta: 0.01, longitudeDelta: 0.01, viewportWidthPx: 390 },
      }),
    "sector posts": (headers = {}) =>
      app.inject({ method: "POST", url: "/api/posts/by-bounds", headers, payload: box }),
    "in-bounds": (headers = {}) =>
      app.inject({ method: "POST", url: "/api/posts/in-bounds", headers, payload: box }),
    "single post": (headers = {}) =>
      app.inject({ method: "GET", url: `/api/posts/${POST}`, headers }),
    comments: (headers = {}) =>
      app.inject({ method: "GET", url: `/api/posts/${POST}/comments`, headers }),
  }

  const blockFilterQueries = () =>
    fakeDb.find(/not exists \(\s*select 1 from user_blocks b/i)

  it.each(Object.entries(reads))("%s: filtered with the viewer's id", async (_name, read) => {
    await read(authHeader("viewer"))
    const [query] = blockFilterQueries()
    expect(query).toBeDefined()
    expect(query.parameters).toContain("viewer")
  })

  it.each(Object.entries(reads))("%s: no filter when signed out", async (_name, read) => {
    await read()
    expect(blockFilterQueries()).toHaveLength(0)
  })
})
