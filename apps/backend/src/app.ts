/**
 * App factory. Builds the Fastify instance with every route registered but
 * does NOT listen or print anything -- index.ts owns booting, and the
 * functional tests (apps/backend/test) drive this directly via
 * fastify.inject().
 *
 * Dev-only route gating (NODE_ENV !== "production") is evaluated at build
 * time, so a test can build once per mode.
 */
import Fastify, { type FastifyServerOptions } from "fastify"
import cors from "@fastify/cors"
import rateLimit from "@fastify/rate-limit"
import { postRoutes } from "./routes/posts.js"
import { seedRoutes } from "./routes/seed.js"
import { db } from "./db/index.js"
import { postsSpatialRoutes } from "./routes/posts-spatial.js"
import { devAuthRoutes } from "./routes/dev-auth.js"
import { commentRoutes } from "./routes/comments.js"
import { reactionRoutes } from "./routes/reactions.js"
import { accountRoutes } from "./routes/account.js"
import { moderationRoutes } from "./routes/moderation.js"
import { authStatusRoutes } from "./routes/auth-status.js"
import { authLoginRoutes } from "./routes/auth-login.js"

export async function buildApp(logger: FastifyServerOptions["logger"]) {
  const fastify = Fastify({
    // Railway terminates TLS and proxies requests, so without this,
    // request.ip is Railway's internal proxy address for every request,
    // not the real client IP. Needed for user_ip_log (#24), the IP check
    // (#43) and the login rate limit (#79) to mean anything.
    //
    // Trust only Railway's internal range, not every hop (`true`): with
    // `true`, request.ip is the LEFTMOST X-Forwarded-For entry, which a
    // client can set itself if the edge doesn't strip it -- and Railway's
    // own answers on whether it does conflict. Trusting just 100.0.0.0/8
    // picks the rightmost non-Railway entry, the one Railway appended,
    // which is correct whether or not client values get stripped.
    trustProxy: "100.0.0.0/8",
    logger,
  })

  // ─── Route table capture (used by scripts/lib/route-table.mjs) ────────
  // onRoute fires for every route as it's registered, giving a stable
  // "METHOD /path" list — avoids noisy printRoutes() tree-text diffs.
  const routeTable: string[] = []
  fastify.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method]
    for (const method of methods) {
      routeTable.push(`${method} ${routeOptions.url}`)
    }
  })

  // CORS only matters to browsers. The native app doesn't send an Origin,
  // and nothing browser-based calls this API in production, so there it's
  // left off entirely rather than reflecting every origin (#79).
  if (process.env.NODE_ENV !== "production") {
    await fastify.register(cors, { origin: true })
  }

  // Opt-in per route (config.rateLimit) rather than global -- see
  // routes/auth-login.ts for the one route that uses it.
  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      success: false,
      error: `Too many attempts. Try again in ${context.after}.`,
    }),
  })
  // Health check endpoint
  fastify.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() }
  })

  // Register routes
  if (process.env.NODE_ENV !== "production") {
    await fastify.register(devAuthRoutes)
    await fastify.register(seedRoutes, { prefix: "/api" })

    // Database connection test
    fastify.get("/db-test", async (request, reply) => {
      try {
        const result = await db.selectFrom("posts").selectAll().limit(1).execute()
        return {
          status: "connected",
          message: "Database connection successful",
          postsCount: result.length,
        }
      } catch (error) {
        console.error("Database connection error:", error)
        reply.code(500).send({
          status: "error",
          message: error instanceof Error ? error.message : "Unknown error",
          fullError: JSON.stringify(error, null, 2),
        })
      }
    })

    // Debug: List all posts
    fastify.get("/debug/posts", async (request, reply) => {
      try {
        const posts = await db.selectFrom("posts").selectAll().execute()
        return {
          count: posts.length,
          posts: posts,
        }
      } catch (error) {
        console.error("Error fetching posts:", error)
        reply.code(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    })

    console.log(
      "🔧 Dev routes enabled: devAuthRoutes, /api/seed, /db-test, /debug/posts",
    )
  }
  await fastify.register(postRoutes, { prefix: "/api" })
  await fastify.register(reactionRoutes, { prefix: "/api" })
  await fastify.register(commentRoutes, { prefix: "/api" })
  await fastify.register(accountRoutes, { prefix: "/api" })
  await fastify.register(moderationRoutes, { prefix: "/api" })
  await fastify.register(authStatusRoutes, { prefix: "/api" })
  await fastify.register(authLoginRoutes, { prefix: "/api" })
  await fastify.register(postsSpatialRoutes)

  return { fastify, routes: [...new Set(routeTable)].sort() }
}
