import { db } from "../db/index.js"
import { sql } from "kysely"
import { getTileId } from "../db/tiles.js"
import { generateDisplayName } from "../utils/displayName.js"
import {
  isWithinProximity,
  computeExtendedExpiry,
  DEFAULT_TTL_HOURS,
} from "../utils/proximity.js"
import type {
  Post,
  PublicPost,
  OwnPost,
  CreatePostRequest,
  UserProfile,
} from "@loba/shared"
import { normalizeTags } from "@loba/shared"
import {
  GRID_REFERENCE_LATITUDE,
  computeGridRect,
  type GridRect,
} from "../utils/grouping.js"

export class PostService {
  // ─── Post creation (proximity-gated) ────────────────────────────────

  async createPost(data: CreatePostRequest, userId: string): Promise<OwnPost> {
    const tileId = getTileId(data.latitude, data.longitude)
    const postId = crypto.randomUUID()
    const now = new Date()
    const expiresAt = new Date(
      now.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000,
    )

    const row = await db
      .insertInto("posts")
      .values({
        id: postId,
        user_id: userId,
        content: data.content,
        photo_url: data.photo_url || null,
        latitude: data.latitude,
        longitude: data.longitude,
        tile_id: tileId,
        tags: normalizeTags(data.tags),
        expires_at: expiresAt.toISOString(),
        archived_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    const profile = await this.getProfile(userId)

    return this.toOwnPost(row as unknown as Post, profile)
  }

  // ─── Post deletion ──────────────────────────────────────────────────

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

  // ─── Reactions (proximity-gated) ────────────────────────────────────

  async reactToPost(
    postId: string,
    userId: string,
    reaction: "upvote" | "downvote",
    userLat: number,
    userLng: number,
  ): Promise<{
    reaction: "upvote" | "downvote" | null
    upvote_count: number
    downvote_count: number
    new_expires_at: string
  }> {
    // 1. Get the post
    const post = await db
      .selectFrom("posts")
      .select([
        "id",
        "user_id",
        "latitude",
        "longitude",
        "expires_at",
        "created_at",
        "archived_at",
        "upvote_count",
        "downvote_count",
      ])
      .where("id", "=", postId)
      .executeTakeFirst()

    if (!post) {
      throw new Error("Post not found")
    }

    if (post.archived_at) {
      throw new Error("Post has been archived")
    }

    if (post.user_id === userId) {
      throw new Error("Cannot react to your own post")
    }

    // 2. Proximity check
    const postLat =
      typeof post.latitude === "string"
        ? parseFloat(post.latitude)
        : post.latitude
    const postLng =
      typeof post.longitude === "string"
        ? parseFloat(post.longitude)
        : post.longitude

    if (!isWithinProximity(userLat, userLng, postLat, postLng)) {
      throw new Error("You must be near this post to react")
    }

    // 3. Check for existing reaction
    const existing = await db
      .selectFrom("post_reactions")
      .select(["id", "reaction"])
      .where("post_id", "=", postId)
      .where("user_id", "=", userId)
      .executeTakeFirst()

    let finalReaction: "upvote" | "downvote" | null = reaction
    let upvoteDelta = 0
    let downvoteDelta = 0
    let shouldExtendTTL = false

    if (existing) {
      if (existing.reaction === reaction) {
        // Same reaction again → toggle off (remove)
        await db
          .deleteFrom("post_reactions")
          .where("id", "=", existing.id)
          .execute()
        finalReaction = null
        if (reaction === "upvote") upvoteDelta = -1
        else downvoteDelta = -1
      } else {
        // Switching reaction
        await db
          .updateTable("post_reactions")
          .set({ reaction, latitude: userLat, longitude: userLng })
          .where("id", "=", existing.id)
          .execute()
        if (reaction === "upvote") {
          upvoteDelta = 1
          downvoteDelta = -1
          shouldExtendTTL = true
        } else {
          upvoteDelta = -1
          downvoteDelta = 1
        }
      }
    } else {
      // New reaction
      await db
        .insertInto("post_reactions")
        .values({
          post_id: postId,
          user_id: userId,
          reaction,
          latitude: userLat,
          longitude: userLng,
        })
        .execute()
      if (reaction === "upvote") {
        upvoteDelta = 1
        shouldExtendTTL = true
      } else {
        downvoteDelta = 1
      }
    }

    // 4. Update denormalized counts
    const newUpvoteCount = Math.max(0, Number(post.upvote_count) + upvoteDelta)
    const newDownvoteCount = Math.max(
      0,
      Number(post.downvote_count) + downvoteDelta,
    )

    // 5. Extend TTL if this was an upvote
    let newExpiresAt = post.expires_at as string
    if (shouldExtendTTL) {
      const extended = computeExtendedExpiry(post.expires_at, post.created_at)
      newExpiresAt = extended.toISOString()
    }

    await db
      .updateTable("posts")
      .set({
        upvote_count: newUpvoteCount,
        downvote_count: newDownvoteCount,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", postId)
      .execute()

    return {
      reaction: finalReaction,
      upvote_count: newUpvoteCount,
      downvote_count: newDownvoteCount,
      new_expires_at: newExpiresAt,
    }
  }

  // ─── Public queries (for map display) ───────────────────────────────

  async getPostsByTiles(
    tileIds: string[],
    limit: number = 50,
    requestingUserId?: string,
  ): Promise<PublicPost[]> {
    const posts = await db
      .selectFrom("posts")
      .selectAll()
      .where("tile_id", "in", tileIds)
      .where("archived_at", "is", null)
      .where("expires_at", ">", new Date().toISOString())
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute()

    return this.toPublicPosts(posts as unknown as Post[], requestingUserId)
  }

  async getPostById(
    id: string,
    requestingUserId?: string,
  ): Promise<PublicPost | null> {
    const post = await db
      .selectFrom("posts")
      .selectAll()
      .where("id", "=", id)
      .where("archived_at", "is", null)
      .executeTakeFirst()

    if (!post) return null

    const posts = await this.toPublicPosts(
      [post as unknown as Post],
      requestingUserId,
    )
    return posts[0]
  }

  // ─── Private queries (for the authenticated user) ──────────────────

  async getMyPosts(userId: string, limit: number = 100): Promise<OwnPost[]> {
    // Show the user ALL their posts, including expired ones (but not archived)
    const posts = await db
      .selectFrom("posts")
      .selectAll()
      .where("user_id", "=", userId)
      .where("archived_at", "is", null)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute()

    const profile = await this.getProfile(userId)

    return (posts as unknown as Post[]).map((post) =>
      this.toOwnPost(post, profile),
    )
  }

  // ─── Spatial queries (for map display) ────────────────────────────

  async getPostsInBounds(
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    limit: number = 5000,
    requestingUserId?: string,
    tags?: string[],
  ): Promise<{ posts: PublicPost[]; dbQueryTime: number }> {
    const startTime = Date.now()
    const now = new Date().toISOString()

    let query = db
      .selectFrom("posts")
      .selectAll()
      .where(
        sql<boolean>`location && ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326)`,
      )
      .where("archived_at", "is", null)
      .where("expires_at", ">", now)

    if (tags && tags.length > 0) {
      const normalizedTags = normalizeTags(tags)
      query = query.where(
        sql<boolean>`tags && ARRAY[${sql.join(normalizedTags.map((t) => sql`${t}`))}]::text[]`,
      )
    }

    const posts = await query.limit(limit).execute()

    const dbQueryTime = Date.now() - startTime

    const publicPosts = await this.toPublicPosts(
      posts as unknown as Post[],
      requestingUserId,
    )

    return { posts: publicPosts, dbQueryTime }
  }

  // ─── Archival (called by cron/background job) ─────────────────────

  async archiveExpiredPosts(): Promise<number> {
    const now = new Date().toISOString()

    const result = await db
      .updateTable("posts")
      .set({ archived_at: now })
      .where("expires_at", "<=", now)
      .where("archived_at", "is", null)
      .executeTakeFirst()

    return Number(result.numUpdatedRows)
  }

  // ─── Tag queries ──────────────────────────────────────────────────

  async getPopularTags(
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    limit: number = 20,
  ): Promise<{ tag: string; count: number }[]> {
    const result = await sql<{ tag: string; count: string }>`
      SELECT unnest(tags) AS tag, COUNT(*) AS count
      FROM posts
      WHERE array_length(tags, 1) > 0
        AND archived_at IS NULL
        AND expires_at > NOW()
        AND location && ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326)
      GROUP BY tag
      ORDER BY count DESC
      LIMIT ${limit}
    `.execute(db)

    return result.rows.map((r) => ({
      tag: r.tag,
      count: Number(r.count),
    }))
  }

  // ─── Density query ──────────────────────────────────────────────────

  /**
   * Get sparse post density for a viewport, as a world-anchored M x N
   * supertile grid: the grid's own metadata (groupingFactor, origin,
   * dimensions, exact real-world bounds) plus only the non-empty cells
   * within it, each as {row, col, count} relative to that origin.
   *
   * Takes the client's raw viewport parameters directly -- latitude,
   * longitude, deltas, viewport width -- rather than a pre-computed
   * bounding box or groupingFactor. The server is now the only place
   * that computes grid identity or supertile geometry; the client sends
   * what it's showing and displays whatever grid this returns, doing no
   * geographic math of its own. See computeGridRect in utils/grouping.ts
   * for the actual grid math (grouping factor selection, snapping,
   * GRID_REFERENCE_LATITUDE) -- this function's job is just the query
   * and shaping the result around that grid.
   *
   * Applies the same archived_at/expires_at filters as getPostsInBounds
   * so a marker's count never includes posts TileDetailsModal wouldn't
   * show — otherwise count and tap-in content silently disagree.
   */
  async getPostDensity(
    latitude: number,
    longitude: number,
    latitudeDelta: number,
    longitudeDelta: number,
    viewportWidthPx: number,
    tags?: string[],
  ): Promise<
    GridRect & { cells: { row: number; col: number; count: number }[] }
  > {
    const tagFilter =
      tags && tags.length > 0
        ? sql`AND tags && ARRAY[${sql.join(normalizeTags(tags).map((t) => sql`${t}`))}]::text[]`
        : sql``

    const gridRect = computeGridRect(
      latitude,
      longitude,
      latitudeDelta,
      longitudeDelta,
      viewportWidthPx,
    )
    const { groupingFactor, gridOrigin, bounds } = gridRect

    const result = await sql<{ row: string; col: string; count: string }>`
      WITH supertiles AS (
        SELECT
          floor(
            floor(latitude * 111320 / 3) / ${groupingFactor}
          ) - ${gridOrigin.latTile} AS row,
          floor(
            floor(longitude * 111320 * cos(radians(${GRID_REFERENCE_LATITUDE})) / 3) / ${groupingFactor}
          ) - ${gridOrigin.lngTile} AS col
        FROM posts
        WHERE location && ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326)
          AND archived_at IS NULL
          AND expires_at > NOW()
          ${tagFilter}
      )
      SELECT row, col, COUNT(*) AS count
      FROM supertiles
      GROUP BY row, col
    `.execute(db)

    return {
      ...gridRect,
      cells: result.rows.map((r) => ({
        row: Number(r.row),
        col: Number(r.col),
        count: Number(r.count),
      })),
    }
  }

  // ─── Paginated per-supertile detail query ────────────────────────────

  /**
   * Get posts belonging to a single supertile, cursor-paginated.
   * Backs TileDetailsModal — the only place full post content is
   * fetched, scoped to exactly the tapped supertile.
   *
   * Cursor (not offset) because posts churn via TTL expiry: a user
   * scrolling while posts expire underneath them shouldn't see
   * duplicates or skips.
   */
  async getPostsInSupertile(
    supertileId: string,
    groupingFactor: number,
    requestingUserId?: string,
    cursor?: { createdAt: string; id: string },
    limit: number = 25,
  ): Promise<{
    posts: PublicPost[]
    nextCursor: { createdAt: string; id: string } | null
  }> {
    const [superLatTile, superLngTile] = supertileId.split(":").map(Number)
    const now = new Date().toISOString()

    // Grid identity (which supertile a post belongs to) must use
    // GRID_REFERENCE_LATITUDE, matching getPostDensity above and the
    // client -- this function receives no bounds/viewport at all, just
    // a bare supertileId, so unlike getPostDensity there was never a
    // per-request value available to derive here even during the
    // intermediate fix. A post whose own latitude previously put it in
    // a different bucket than getPostDensity's GROUP BY used could be
    // counted in a marker's total but missing from that marker's tapped
    // detail view, or vice versa.
    let query = db
      .selectFrom("posts")
      .selectAll()
      .where(
        sql<boolean>`floor(floor(latitude * 111320 / 3) / ${groupingFactor}) = ${superLatTile}`,
      )
      .where(
        sql<boolean>`floor(floor(longitude * 111320 * cos(radians(${GRID_REFERENCE_LATITUDE})) / 3) / ${groupingFactor}) = ${superLngTile}`,
      )
      .where("archived_at", "is", null)
      .where("expires_at", ">", now)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")

    if (cursor) {
      query = query.where(
        sql<boolean>`(created_at, id) < (${cursor.createdAt}, ${cursor.id})`,
      )
    }

    const posts = await query.limit(limit + 1).execute()

    const hasMore = posts.length > limit
    const pagePosts = hasMore ? posts.slice(0, limit) : posts

    const nextCursor = hasMore
      ? {
          createdAt: pagePosts[pagePosts.length - 1].created_at,
          id: pagePosts[pagePosts.length - 1].id,
        }
      : null

    const publicPosts = await this.toPublicPosts(
      pagePosts as unknown as Post[],
      requestingUserId,
    )

    return { posts: publicPosts, nextCursor }
  }

  // ─── Post transformation ───────────────────────────────────────────

  private async toPublicPosts(
    posts: Post[],
    requestingUserId?: string,
  ): Promise<PublicPost[]> {
    if (posts.length === 0) return []

    const userIds = [
      ...new Set(posts.map((p) => p.user_id).filter(Boolean)),
    ] as string[]
    const profileMap = await this.getProfiles(userIds)

    // Batch-fetch the requesting user's reactions for these posts
    let userReactionMap = new Map<string, "upvote" | "downvote">()
    if (requestingUserId) {
      const postIds = posts.map((p) => p.id)
      userReactionMap = await this.getUserReactions(requestingUserId, postIds)
    }

    return posts.map((post) => {
      const profile = post.user_id ? profileMap.get(post.user_id) : undefined
      const displayName = post.user_id
        ? generateDisplayName(post.user_id, post.id)
        : "Anonymous"
      const isVerified = profile?.verification_status === "verified"
      const isOwn = !!requestingUserId && post.user_id === requestingUserId

      const { user_id: _uid, ...rest } = post

      return {
        ...rest,
        display_name: displayName,
        is_verified: isVerified,
        is_own: isOwn,
        user_reaction: userReactionMap.get(post.id) || null,
      }
    })
  }

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

  // ─── Reaction lookups ─────────────────────────────────────────────

  private async getUserReactions(
    userId: string,
    postIds: string[],
  ): Promise<Map<string, "upvote" | "downvote">> {
    if (postIds.length === 0) return new Map()

    const reactions = await db
      .selectFrom("post_reactions")
      .select(["post_id", "reaction"])
      .where("user_id", "=", userId)
      .where("post_id", "in", postIds)
      .execute()

    const map = new Map<string, "upvote" | "downvote">()
    for (const r of reactions) {
      map.set(r.post_id, r.reaction)
    }
    return map
  }

  // ─── Profile lookups ───────────────────────────────────────────────

  private async getProfile(userId: string): Promise<UserProfile | undefined> {
    const profile = await db
      .selectFrom("user_profiles")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst()

    return (profile as UserProfile | undefined) || undefined
  }

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
      map.set(p.user_id, p as UserProfile)
    }
    return map
  }
}
