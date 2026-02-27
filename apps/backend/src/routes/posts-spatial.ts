/**
 * Spatial posts endpoints using PostGIS bounding box queries.
 * Delegates to PostService so display names and verification
 * badges are applied consistently.
 */

import { FastifyPluginAsync } from "fastify"
import { sql } from "kysely"
import { db } from "../db/index.js"
import { PostService } from "../services/posts.js"
import { optionalAuth } from "../middleware/auth.js"

interface PostsInBoundsRequest {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
  limit?: number
  tags?: string[]
}

export const postsSpatialRoutes: FastifyPluginAsync = async (fastify) => {
  const postService = new PostService()

  /**
   * POST /api/posts/in-bounds
   * Get posts within a geographic bounding box.
   * Optionally filter by tags (post must have ANY of the provided tags).
   * Returns PublicPosts (no user_id, with display_name and is_verified).
   */
  fastify.post(
    "/api/posts/in-bounds",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const {
        minLat,
        maxLat,
        minLng,
        maxLng,
        limit = 5000,
        tags,
      } = request.body as PostsInBoundsRequest

      // Validation
      if (
        minLat == null ||
        maxLat == null ||
        minLng == null ||
        maxLng == null
      ) {
        return reply.status(400).send({
          success: false,
          error: "Missing required bounds: minLat, maxLat, minLng, maxLng",
        })
      }

      // Validate tags if provided
      const cleanTags =
        tags && Array.isArray(tags) && tags.length > 0
          ? tags.filter((t) => typeof t === "string" && t.trim().length > 0)
          : undefined

      try {
        const { posts, dbQueryTime } = await postService.getPostsInBounds(
          { minLat, maxLat, minLng, maxLng },
          limit,
          request.userId,
          cleanTags,
        )

        return {
          success: true,
          posts,
          count: posts.length,
          dbQueryTime,
          filtered_by_tags: cleanTags || null,
        }
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({
          success: false,
          error: "Failed to fetch posts",
          details: error instanceof Error ? error.message : "Unknown error",
        })
      }
    },
  )

  /**
   * GET /api/tags/popular
   * Get the most frequently used tags across all posts.
   * Used by the frontend to populate the tag filter bar.
   */
  fastify.get("/api/tags/popular", async (request, reply) => {
    try {
      const { limit } = request.query as { limit?: string }
      const parsedLimit = Math.min(Number(limit) || 20, 50)

      const tags = await postService.getPopularTags(parsedLimit)

      return {
        success: true,
        tags,
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch tags",
        details: error instanceof Error ? error.message : "Unknown error",
      })
    }
  })

  /**
   * GET /api/posts/in-bounds/test
   * Test endpoint to verify spatial index is working
   */
  fastify.get("/api/posts/in-bounds/test", async (request, reply) => {
    try {
      const postgisCheck = await db
        .selectFrom(sql`pg_extension`.as("ext"))
        .select(sql`extname`.as("name"))
        .where(sql`extname`, "=", "postgis")
        .executeTakeFirst()

      if (!postgisCheck) {
        return reply.status(500).send({
          success: false,
          error: "PostGIS extension not installed",
        })
      }

      const columnCheck = await db
        .selectFrom(sql`information_schema.columns`.as("cols"))
        .select(sql`column_name`.as("column"))
        .where(sql`table_name`, "=", "posts")
        .where(sql`column_name`, "=", "location")
        .executeTakeFirst()

      if (!columnCheck) {
        return reply.status(500).send({
          success: false,
          error: "Location column not found on posts table",
        })
      }

      const indexCheck = await db
        .selectFrom(sql`pg_indexes`.as("idx"))
        .select([sql`indexname`.as("name"), sql`indexdef`.as("definition")])
        .where(sql`tablename`, "=", "posts")
        .where(sql`indexname`, "=", "idx_posts_location")
        .executeTakeFirst()

      if (!indexCheck) {
        return reply.status(500).send({
          success: false,
          error: "Spatial index not found",
        })
      }

      const testQuery = await db
        .selectFrom("posts")
        .selectAll()
        .where(
          sql<boolean>`location && ST_MakeEnvelope(-122.408, 37.788, -122.405, 37.790, 4326)`,
        )
        .limit(10)
        .execute()

      return reply.send({
        success: true,
        message: "Spatial queries ready!",
        checks: {
          postgis: !!postgisCheck,
          locationColumn: !!columnCheck,
          spatialIndex: !!indexCheck,
        },
        testQueryResults: testQuery.length,
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        success: false,
        error: "Test failed",
        details: error instanceof Error ? error.message : "Unknown error",
      })
    }
  })
}
