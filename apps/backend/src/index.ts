// Load environment variables FIRST before any other imports
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../.env") })

// Now import everything else
import { buildApp } from "./app.js"

// Plain JSON in production (what log tooling expects, and cheaper than
// formatting every line); pino-pretty only for local readability.
const logger =
  process.env.NODE_ENV === "production"
    ? true
    : {
        transport: {
          target: "pino-pretty",
          options: {
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        },
      }

const { fastify, routes } = await buildApp(logger)

// Always print the route table on boot (see scripts/lib/route-table.mjs) so
// a live server's own stdout can double as a route-table read — no separate
// introspection process needed. PRINT_ROUTES_AND_EXIT additionally skips
// binding a port, so it can run even while a real dev server is already
// listening on the same port.
console.log("<<<ROUTES_START>>>")
console.log(JSON.stringify(routes))
console.log("<<<ROUTES_END>>>")

if (process.env.PRINT_ROUTES_AND_EXIT === "true") {
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
