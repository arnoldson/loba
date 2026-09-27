import type { FastifyInstance, FastifyReply } from "fastify"
import { BlockService } from "../services/blocks.js"
import { requireAuth } from "../middleware/auth.js"
import type { BlockAuthorResponse, BlockCountResponse } from "@loba/shared"

// User-to-user blocking (#83). Future-only: see services/blocks.ts.

const STATUS_BY_ERROR: Record<string, number> = {
  "Post not found": 404,
  "Comment not found": 404,
  "You can't block yourself": 400,
  "This author can no longer be blocked": 410,
}

function sendBlockError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to block"
  return reply.code(STATUS_BY_ERROR[message] ?? 500).send({
    success: false,
    error: STATUS_BY_ERROR[message] ? message : "Failed to block",
  })
}

export async function blockRoutes(fastify: FastifyInstance) {
  const blockService = new BlockService()

  fastify.post<{ Params: { id: string }; Reply: BlockAuthorResponse }>(
    "/posts/:id/block-author",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        await blockService.blockPostAuthor(request.params.id, request.userId!)
        return { success: true }
      } catch (error) {
        return sendBlockError(reply, error)
      }
    },
  )

  fastify.post<{
    Params: { postId: string; commentId: string }
    Reply: BlockAuthorResponse
  }>(
    "/posts/:postId/comments/:commentId/block-author",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        await blockService.blockCommentAuthor(
          request.params.postId,
          request.params.commentId,
          request.userId!,
        )
        return { success: true }
      } catch (error) {
        return sendBlockError(reply, error)
      }
    },
  )

  fastify.get<{ Reply: BlockCountResponse }>(
    "/blocks/count",
    { preHandler: [requireAuth] },
    async (request) => ({
      success: true,
      count: await blockService.countBlockedAuthors(request.userId!),
    }),
  )

  fastify.delete<{ Reply: BlockAuthorResponse }>(
    "/blocks",
    { preHandler: [requireAuth] },
    async (request) => {
      await blockService.unblockAll(request.userId!)
      return { success: true }
    },
  )
}
