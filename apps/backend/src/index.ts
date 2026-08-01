// Load environment variables FIRST before any other imports
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../.env") })

// Now import everything else
import Fastify from "fastify"
import cors from "@fastify/cors"
import { postRoutes } from "./routes/posts.js"
import { seedRoutes } from "./routes/seed.js"
import { db } from "./db/index.js"
import { postsSpatialRoutes } from "./routes/posts-spatial"
import { devAuthRoutes } from "./routes/dev-auth.js"
import { commentRoutes } from "./routes/comments.js"
import { reactionRoutes } from "./routes/reactions.js"
import { accountRoutes } from "./routes/account.js"

// Create Fastify instance
const fastify = Fastify({
  logger: {
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
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

// Register CORS
await fastify.register(cors, {
  origin: true, // Allow all origins in development
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
await fastify.register(postsSpatialRoutes)

// Escape hatch for scripts/lib/route-table.mjs: print the route table and
// exit WITHOUT binding a port, so this can run even while a real dev
// server is already listening on the same port.
if (process.env.PRINT_ROUTES_AND_EXIT === "true") {
  const routes = [...new Set(routeTable)].sort()
  console.log("<<<ROUTES_START>>>")
  console.log(JSON.stringify(routes))
  console.log("<<<ROUTES_END>>>")
  process.exit(0)
}

// Start server
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000
    const host = process.env.HOST || "0.0.0.0"

    await fastify.listen({ port, host })

    console.log(`\n🚀 Server running on http://localhost:${port}`)
    console.log(`📍 API endpoints: http://localhost:${port}/api`)
    console.log(`❤️  Health check: http://localhost:${port}/health\n`)
    console.log(
      `🕒 Archive/hard-delete jobs run via pg_cron in Postgres (see #13)\n`,
    )
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
