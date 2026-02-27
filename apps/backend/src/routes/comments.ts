import type { FastifyInstance } from "fastify"
import { CommentService } from "../services/comments.js"
import { requireAuth, optionalAuth } from "../middleware/auth.js"
import type {
  CreateCommentRequest,
  CreateCommentResponse,
  GetCommentsResponse,
} from "@loba/shared"

export async function commentRoutes(fastify: FastifyInstance) {
  const commentService = new CommentService()

  // ─── Get comments for a post (public, optional auth for is_own) ───

  fastify.get<{
    Params: { postId: string }
    Reply: GetCommentsResponse
  }>(
    "/posts/:postId/comments",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      try {
        const comments = await commentService.getCommentsByPostId(
          request.params.postId,
          request.userId,
        )

        reply.send({
          success: true,
          comments,
        })
      } catch (error) {
        reply.code(500).send({
          success: false,
          comments: [],
          error:
            error instanceof Error ? error.message : "Failed to fetch comments",
        })
      }
    },
  )

  // ─── Create a comment on a post (requires auth) ────────────────────

  fastify.post<{
    Params: { postId: string }
    Body: CreateCommentRequest
    Reply: CreateCommentResponse
  }>(
    "/posts/:postId/comments",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!
        const { content } = request.body

        if (!content || content.trim().length === 0) {
          return reply.code(400).send({
            success: false,
            comment: {} as any,
            error: "Comment content is required",
          })
        }

        if (content.length > 500) {
          return reply.code(400).send({
            success: false,
            comment: {} as any,
            error: "Comment must be 500 characters or less",
          })
        }

        const comment = await commentService.createComment(
          request.params.postId,
          userId,
          content.trim(),
        )

        reply.code(201).send({
          success: true,
          comment,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create comment"
        const status = message === "Post not found" ? 404 : 500

        reply.code(status).send({
          success: false,
          comment: {} as any,
          error: message,
        })
      }
    },
  )

  // ─── Delete a comment (requires auth, must be author) ──────────────

  fastify.delete<{
    Params: { postId: string; commentId: string }
  }>(
    "/posts/:postId/comments/:commentId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!

        await commentService.deleteComment(request.params.commentId, userId)

        reply.send({ success: true })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete comment"
        const status =
          message === "Comment not found"
            ? 404
            : message === "Not authorized to delete this comment"
              ? 403
              : 500

        reply.code(status).send({
          success: false,
          error: message,
        })
      }
    },
  )
}
