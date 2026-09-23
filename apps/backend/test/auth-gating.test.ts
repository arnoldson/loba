import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { fakeDb } from "./helpers/fake-db.js"
import { authHeader } from "./helpers/fake-auth.js"
import { buildTestApp, toRequest } from "./helpers/app.js"

/**
 * Deny-by-default: every production route NOT listed here must reject an
 * unauthenticated request with 401. Adding a route therefore forces a
 * deliberate decision -- either it's protected (nothing to do), or it's
 * added below with a reason. Compare scripts/pre-commit-route-check.mjs,
 * which prompts on a new route's *dev/prod* visibility; this covers
 * *authentication*.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  "GET /health": "liveness probe",
  "POST /api/auth/login": "issues the credentials, can't require them",
  "GET /api/posts/:id": "map browsing, optionalAuth",
  "GET /api/posts/:postId/comments": "map browsing, optionalAuth",
  "GET /api/posts/in-bounds/test": "existing public diagnostic route",
  "GET /api/tags/popular": "map browsing",
  "POST /api/posts/in-bounds": "map browsing, optionalAuth",
  "POST /api/posts/by-bounds": "map browsing, optionalAuth",
  "POST /api/posts/density-in-bounds": "map browsing, optionalAuth",
}

// HEAD mirrors GET automatically; OPTIONS * is CORS preflight.
const isMirror = (route: string) => /^(HEAD|OPTIONS) /.test(route)

describe("auth gating (production route table)", () => {
  let app: FastifyInstance
  let routes: string[]

  beforeAll(async () => {
    ;({ app, routes } = await buildTestApp("production"))
  })
  afterAll(() => app.close())

  it("has no stale entries in the public allowlist", () => {
    for (const route of Object.keys(PUBLIC_ROUTES)) {
      expect(routes, `${route} is allowlisted but not registered`).toContain(route)
    }
  })

  it("rejects unauthenticated requests on every non-public route", async () => {
    const protectedRoutes = routes.filter((r) => !isMirror(r) && !(r in PUBLIC_ROUTES))
    expect(protectedRoutes.length).toBeGreaterThan(0)

    for (const route of protectedRoutes) {
      const res = await app.inject(toRequest(route))
      expect(res.statusCode, `${route} without a token`).toBe(401)
    }
  })

  it("rejects an invalid token on every non-public route", async () => {
    const protectedRoutes = routes.filter((r) => !isMirror(r) && !(r in PUBLIC_ROUTES))

    for (const route of protectedRoutes) {
      const res = await app.inject({
        ...toRequest(route),
        headers: { authorization: "Bearer not-a-real-token" },
      })
      expect(res.statusCode, `${route} with a bad token`).toBe(401)
    }
  })

  it("lets a valid token through to a protected route", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/ping",
      headers: authHeader("user-1"),
    })
    expect(res.statusCode).toBe(200)
  })

  describe("ban / restriction enforcement", () => {
    it("blocks a banned user with 403 even though their token is valid", async () => {
      fakeDb.when(/from "user_bans"/, [{ id: "ban-1" }])

      const res = await app.inject({
        method: "GET",
        url: "/api/auth/ping",
        headers: authHeader("banned-user"),
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe("banned")
    })

    it("blocks a banned user on an optional-auth route too", async () => {
      fakeDb.when(/from "user_bans"/, [{ id: "ban-1" }])

      const res = await app.inject({
        method: "POST",
        url: "/api/posts/in-bounds",
        headers: authHeader("banned-user"),
        payload: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe("banned")
    })

    it("blocks writes but not reads for a pending-review account", async () => {
      fakeDb.when(/from "user_profiles"/, [{ restriction_status: "pending_review" }])

      const write = await app.inject({
        method: "POST",
        url: "/api/posts",
        headers: authHeader("restricted-user"),
        payload: {},
      })
      expect(write.statusCode).toBe(403)
      expect(write.json().code).toBe("restricted")

      const read = await app.inject({
        method: "GET",
        url: "/api/auth/ping",
        headers: authHeader("restricted-user"),
      })
      expect(read.statusCode).toBe(200)
    })
  })
})
