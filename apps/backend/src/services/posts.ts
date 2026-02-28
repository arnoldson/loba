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

  async createPost(data: CreatePostRequest, userId: string): Promise<OwnPost> {
    const tileId = getTileId(data.latitude, data.longitude)
    const postId = crypto.randomUUID()

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
        tags: data.tags,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
    const posts = await db
      .selectFrom("posts")
      .selectAll()
      .where("user_id", "=", userId)
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

    let query = db
      .selectFrom("posts")
      .selectAll()
      .where(
        sql<boolean>`location && ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326)`,
      )

    if (tags && tags.length > 0) {
      query = query.where(
        sql<boolean>`tags && ARRAY[${sql.join(tags.map((t) => sql`${t}`))}]::text[]`,
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

  // ─── Tag queries ──────────────────────────────────────────────────

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

  private async toPublicPosts(
    posts: Post[],
    requestingUserId?: string,
  ): Promise<PublicPost[]> {
    if (posts.length === 0) return []

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

      const { user_id: _uid, ...rest } = post

      return {
        ...rest,
        display_name: displayName,
        is_verified: isVerified,
        is_own: isOwn,
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
