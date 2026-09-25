import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { buildTestApp } from "./helpers/app.js"
import { LOGIN_RATE_LIMIT } from "../src/routes/auth-login.js"

// Production hardening (#79): login rate limit, client IP behind
// Railway's proxy, and CORS off in production.

const RAILWAY_PROXY = "100.64.0.7"
const credentials = { email: "someone@example.com", password: "wrong" }

describe("POST /api/auth/login rate limit", () => {
  let app: FastifyInstance

  // Fresh app per test so each starts with empty rate-limit buckets.
  beforeEach(async () => {
    ;({ app } = await buildTestApp("production"))
  })
  afterEach(() => app.close())

  const login = (extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: credentials, ...extra })

  const exhaust = async (extra: Record<string, unknown> = {}) => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
      expect((await login(extra)).statusCode).toBe(401)
    }
  }

  it("allows the limit, then answers 429 in the app's error shape", async () => {
    await exhaust()

    const res = await login()

    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ success: false })
    expect(res.json().error).toMatch(/^Too many attempts\. Try again in /)
  })

  it("keeps a separate bucket per client IP", async () => {
    await exhaust({ remoteAddress: "198.51.100.1" })

    const other = await login({ remoteAddress: "198.51.100.2" })

    expect(other.statusCode).toBe(401)
  })

  it("keys on the IP Railway appended, not a forged X-Forwarded-For", async () => {
    // Each request forges a different leftmost entry; the real client is
    // the entry Railway's proxy appended, so they all share one bucket.
    const forged = (i: number) => ({
      remoteAddress: RAILWAY_PROXY,
      headers: { "x-forwarded-for": `203.0.113.${i}, 198.51.100.9` },
    })
    for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
      expect((await login(forged(i))).statusCode).toBe(401)
    }

    const res = await login(forged(99))

    expect(res.statusCode).toBe(429)
  })

  it("doesn't rate limit other routes", async () => {
    for (let i = 0; i <= LOGIN_RATE_LIMIT.max; i++) {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200)
    }
  })
})

describe("CORS", () => {
  const allowedOrigin = async (mode: "production" | "development") => {
    const { app } = await buildTestApp(mode)
    try {
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "https://evil.example" },
      })
      return res.headers["access-control-allow-origin"]
    } finally {
      await app.close()
    }
  }

  it("sends no CORS headers in production", async () => {
    expect(await allowedOrigin("production")).toBeUndefined()
  })

  it("stays permissive in development", async () => {
    expect(await allowedOrigin("development")).toBe("https://evil.example")
  })
})
