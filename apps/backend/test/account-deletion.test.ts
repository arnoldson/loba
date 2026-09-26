import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { authHeader } from "./helpers/fake-auth.js"

// account.ts reads DELETED_USER_ID at import time, so set it before the
// app (and with it the service) is loaded.
const SENTINEL = "00000000-0000-0000-0000-00000000dead"
vi.stubEnv("DELETED_USER_ID", SENTINEL)
const { buildTestApp } = await import("./helpers/app.js")

describe("DELETE /api/account", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    ;({ app } = await buildTestApp("production"))
  })
  afterAll(() => app.close())

  it("reassigns content to the sentinel and deletes the user's IP history", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/account",
      headers: authHeader("leaving-user"),
    })

    expect(res.statusCode).toBe(200)

    for (const table of ["posts", "comments"]) {
      const [update] = fakeDb.find(new RegExp(`^update "${table}"`))
      expect(update.parameters).toEqual([SENTINEL, "leaving-user"])
    }
    const [ipDelete] = fakeDb.find(/^delete from "user_ip_log"/)
    expect(ipDelete.parameters).toEqual(["leaving-user"])
  })
})
