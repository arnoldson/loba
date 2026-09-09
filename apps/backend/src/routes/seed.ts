import type { FastifyInstance } from "fastify"
import { db } from "../db/index.js"
import { getTileId } from "../db/tiles.js"

const SEED_TAGS = [
  ["#food", "#restaurant"],
  ["#coffee", "#cafe"],
  ["#parking", "#cars"],
  ["#event", "#music"],
  ["#park", "#nature"],
  ["#shopping", "#retail"],
  ["#emergency", "#safety"],
  ["#transit", "#bus"],
  ["#art", "#gallery"],
  ["#gym", "#fitness"],
]

const SEED_CONTENT = [
  "Great spot!",
  "Highly recommend this place",
  "Amazing experience here",
  "Just discovered this gem",
  "Perfect location",
  "Love this area",
  "Must visit!",
  "Hidden treasure",
  "Best in the neighborhood",
  "Worth checking out",
  "Awesome vibe",
  "Can't recommend enough",
  "Fantastic spot",
  "Really enjoyed this",
  "Beautiful location",
]

/**
 * Generate random posts around a center point
 */
function generateSeedPosts(
  centerLat: number,
  centerLng: number,
  count: number,
): Array<{
  content: string
  tags: string[]
  latitude: number
  longitude: number
}> {
  const posts = []

  // Create clusters with different densities
  const clusters = [
    // Dense cluster (city center)
    { lat: centerLat, lng: centerLng, radius: 0.002, density: 0.4 },
    // Medium clusters (nearby areas)
    {
      lat: centerLat + 0.003,
      lng: centerLng + 0.002,
      radius: 0.003,
      density: 0.3,
    },
    {
      lat: centerLat - 0.002,
      lng: centerLng + 0.003,
      radius: 0.003,
      density: 0.2,
    },
    // Sparse areas (outskirts)
    {
      lat: centerLat + 0.005,
      lng: centerLng - 0.004,
      radius: 0.004,
      density: 0.1,
    },
  ]

  for (let i = 0; i < count; i++) {
    // Pick a cluster based on density
    const rand = Math.random()
    let cumulative = 0
    let selectedCluster = clusters[0]

    for (const cluster of clusters) {
      cumulative += cluster.density
      if (rand <= cumulative) {
        selectedCluster = cluster
        break
      }
    }

    // Generate random point within cluster.
    // A degree of longitude covers fewer real-world meters than a degree
    // of latitude as you move away from the equator (by a factor of
    // cos(latitude)). Without correcting for this, a fixed-radius scatter
    // in raw degrees produces an elongated (non-circular) footprint at
    // high latitude — same radius in degrees, but a much narrower true
    // width. Dividing the longitude offset by cos(latitude) compensates,
    // matching the correction already used in tiles.ts's getGroupingFactor.
    const angle = Math.random() * 2 * Math.PI
    const distance = Math.random() * selectedCluster.radius
    const latRad = (selectedCluster.lat * Math.PI) / 180

    const latitude = selectedCluster.lat + distance * Math.cos(angle)
    const longitude =
      selectedCluster.lng + (distance * Math.sin(angle)) / Math.cos(latRad)

    // Random content and tags
    const content =
      SEED_CONTENT[Math.floor(Math.random() * SEED_CONTENT.length)]
    const tagSet = SEED_TAGS[Math.floor(Math.random() * SEED_TAGS.length)]

    posts.push({
      content,
      tags: tagSet,
      latitude,
      longitude,
    })
  }

  return posts
}

export async function seedRoutes(fastify: FastifyInstance) {
  // Seed database with test posts
  fastify.post("/seed", async (request, reply) => {
    try {
      const body = request.body as {
        centerLat?: number
        centerLng?: number
        count?: number
        ttlDays?: number
      }

      const centerLat = body.centerLat ?? 37.7749 // Default: San Francisco
      const centerLng = body.centerLng ?? -122.4194
      const count = body.count ?? 200 // Default: 200 posts

      // Optional: override the normal 24h expires_at default so test data
      // survives a whole testing session. Omitted entirely for any other
      // caller — unchanged behavior, DB default (NOW() + 24h) still applies.
      const expiresAt = body.ttlDays
        ? new Date(
            Date.now() + body.ttlDays * 24 * 60 * 60 * 1000,
          ).toISOString()
        : undefined

      // Generate seed posts
      const seedPosts = generateSeedPosts(centerLat, centerLng, count)

      // Insert into database
      const insertedPosts = []
      for (const post of seedPosts) {
        const tileId = getTileId(post.latitude, post.longitude)

        const inserted = await db
          .insertInto("posts")
          .values({
            id: crypto.randomUUID(),
            user_id: null,
            content: post.content,
            photo_url: null,
            latitude: post.latitude,
            longitude: post.longitude,
            tile_id: tileId,
            tags: post.tags,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(expiresAt ? { expires_at: expiresAt } : {}),
          })
          .returningAll()
          .executeTakeFirst()

        if (inserted) {
          insertedPosts.push(inserted)
        }
      }

      return {
        success: true,
        message: `Seeded ${insertedPosts.length} posts`,
        center: { latitude: centerLat, longitude: centerLng },
        count: insertedPosts.length,
      }
    } catch (error) {
      console.error("Error seeding database:", error)
      reply.code(500).send({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to seed database",
      })
    }
  })

  // Clear posts. With no query params, wipes everything (use with
  // caution!) — same as before. Pass minLat/maxLat/minLng/maxLng to scope
  // the delete to a bounding box instead, e.g. to clear one test city's
  // seed data without touching the others. Param names match the
  // minLat/maxLat/minLng/maxLng convention already used by the
  // /api/posts/in-bounds and /api/posts/density-in-bounds routes.
  fastify.delete("/seed", async (request, reply) => {
    try {
      const { minLat, maxLat, minLng, maxLng } = request.query as {
        minLat?: string
        maxLat?: string
        minLng?: string
        maxLng?: string
      }

      const boundParams = [minLat, maxLat, minLng, maxLng]
      const boundsProvided = boundParams.some((p) => p !== undefined)
      const allBoundsProvided = boundParams.every((p) => p !== undefined)

      if (boundsProvided && !allBoundsProvided) {
        reply.code(400).send({
          success: false,
          error:
            "Provide all of minLat, maxLat, minLng, maxLng to scope the delete, or none to clear everything.",
        })
        return
      }

      let query = db.deleteFrom("posts")

      if (allBoundsProvided) {
        query = query
          .where("latitude", ">=", Number(minLat))
          .where("latitude", "<=", Number(maxLat))
          .where("longitude", ">=", Number(minLng))
          .where("longitude", "<=", Number(maxLng))
      }

      const result = await query.executeTakeFirst()

      return {
        success: true,
        message: allBoundsProvided
          ? "Deleted posts in bounds"
          : "Deleted all posts",
        deletedCount: Number(result.numDeletedRows),
      }
    } catch (error) {
      console.error("Error clearing database:", error)
      reply.code(500).send({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to clear database",
      })
    }
  })

  // Get post count by tile
  fastify.get("/seed/stats", async (request, reply) => {
    try {
      const stats = await db
        .selectFrom("posts")
        .select((eb) => ["tile_id", eb.fn.count("id").as("count")])
        .groupBy("tile_id")
        .orderBy("count", "desc")
        .limit(20)
        .execute()

      const totalPosts = await db
        .selectFrom("posts")
        .select((eb) => eb.fn.count("id").as("total"))
        .executeTakeFirst()

      return {
        success: true,
        totalPosts: Number(totalPosts?.total ?? 0),
        topTiles: stats.map((s) => ({
          tile_id: s.tile_id,
          count: Number(s.count),
        })),
      }
    } catch (error) {
      console.error("Error getting stats:", error)
      reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get stats",
      })
    }
  })
}
