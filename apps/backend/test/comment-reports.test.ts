import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { authHeader } from "./helpers/fake-auth.js"
import { buildTestApp } from "./helpers/app.js"

// Reporting comments (#86), mirroring post reports (#24).

const POST = "11111111-1111-1111-1111-111111111111"
const COMMENT = "22222222-2222-2222-2222-222222222222"
const URL = `/api/posts/${POST}/comments/${COMMENT}/report`
const CREATED = "2026-09-27T12:00:00.000Z"

let app: FastifyInstance

beforeAll(async () => {
  ;({ app } = await buildTestApp("production"))
})
afterAll(() => app.close())

const report = (payload: object = { reason: "harassment" }, headers = authHeader("reporter")) =>
  app.inject({ method: "POST", url: URL, headers, payload })

const commentRow = (userId: string) =>
  fakeDb.when(/^select "id", "content", "user_id", "created_at" from "comments"/, [
    { id: COMMENT, content: "mean words", user_id: userId, created_at: CREATED },
  ])

describe("POST /api/posts/:postId/comments/:commentId/report", () => {
  it("requires auth", async () => {
    expect((await report(undefined, {})).statusCode).toBe(401)
  })

  it("rejects an unknown reason", async () => {
    expect((await report({ reason: "boring" })).statusCode).toBe(400)
  })

  it("404s for a comment that isn't on that post", async () => {
    expect((await report()).statusCode).toBe(404)
  })

  it("won't let you report your own comment", async () => {
    commentRow("reporter")
    expect((await report()).statusCode).toBe(403)
    expect(fakeDb.find(/^insert into "comment_reports"/)).toHaveLength(0)
  })

  it("stores a snapshot that outlives the comment", async () => {
    commentRow("commenter")

    const res = await report()

    expect(res.statusCode).toBe(200)
    const [lookup] = fakeDb.find(/from "comments"/)
    expect(lookup.parameters).toEqual([COMMENT, POST])
    const [insert] = fakeDb.find(/^insert into "comment_reports"/)
    expect(fakeDb.insertedValues(insert)).toEqual({
      comment_id: COMMENT,
      post_id: POST,
      reporter_user_id: "reporter",
      reason: "harassment",
      content_snapshot: "mean words",
      comment_user_id_snapshot: "commenter",
      comment_created_at_snapshot: CREATED,
    })
  })
})
