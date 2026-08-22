import { db } from "../db/index.js"
import type { ReportReason } from "@loba/shared"

export class ModerationService {
  // ─── Reports ─────────────────────────────────────────────────────────

  /**
   * File a report against a post. Snapshots the post's content at report
   * time — see scripts/sql/024-ugc-moderation-and-bans.sql for why these
   * are plain copied columns, not FKs: the post may be archived or
   * hard-deleted (#13) before the report is ever reviewed, and the
   * evidence has to survive that.
   */
  async reportPost(
    postId: string,
    reporterUserId: string,
    reason: ReportReason,
  ): Promise<void> {
    const post = await db
      .selectFrom("posts")
      .select([
        "id",
        "content",
        "photo_url",
        "tags",
        "user_id",
        "tile_id",
        "created_at",
      ])
      .where("id", "=", postId)
      .executeTakeFirst()

    if (!post) {
      throw new Error("Post not found")
    }

    if (!post.user_id) {
      // Sentinel-authored ([deleted]) posts have no meaningful author to
      // hold accountable — nothing for a report to act on.
      throw new Error("This post can no longer be reported")
    }

    if (post.user_id === reporterUserId) {
      throw new Error("You cannot report your own post")
    }

    try {
      await db
        .insertInto("post_reports")
        .values({
          post_id: postId,
          reporter_user_id: reporterUserId,
          reason,
          content_snapshot: post.content,
          photo_url_snapshot: post.photo_url,
          tags_snapshot: post.tags,
          post_user_id_snapshot: post.user_id,
          tile_id_snapshot: post.tile_id,
          post_created_at_snapshot: post.created_at,
        })
        .execute()
    } catch (err) {
      // Unique violation on (post_id, reporter_user_id)
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        throw new Error("You have already reported this post")
      }
      throw err
    }
  }
}
