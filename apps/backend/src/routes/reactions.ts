/**
 * Post reaction endpoints (upvote/downvote).
 * All reactions require authentication and physical proximity to the post.
 */

import type { FastifyInstance } from "fastify"
import { PostService } from "../services/posts.js"
import { requireAuth } from "../middleware/auth.js"
import type { ReactToPostRequest, ReactToPostResponse } from "@loba/shared"

export async function reactionRoutes(fastify: FastifyInstance) {
  const postService = new PostService()

  /**
   * POST /posts/:id/react
   *
   * Toggle an upvote or downvote on a post.
   * - Same reaction twice → removes it (toggle off)
   * - Different reaction → switches it
   * - Upvotes extend the post's TTL by 2 hours (capped at 7 days)
   * - User must be within 50m of the post
   */
  fastify.post<{
    Params: { id: string }
    Body: ReactToPostRequest
    Reply: ReactToPostResponse
  }>(
    "/posts/:id/react",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!
        const { reaction, latitude, longitude } =
          request.body as ReactToPostRequest

        // Validate input
        if (!reaction || !["upvote", "downvote"].includes(reaction)) {
          return reply.code(400).send({
            success: false,
            reaction: null,
            upvote_count: 0,
            downvote_count: 0,
            new_expires_at: "",
            error: 'reaction must be "upvote" or "downvote"',
          })
        }

        if (latitude == null || longitude == null) {
          return reply.code(400).send({
            success: false,
            reaction: null,
            upvote_count: 0,
            downvote_count: 0,
            new_expires_at: "",
            error: "latitude and longitude are required",
          })
        }

        const result = await postService.reactToPost(
          request.params.id,
          userId,
          reaction,
          latitude,
          longitude,
        )

        return {
          success: true,
          ...result,
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to react to post"

        const status =
          message === "Post not found"
            ? 404
            : message === "Post has been archived"
              ? 410
              : message === "You must be near this post to react"
                ? 403
                : 500

        return reply.code(status).send({
          success: false,
          reaction: null,
          upvote_count: 0,
          downvote_count: 0,
          new_expires_at: "",
          error: message,
        })
      }
    },
  )
}
