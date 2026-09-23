import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { buildTestApp, toRequest } from "./helpers/app.js"

/**
 * In-process complement to scripts/check-routes.mjs (#17/#23). That script
 * proves gating against a real booted production server and checks the
 * committed snapshots; this proves the same property fast, at PR time, in
 * the unit-test run -- dev-only routes are derived from the live route
 * tables (dev minus prod), never hand-maintained.
 */
describe("dev-route gating", () => {
  let dev: { app: FastifyInstance; routes: string[] }
  let prod: { app: FastifyInstance; routes: string[] }
  let devOnly: string[]

  beforeAll(async () => {
    dev = await buildTestApp("development")
    prod = await buildTestApp("production")
    devOnly = dev.routes.filter((r) => !prod.routes.includes(r))
  })
  afterAll(async () => {
    await dev.app.close()
    await prod.app.close()
  })

  it("has dev-only routes to gate (guards against the derivation silently going empty)", () => {
    expect(devOnly.length).toBeGreaterThan(0)
    expect(devOnly).toContain("GET /db-test")
    expect(devOnly).toContain("POST /api/dev/login")
  })

  it("never registers a production route that isn't in dev", () => {
    expect(prod.routes.filter((r) => !dev.routes.includes(r))).toEqual([])
  })

  it("returns 404 for every dev-only route in production", async () => {
    for (const route of devOnly.filter((r) => !/^(HEAD|OPTIONS) /.test(r))) {
      const res = await prod.app.inject(toRequest(route))
      expect(res.statusCode, `${route} in production`).toBe(404)
    }
  })

  it("serves dev routes in development", async () => {
    const res = await dev.app.inject({ method: "GET", url: "/db-test" })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("connected")
  })

  it("keeps /health open in both modes", async () => {
    for (const { app } of [dev, prod]) {
      const res = await app.inject({ method: "GET", url: "/health" })
      expect(res.statusCode).toBe(200)
      expect(res.json().status).toBe("ok")
    }
  })
})
