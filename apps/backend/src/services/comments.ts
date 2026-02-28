import { db } from "../db/index.js"
import { generateDisplayName } from "../utils/displayName.js"
import type { PublicComment, UserProfile } from "@loba/shared"

// Internal type matching what Kysely returns from the comments table
interface CommentRow {
  id: string
  post_id: string
  user_id: string
  content: string
  created_at: string
}

export class CommentService {
  // ─── Create a comment ───────────────────────────────────────────────

  /**
   * Create a comment on a post. Returns a PublicComment (safe to send to client).
   */
  async createComment(
    postId: string,
    userId: string,
    content: string,
  ): Promise<PublicComment> {
    // Verify the post exists
    const post = await db
      .selectFrom("posts")
      .select("id")
      .where("id", "=", postId)
      .executeTakeFirst()

    if (!post) {
      throw new Error("Post not found")
    }

    const comment = await db
      .insertInto("comments")
      .values({
        post_id: postId,
        user_id: userId,
        content,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    const profile = await this.getProfile(userId)

    return this.toPublicComment(comment as CommentRow, profile, userId)
  }

  // ─── Fetch comments for a post ─────────────────────────────────────

  /**
   * Get all comments for a post, returned as PublicComments.
   * Ordered chronologically (oldest first) so threads read naturally.
   */
  async getCommentsByPostId(
    postId: string,
    requestingUserId?: string,
    limit: number = 200,
  ): Promise<PublicComment[]> {
    const comments = await db
      .selectFrom("comments")
      .selectAll()
      .where("post_id", "=", postId)
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute()

    return this.toPublicComments(comments as CommentRow[], requestingUserId)
  }

  // ─── Delete a comment ──────────────────────────────────────────────

  /**
   * Delete a comment. Only the comment author can delete it.
   */
  async deleteComment(commentId: string, userId: string): Promise<void> {
    const comment = await db
      .selectFrom("comments")
      .select(["id", "user_id"])
      .where("id", "=", commentId)
      .executeTakeFirst()

    if (!comment) {
      throw new Error("Comment not found")
    }

    if (comment.user_id !== userId) {
      throw new Error("Not authorized to delete this comment")
    }

    await db.deleteFrom("comments").where("id", "=", commentId).execute()
  }

  // ─── Comment transformation ────────────────────────────────────────

  private async toPublicComments(
    comments: CommentRow[],
    requestingUserId?: string,
  ): Promise<PublicComment[]> {
    if (comments.length === 0) return []

    const userIds = [...new Set(comments.map((c) => c.user_id))]
    const profileMap = await this.getProfiles(userIds)

    return comments.map((comment) => {
      return this.toPublicComment(
        comment,
        profileMap.get(comment.user_id),
        requestingUserId,
      )
    })
  }

  private toPublicComment(
    comment: CommentRow,
    profile: UserProfile | undefined,
    requestingUserId?: string,
  ): PublicComment {
    const displayName = generateDisplayName(comment.user_id, comment.post_id)
    const isVerified = profile?.verification_status === "verified"
    const isOwn = comment.user_id === requestingUserId

    const { user_id: _uid, ...rest } = comment

    return {
      ...rest,
      display_name: displayName,
      is_verified: isVerified,
      is_own: isOwn,
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
