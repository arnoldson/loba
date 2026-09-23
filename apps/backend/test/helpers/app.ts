import type { FastifyInstance } from "fastify"
import { buildApp } from "../../src/app.js"

/**
 * Builds the real app in the given mode. Dev-only routes are gated on
 * NODE_ENV at build time, so the mode has to be set before buildApp.
 */
export async function buildTestApp(
  mode: "production" | "development",
): Promise<{ app: FastifyInstance; routes: string[] }> {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = mode
  try {
    const { fastify, routes } = await buildApp(false)
    await fastify.ready()
    return { app: fastify, routes }
  } finally {
    process.env.NODE_ENV = prev
  }
}

/** "GET /api/posts/:id" -> { method, url } with params filled in. */
export function toRequest(route: string) {
  const [method, path] = route.split(" ")
  return {
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    url: path.replace(/:\w+/g, "00000000-0000-0000-0000-000000000000"),
  }
}
