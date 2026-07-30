/**
 * Account management endpoints.
 */

import type { FastifyInstance } from "fastify"
import { AccountService } from "../services/account.js"
import { requireAuth } from "../middleware/auth.js"

export async function accountRoutes(fastify: FastifyInstance) {
  const accountService = new AccountService()

  /**
   * DELETE /account
   *
   * Permanently deletes the authenticated user's account.
   * Posts and comments are preserved, reassigned to a "[deleted]"
   * placeholder (see AccountService.deleteAccount for details).
   * This cannot be undone — there is no confirmation step server-side;
   * the client is responsible for confirming intent before calling this.
   */
  fastify.delete<{
    Reply: { success: boolean; error?: string }
  }>("/account", { preHandler: [requireAuth] }, async (request, reply) => {
    try {
      const userId = request.userId!
      await accountService.deleteAccount(userId)

      return { success: true }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete account"

      request.log.error({ err: error, userId: request.userId }, message)

      return reply.code(500).send({
        success: false,
        error: message,
      })
    }
  })
}
