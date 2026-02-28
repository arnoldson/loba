import { db } from "../db/index.js";
import { sql } from "kysely";
import { getTileId } from "../db/tiles.js";
import { generateDisplayName } from "../utils/displayName.js";
import {
  isWithinProximity,
  computeExtendedExpiry,
  DEFAULT_TTL_HOURS,
} from "../utils/proximity.js";
import type {
  Post,
  PublicPost,
  OwnPost,
  CreatePostRequest,
  UserProfile,
} from "@loba/shared";

export class PostService {
  // ─── Post creation (proximity-gated) ────────────────────────────────

  async createPost(data: CreatePostRequest, userId: string): Promise<OwnPost> {
    // Proximity check: user must be at the spot they're posting to.
    // For post creation, the user's location IS the post location,
    // so we just verify lat/lng are present and valid.
    // (The real gate is on the frontend sending real GPS, but we
    // could add server-side device-location verification later.)

    const tileId = getTileId(data.latitude, data.longitude);
    const postId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000,
    );

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
        expires_at: expiresAt.toISOString(),
        archived_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const profile = await this.getProfile(userId);

    return this.toOwnPost(row as unknown as Post, profile);
  }

  // ─── Post deletion ──────────────────────────────────────────────────

  async deletePost(postId: string, userId: string): Promise<void> {
    const post = await db
      .selectFrom("posts")
      .select(["id", "user_id"])
      .where("id", "=", postId)
      .executeTakeFirst();

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.user_id !== userId) {
      throw new Error("Not authorized to delete this post");
    }

    await db.deleteFrom("posts").where("id", "=", postId).execute();
  }

  // ─── Reactions (proximity-gated) ────────────────────────────────────

  async reactToPost(
    postId: string,
    userId: string,
    reaction: "like" | "dislike",
    userLat: number,
    userLng: number,
  ): Promise<{
    reaction: "like" | "dislike" | null;
    like_count: number;
    dislike_count: number;
    new_expires_at: string;
  }> {
    // 1. Get the post
    const post = await db
      .selectFrom("posts")
      .select([
        "id",
        "latitude",
        "longitude",
        "expires_at",
        "created_at",
        "archived_at",
        "like_count",
        "dislike_count",
      ])
      .where("id", "=", postId)
      .executeTakeFirst();

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.archived_at) {
      throw new Error("Post has been archived");
    }

    // 2. Proximity check
    const postLat =
      typeof post.latitude === "string"
        ? parseFloat(post.latitude)
        : post.latitude;
    const postLng =
      typeof post.longitude === "string"
        ? parseFloat(post.longitude)
        : post.longitude;

    if (!isWithinProximity(userLat, userLng, postLat, postLng)) {
      throw new Error("You must be near this post to react");
    }

    // 3. Check for existing reaction
    const existing = await db
      .selectFrom("post_reactions")
      .select(["id", "reaction"])
      .where("post_id", "=", postId)
      .where("user_id", "=", userId)
      .executeTakeFirst();

    let finalReaction: "like" | "dislike" | null = reaction;
    let likeDelta = 0;
    let dislikeDelta = 0;
    let shouldExtendTTL = false;

    if (existing) {
      if (existing.reaction === reaction) {
        // Same reaction again → toggle off (remove)
        await db
          .deleteFrom("post_reactions")
          .where("id", "=", existing.id)
          .execute();
        finalReaction = null;
        if (reaction === "like") likeDelta = -1;
        else dislikeDelta = -1;
      } else {
        // Switching reaction
        await db
          .updateTable("post_reactions")
          .set({ reaction, latitude: userLat, longitude: userLng })
          .where("id", "=", existing.id)
          .execute();
        if (reaction === "like") {
          likeDelta = 1;
          dislikeDelta = -1;
          shouldExtendTTL = true;
        } else {
          likeDelta = -1;
          dislikeDelta = 1;
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
        .execute();
      if (reaction === "like") {
        likeDelta = 1;
        shouldExtendTTL = true;
      } else {
        dislikeDelta = 1;
      }
    }

    // 4. Update denormalized counts
    const newLikeCount = Math.max(0, Number(post.like_count) + likeDelta);
    const newDislikeCount = Math.max(
      0,
      Number(post.dislike_count) + dislikeDelta,
    );

    // 5. Extend TTL if this was a like
    let newExpiresAt = post.expires_at as string;
    if (shouldExtendTTL) {
      const extended = computeExtendedExpiry(post.expires_at, post.created_at);
      newExpiresAt = extended.toISOString();
    }

    await db
      .updateTable("posts")
      .set({
        like_count: newLikeCount,
        dislike_count: newDislikeCount,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", postId)
      .execute();

    return {
      reaction: finalReaction,
      like_count: newLikeCount,
      dislike_count: newDislikeCount,
      new_expires_at: newExpiresAt,
    };
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
      .execute();

    return this.toPublicPosts(posts as unknown as Post[], requestingUserId);
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
      .executeTakeFirst();

    if (!post) return null;

    const posts = await this.toPublicPosts(
      [post as unknown as Post],
      requestingUserId,
    );
    return posts[0];
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
      .execute();

    const profile = await this.getProfile(userId);

    return (posts as unknown as Post[]).map((post) =>
      this.toOwnPost(post, profile),
    );
  }

  // ─── Spatial queries (for map display) ────────────────────────────

  async getPostsInBounds(
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    limit: number = 5000,
    requestingUserId?: string,
    tags?: string[],
  ): Promise<{ posts: PublicPost[]; dbQueryTime: number }> {
    const startTime = Date.now();
    const now = new Date().toISOString();

    let query = db
      .selectFrom("posts")
      .selectAll()
      .where(
        sql<boolean>`location && ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326)`,
      )
      .where("archived_at", "is", null)
      .where("expires_at", ">", now);

    if (tags && tags.length > 0) {
      query = query.where(
        sql<boolean>`tags && ARRAY[${sql.join(tags.map((t) => sql`${t}`))}]::text[]`,
      );
    }

    const posts = await query.limit(limit).execute();

    const dbQueryTime = Date.now() - startTime;

    const publicPosts = await this.toPublicPosts(
      posts as unknown as Post[],
      requestingUserId,
    );

    return { posts: publicPosts, dbQueryTime };
  }

  // ─── Archival (called by cron/background job) ─────────────────────

  async archiveExpiredPosts(): Promise<number> {
    const now = new Date().toISOString();

    const result = await db
      .updateTable("posts")
      .set({ archived_at: now })
      .where("expires_at", "<=", now)
      .where("archived_at", "is", null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  // ─── Tag queries ──────────────────────────────────────────────────

  async getPopularTags(
    limit: number = 20,
  ): Promise<{ tag: string; count: number }[]> {
    const result = await sql<{ tag: string; count: string }>`
      SELECT unnest(tags) AS tag, COUNT(*) AS count
      FROM posts
      WHERE array_length(tags, 1) > 0
        AND archived_at IS NULL
        AND expires_at > NOW()
      GROUP BY tag
      ORDER BY count DESC
      LIMIT ${limit}
    `.execute(db);

    return result.rows.map((r) => ({
      tag: r.tag,
      count: Number(r.count),
    }));
  }

  // ─── Post transformation ───────────────────────────────────────────

  private async toPublicPosts(
    posts: Post[],
    requestingUserId?: string,
  ): Promise<PublicPost[]> {
    if (posts.length === 0) return [];

    const userIds = [
      ...new Set(posts.map((p) => p.user_id).filter(Boolean)),
    ] as string[];
    const profileMap = await this.getProfiles(userIds);

    // Batch-fetch the requesting user's reactions for these posts
    let userReactionMap = new Map<string, "like" | "dislike">();
    if (requestingUserId) {
      const postIds = posts.map((p) => p.id);
      userReactionMap = await this.getUserReactions(requestingUserId, postIds);
    }

    return posts.map((post) => {
      const profile = post.user_id ? profileMap.get(post.user_id) : undefined;
      const displayName = post.user_id
        ? generateDisplayName(post.user_id, post.id)
        : "Anonymous";
      const isVerified = profile?.verification_status === "verified";
      const isOwn = !!requestingUserId && post.user_id === requestingUserId;

      const { user_id: _uid, ...rest } = post;

      return {
        ...rest,
        display_name: displayName,
        is_verified: isVerified,
        is_own: isOwn,
        user_reaction: userReactionMap.get(post.id) || null,
      };
    });
  }

  private toOwnPost(post: Post, profile: UserProfile | undefined): OwnPost {
    return {
      ...post,
      display_name: post.user_id
        ? generateDisplayName(post.user_id, post.id)
        : "Anonymous",
      is_verified: profile?.verification_status === "verified",
      is_own: true as const,
    };
  }

  // ─── Reaction lookups ─────────────────────────────────────────────

  private async getUserReactions(
    userId: string,
    postIds: string[],
  ): Promise<Map<string, "like" | "dislike">> {
    if (postIds.length === 0) return new Map();

    const reactions = await db
      .selectFrom("post_reactions")
      .select(["post_id", "reaction"])
      .where("user_id", "=", userId)
      .where("post_id", "in", postIds)
      .execute();

    const map = new Map<string, "like" | "dislike">();
    for (const r of reactions) {
      map.set(r.post_id, r.reaction);
    }
    return map;
  }

  // ─── Profile lookups ───────────────────────────────────────────────

  private async getProfile(userId: string): Promise<UserProfile | undefined> {
    const profile = await db
      .selectFrom("user_profiles")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();

    return (profile as UserProfile | undefined) || undefined;
  }

  private async getProfiles(
    userIds: string[],
  ): Promise<Map<string, UserProfile>> {
    if (userIds.length === 0) return new Map();

    const profiles = await db
      .selectFrom("user_profiles")
      .selectAll()
      .where("user_id", "in", userIds)
      .execute();

    const map = new Map<string, UserProfile>();
    for (const p of profiles) {
      map.set(p.user_id, p as UserProfile);
    }
    return map;
  }
}
