import { sql, type RawBuilder } from "kysely"
import { db } from "../db/index.js"

/**
 * SQL condition hiding content the viewer has blocked (#83). Pass the
 * table whose rows are being filtered ("posts" or "comments").
 *
 * Future-only by design (see scripts/sql/083-user-blocks.sql): a row is
 * hidden if it's the exact item the viewer blocked from, or if its author
 * is blocked and it was created after that block. Older content from a
 * blocked author stays visible, so blocking never reveals which other
 * posts share an author. NOT EXISTS rather than NOT IN because
 * posts.user_id is nullable, and NOT IN against NULL hides the row.
 *
 * No viewer (signed out) means nothing to filter.
 */
export function notBlockedBy(
  table: "posts" | "comments",
  viewerId: string | undefined,
): RawBuilder<boolean> {
  if (!viewerId) return sql<boolean>`true`
  const item = table === "posts" ? sql.ref("b.post_id") : sql.ref("b.comment_id")
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE b.blocker_user_id = ${viewerId}
      AND b.blocked_user_id = ${sql.ref(`${table}.user_id`)}
      AND (${sql.ref(`${table}.created_at`)} >= b.created_at OR ${item} = ${sql.ref(`${table}.id`)})
  )`
}

export class BlockService {
  /** Block whoever wrote this post. Never reveals who that is. */
  async blockPostAuthor(postId: string, blockerId: string): Promise<void> {
    const post = await db
      .selectFrom("posts")
      .select(["user_id"])
      .where("id", "=", postId)
      .executeTakeFirst()
    if (!post) throw new Error("Post not found")
    await this.insert(blockerId, post.user_id, { post_id: postId })
  }

  /** Block whoever wrote this comment. Never reveals who that is. */
  async blockCommentAuthor(
    postId: string,
    commentId: string,
    blockerId: string,
  ): Promise<void> {
    const comment = await db
      .selectFrom("comments")
      .select(["user_id"])
      .where("id", "=", commentId)
      .where("post_id", "=", postId)
      .executeTakeFirst()
    if (!comment) throw new Error("Comment not found")
    await this.insert(blockerId, comment.user_id, { comment_id: commentId })
  }

  /** How many distinct authors the user has blocked (for Settings). */
  async countBlockedAuthors(blockerId: string): Promise<number> {
    const row = await db
      .selectFrom("user_blocks")
      .select(sql<string>`count(DISTINCT blocked_user_id)`.as("count"))
      .where("blocker_user_id", "=", blockerId)
      .executeTakeFirst()
    return Number(row?.count ?? 0)
  }

  /** Remove every block the user has made. */
  async unblockAll(blockerId: string): Promise<void> {
    await db
      .deleteFrom("user_blocks")
      .where("blocker_user_id", "=", blockerId)
      .execute()
  }

  private async insert(
    blockerId: string,
    authorId: string | null,
    item: { post_id: string } | { comment_id: string },
  ): Promise<void> {
    if (!authorId) throw new Error("This author can no longer be blocked")
    if (authorId === blockerId) throw new Error("You can't block yourself")

    // Blocking the same item twice is a no-op, and the response is the
    // same either way, so a repeat block can't be used to probe anything.
    await db
      .insertInto("user_blocks")
      .values({ blocker_user_id: blockerId, blocked_user_id: authorId, ...item })
      .onConflict((oc) => oc.doNothing())
      .execute()
  }
}
