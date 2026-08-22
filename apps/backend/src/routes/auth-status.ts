import type { FastifyInstance } from "fastify"
import { requireAuth } from "../middleware/auth.js"
import type { AuthPingResponse } from "@loba/shared"

/**
 * GET /api/auth/ping — used by mobile's AuthGate to decide whether a
 * logged-in user should see the app or a suspension screen (#24).
 *
 * There's no business logic here at all — the entire point of this
 * route is that requireAuth already rejects a banned user with a 403
 * before this handler ever runs. Reaching this line is the signal.
 */
export async function authStatusRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: AuthPingResponse }>(
    "/auth/ping",
    { preHandler: [requireAuth] },
    async () => {
      return { success: true }
    },
  )
}
