/**
 * Spatial posts endpoints using PostGIS bounding box queries
 * Replaces tile_id array approach with geographic bounding boxes
 */

import { FastifyPluginAsync } from "fastify";
import { sql } from "kysely";
import { db } from "../db";

interface PostsInBoundsRequest {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  limit?: number;
}

export const postsSpatialRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/posts/in-bounds
   * Get posts within a geographic bounding box
   *
   * Body:
   * {
   *   minLat: 37.788,
   *   maxLat: 37.790,
   *   minLng: -122.408,
   *   maxLng: -122.405,
   *   limit: 5000  // optional
   * }
   */
  fastify.post("/api/posts/in-bounds", async (request, reply) => {
    const {
      minLat,
      maxLat,
      minLng,
      maxLng,
      limit = 5000,
    } = request.body as {
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
      limit?: number;
    };

    // ... validation code ...

    try {
      // ADD THIS LINE:
      const startTime = Date.now();

      const posts = await db
        .selectFrom("posts")
        .selectAll()
        .where(
          sql<boolean>`location && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`
        )
        .limit(limit)
        .execute();

      // ADD THIS LINE:
      const dbQueryTime = Date.now() - startTime;

      return {
        success: true,
        posts,
        count: posts.length,
        dbQueryTime, // ADD THIS LINE
      };
    } catch (error) {
      // ... error handling ...
    }
  });

  /**
   * GET /api/posts/in-bounds/test
   * Test endpoint to verify spatial index is working
   */
  fastify.get("/api/posts/in-bounds/test", async (request, reply) => {
    try {
      // Check if PostGIS is installed
      const postgisCheck = await db
        .selectFrom(sql`pg_extension`.as("ext"))
        .select(sql`extname`.as("name"))
        .where(sql`extname`, "=", "postgis")
        .executeTakeFirst();

      if (!postgisCheck) {
        return reply.status(500).send({
          success: false,
          error: "PostGIS extension not installed",
        });
      }

      // Check if location column exists
      const columnCheck = await db
        .selectFrom(sql`information_schema.columns`.as("cols"))
        .select(sql`column_name`.as("column"))
        .where(sql`table_name`, "=", "posts")
        .where(sql`column_name`, "=", "location")
        .executeTakeFirst();

      if (!columnCheck) {
        return reply.status(500).send({
          success: false,
          error: "Location column not found on posts table",
        });
      }

      // Check if spatial index exists
      const indexCheck = await db
        .selectFrom(sql`pg_indexes`.as("idx"))
        .select([sql`indexname`.as("name"), sql`indexdef`.as("definition")])
        .where(sql`tablename`, "=", "posts")
        .where(sql`indexname`, "=", "idx_posts_location")
        .executeTakeFirst();

      if (!indexCheck) {
        return reply.status(500).send({
          success: false,
          error: "Spatial index not found",
        });
      }

      // Run a test query and check if it uses the index
      const testQuery = await db
        .selectFrom("posts")
        .selectAll()
        .where(
          sql`location && ST_MakeEnvelope(-122.408, 37.788, -122.405, 37.790, 4326)`
        )
        .limit(10)
        .execute();

      return reply.send({
        success: true,
        message: "Spatial queries ready!",
        checks: {
          postgis: !!postgisCheck,
          locationColumn: !!columnCheck,
          spatialIndex: !!indexCheck,
        },
        testQueryResults: testQuery.length,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: "Test failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
};
