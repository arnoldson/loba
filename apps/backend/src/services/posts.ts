import { db } from "../db/index.js"
import { sql } from "kysely"
import { getTileId } from "../db/tiles.js"
import { generateDisplayName } from "../utils/displayName.js"
import type {
  Post,
  PublicPost,
  OwnPost,
  CreatePostRequest,
  UserProfile,
} from "@loba/shared"

export class PostService {
  // ─── Post creation ──────────────────────────────────────────────────

  /**
   * Create a new post linked to an authenticated user.
   */
  async createPost(data: CreatePostRequest, userId: string): Promise<OwnPost> {
    const tileId = getTileId(data.latitude, data.longitude)
    const postId = crypto.randomUUID()

    const post = await db
      .insertInto("posts")
      .values({
        id: postId,
        user_id: userId,
        content: data.content,
        photo_url: data.photo_url || null,
        latitude: data.latitude,
        longitude: data.longitude,
        tile_id: tileId,
        tags: data.tags,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    const profile = await this.getProfile(userId)

    return this.toOwnPost(post, profile)
  }

  // ─── Post deletion ──────────────────────────────────────────────────

  /**
   * Delete a post. Only the post author can delete it.
   * Comments are cascade-deleted by the DB foreign key constraint.
   */
  async deletePost(postId: string, userId: string): Promise<void> {
    const post = await db
      .selectFrom("posts")
      .select(["id", "user_id"])
      .where("id", "=", postId)
      .executeTakeFirst()

    if (!post) {
      throw new Error("Post not found")
    }

    if (post.user_id !== userId) {
      throw new Error("Not authorized to delete this post")
    }

    await db.deleteFrom("posts").where("id", "=", postId).execute()
  }

  // ─── Public queries (for map display) ───────────────────────────────

  /**
   * Get posts by tile IDs, returned as PublicPosts (no user_id exposed).
   * If `requestingUserId` is provided, the caller's own posts are marked.
   */
  async getPostsByTiles(
    tileIds: string[],
    limit: number = 50,
    requestingUserId?: string,
  ): Promise<PublicPost[]> {
    const posts = await db
      .selectFrom("posts")
      .selectAll()
      .where("tile_id", "in", tileIds)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute()

    return this.toPublicPosts(posts, requestingUserId)
  }

  /**
   * Get a single post by ID, returned as a PublicPost.
   */
  async getPostById(
    id: string,
    requestingUserId?: string,
  ): Promise<PublicPost | null> {
    const post = await db
      .selectFrom("posts")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()

    if (!post) return null

    const posts = await this.toPublicPosts([post], requestingUserId)
    return posts[0]
  }

  // ─── Private queries (for the authenticated user) ──────────────────

  /**
   * Get all posts by the authenticated user ("My Posts" view).
   */
  async getMyPosts(userId: string, limit: number = 100): Promise<OwnPost[]> {
    const posts = await db
      .selectFrom("posts")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute()

    const profile = await this.getProfile(userId)

    return posts.map((post) => this.toOwnPost(post, profile))
  }

  // ─── Spatial queries (for map display) ────────────────────────────

  /**
   * Get posts within a geographic bounding box using PostGIS.
   * Optionally filter by tags (array overlap — post has ANY of the selected tags).
   * Returns PublicPosts with display names and verification badges.
   */
  async getPostsInBounds(
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    limit: number = 5000,
    requestingUserId?: string,
    tags?: string[],
  ): Promise<{ posts: PublicPost[]; dbQueryTime: number }> {
    const startTime = Date.now()

    let query = db
      .selectFrom("posts")
      .selectAll()
      .where(
        sql<boolean>`location && ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326)`,
      )

    // Filter by tags if provided (array overlap — post has ANY of the selected tags)
    if (tags && tags.length > 0) {
      query = query.where(
        sql<boolean>`tags && ARRAY[${sql.join(tags.map((t) => sql`${t}`))}]::text[]`,
      )
    }

    const posts = await query.limit(limit).execute()

    const dbQueryTime = Date.now() - startTime

    const publicPosts = await this.toPublicPosts(posts, requestingUserId)

    return { posts: publicPosts, dbQueryTime }
  }

  // ─── Tag queries ──────────────────────────────────────────────────

  /**
   * Get the most popular tags across all posts.
   * Unnests the tags array and counts occurrences.
   */
  async getPopularTags(
    limit: number = 20,
  ): Promise<{ tag: string; count: number }[]> {
    const result = await sql<{ tag: string; count: string }>`
      SELECT unnest(tags) AS tag, COUNT(*) AS count
      FROM posts
      WHERE array_length(tags, 1) > 0
      GROUP BY tag
      ORDER BY count DESC
      LIMIT ${limit}
    `.execute(db)

    return result.rows.map((r) => ({
      tag: r.tag,
      count: Number(r.count),
    }))
  }

  // ─── Post transformation ───────────────────────────────────────────

  /**
   * Convert raw DB posts to PublicPosts.
   * - Strips user_id
   * - Adds deterministic display_name
   * - Adds is_verified badge
   * - Adds is_own flag when requestingUserId matches
   *
   * Batches profile lookups to avoid N+1 queries.
   */
  private async toPublicPosts(
    posts: Post[],
    requestingUserId?: string,
  ): Promise<PublicPost[]> {
    if (posts.length === 0) return []

    // Collect unique user_ids and batch-fetch their verification status
    const userIds = [
      ...new Set(posts.map((p) => p.user_id).filter(Boolean)),
    ] as string[]
    const profileMap = await this.getProfiles(userIds)

    return posts.map((post) => {
      const profile = post.user_id ? profileMap.get(post.user_id) : undefined
      const displayName = post.user_id
        ? generateDisplayName(post.user_id, post.id)
        : "Anonymous"
      const isVerified = profile?.verification_status === "verified"
      const isOwn = !!requestingUserId && post.user_id === requestingUserId

      // Strip user_id from the public response
      const { user_id, ...rest } = post

      return {
        ...rest,
        display_name: displayName,
        is_verified: isVerified,
        is_own: isOwn,
      }
    })
  }

  /**
   * Convert a raw DB post to an OwnPost (for the author).
   * Keeps user_id since the author is allowed to see it.
   */
  private toOwnPost(post: Post, profile: UserProfile | undefined): OwnPost {
    return {
      ...post,
      display_name: post.user_id
        ? generateDisplayName(post.user_id, post.id)
        : "Anonymous",
      is_verified: profile?.verification_status === "verified",
      is_own: true as const,
    }
  }

  // ─── Profile lookups ───────────────────────────────────────────────

  /**
   * Get a single user's profile.
   */
  private async getProfile(userId: string): Promise<UserProfile | undefined> {
    const profile = await db
      .selectFrom("user_profiles")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst()

    return profile || undefined
  }

  /**
   * Batch-fetch profiles for multiple user IDs.
   * Returns a Map for O(1) lookup per post.
   */
  private async getProfiles(
    userIds: string[],
  ): Promise<Map<string, UserProfile>> {
    if (userIds.length === 0) return new Map()

    const profiles = await db
      .selectFrom("user_profiles")
      .selectAll()
      .where("user_id", "in", userIds)
      .execute()

    const map = new Map<string, UserProfile>()
    for (const p of profiles) {
      map.set(p.user_id, p)
    }
    return map
  }
}
