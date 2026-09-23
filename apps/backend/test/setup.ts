/**
 * Swap the two external boundaries (Postgres, Supabase Auth) for
 * in-process fakes so functional tests can drive the real Fastify app
 * through inject() with no network and no database.
 */
import { vi, beforeEach } from "vitest"
import { fakeDb } from "./helpers/fake-db.js"

vi.mock("../src/db/index.js", () => ({ db: fakeDb.db }))

vi.mock("@supabase/supabase-js", async () => {
  const { getUser } = await import("./helpers/fake-auth.js")
  return {
    createClient: () => ({
      auth: { getUser: (token: string) => getUser(token) },
    }),
  }
})

beforeEach(() => {
  fakeDb.reset()
})
