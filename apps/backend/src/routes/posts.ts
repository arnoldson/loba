import type { FastifyInstance } from "fastify"
import { PostService } from "../services/posts.js"
import { requireAuth, optionalAuth } from "../middleware/auth.js"
import { LocationQualityError } from "../utils/proximity.js"
import {
  MAX_POST_LENGTH,
  getPostTagsError,
  normalizeTags,
} from "@loba/shared"
import type {
  CreatePostRequest,
  CreatePostResponse,
  GetMyPostsResponse,
} from "@loba/shared"

export async function postRoutes(fastify: FastifyInstance) {
  const postService = new PostService()

  // ─── Create a new post (requires auth) ──────────────────────────────

  fastify.post<{ Body: CreatePostRequest; Reply: CreatePostResponse }>(
    "/posts",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!
        const { locationAccuracy, locationTimestamp } = request.body

        if (locationAccuracy == null || locationTimestamp == null) {
          reply.code(400).send({
            success: false,
            post: {} as any,
            error: "locationAccuracy and locationTimestamp are required",
          })
          return
        }

        const { content, tags } = request.body

        if (typeof content !== "string" || content.trim().length === 0) {
          reply.code(400).send({
            success: false,
            post: {} as any,
            error: "Post content is required",
          })
          return
        }

        if (content.length > MAX_POST_LENGTH) {
          reply.code(400).send({
            success: false,
            post: {} as any,
            error: `Post must be ${MAX_POST_LENGTH} characters or less`,
          })
          return
        }
        const tagsError =
          Array.isArray(tags) && tags.every((t) => typeof t === "string")
            ? getPostTagsError(normalizeTags(tags))
            : "tags must be an array of strings"
        if (tagsError) {
          reply.code(400).send({
            success: false,
            post: {} as any,
            error: tagsError,
          })
          return
        }

        const post = await postService.createPost(
          request.body,
          userId,
          request.ip,
        )

        reply.send({
          success: true,
          post,
        })
      } catch (error) {
        if (error instanceof LocationQualityError) {
          reply.code(403).send({
            success: false,
            post: {} as any,
            error: error.message,
          })
          return
        }

        console.error("Error creating post:")
        console.error("Error details:", error)
        console.error(
          "Error stack:",
          error instanceof Error ? error.stack : "N/A",
        )

        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Failed to create post"

        reply.code(500).send({
          success: false,
          post: {} as any,
          error: errorMessage || "Unknown error occurred",
        })
      }
    },
  )

  // ─── Delete a post (requires auth, must be author) ──────────────────

  fastify.delete<{ Params: { id: string } }>(
    "/posts/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!
        await postService.deletePost(request.params.id, userId)

        reply.send({ success: true })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete post"
        const status =
          message === "Post not found"
            ? 404
            : message === "Not authorized to delete this post"
              ? 403
              : 500

        reply.code(status).send({
          success: false,
          error: message,
        })
      }
    },
  )

  // ─── Get a single post by ID (public, optional auth) ───────────────

  fastify.get<{ Params: { id: string } }>(
    "/posts/:id",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      try {
        const post = await postService.getPostById(
          request.params.id,
          request.userId,
        )

        if (!post) {
          reply.code(404).send({
            success: false,
            error: "Post not found",
          })
          return
        }

        reply.send({
          success: true,
          post,
        })
      } catch (error) {
        reply.code(500).send({
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to fetch post",
        })
      }
    },
  )

  // ─── Get my posts (requires auth) ──────────────────────────────────

  fastify.get<{ Reply: GetMyPostsResponse }>(
    "/posts/mine",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!
        const posts = await postService.getMyPosts(userId)

        reply.send({
          success: true,
          posts,
        })
      } catch (error) {
        reply.code(500).send({
          success: false,
          posts: [],
          error:
            error instanceof Error ? error.message : "Failed to fetch posts",
        })
      }
    },
  )
}
