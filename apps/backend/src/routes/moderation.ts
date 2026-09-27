import type { FastifyInstance } from "fastify"
import { ModerationService } from "../services/moderation.js"
import { requireAuth } from "../middleware/auth.js"
import type { ReportPostRequest, ReportPostResponse } from "@loba/shared"

const VALID_REASONS = ["spam", "harassment", "illegal", "other"]

export async function moderationRoutes(fastify: FastifyInstance) {
  const moderationService = new ModerationService()

  // ─── Report a post (requires auth) ──────────────────────────────────

  fastify.post<{
    Params: { id: string }
    Body: ReportPostRequest
    Reply: ReportPostResponse
  }>(
    "/posts/:id/report",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!
        const { reason } = request.body

        if (!reason || !VALID_REASONS.includes(reason)) {
          return reply.code(400).send({
            success: false,
            error: `reason must be one of: ${VALID_REASONS.join(", ")}`,
          })
        }

        await moderationService.reportPost(request.params.id, userId, reason)

        return { success: true }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to report post"

        const status =
          message === "Post not found"
            ? 404
            : message === "You cannot report your own post"
              ? 403
              : message === "You have already reported this post"
                ? 409
                : message === "This post can no longer be reported"
                  ? 410
                  : 500

        return reply.code(status).send({
          success: false,
          error: message,
        })
      }
    },
  )

  // ─── Report a comment (requires auth, #86) ──────────────────────────

  fastify.post<{
    Params: { postId: string; commentId: string }
    Body: ReportPostRequest
    Reply: ReportPostResponse
  }>(
    "/posts/:postId/comments/:commentId/report",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { reason } = request.body ?? {}

      if (!reason || !VALID_REASONS.includes(reason)) {
        return reply.code(400).send({
          success: false,
          error: `reason must be one of: ${VALID_REASONS.join(", ")}`,
        })
      }

      try {
        await moderationService.reportComment(
          request.params.postId,
          request.params.commentId,
          request.userId!,
          reason,
        )
        return { success: true }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to report comment"
        const status =
          message === "Comment not found"
            ? 404
            : message === "You cannot report your own comment"
              ? 403
              : message === "You have already reported this comment"
                ? 409
                : 500
        return reply.code(status).send({
          success: false,
          error: status === 500 ? "Failed to report comment" : message,
        })
      }
    },
  )
}
