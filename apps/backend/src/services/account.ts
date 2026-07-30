import { db } from "../db/index.js"
import { supabaseAdmin } from "../middleware/auth.js"

const DELETED_USER_ID = process.env.DELETED_USER_ID

export class AccountService {
  /**
   * Delete a user's account.
   *
   * Posts and comments are NOT deleted — their user_id is reassigned to
   * the permanent "[deleted]" sentinel account (DELETED_USER_ID), same
   * effect as Reddit's "[deleted]" author: content and discussion threads
   * stay intact for other users, only the link back to this account is
   * severed.
   *
   * Reactions are intentionally left untouched here — they cascade-delete
   * automatically when the auth user is removed below. Vote *counts*
   * (posts.upvote_count / downvote_count) are NOT adjusted, so the post's
   * engagement tally stays exactly as it was; only the underlying
   * per-user reaction rows disappear.
   *
   * Note: reactions can't be reassigned to the shared sentinel the way
   * posts/comments are — post_reactions assumes at most one reaction per
   * (post_id, user_id), so if two different deleted users had both voted
   * on the same post, reassigning both to one sentinel user_id would
   * collide.
   */
  async deleteAccount(userId: string): Promise<void> {
    if (!DELETED_USER_ID) {
      throw new Error(
        "DELETED_USER_ID is not configured. Run scripts/create-deleted-user-sentinel.mjs first.",
      )
    }

    if (userId === DELETED_USER_ID) {
      // Should never happen (sentinel can't authenticate), but guard anyway.
      throw new Error("Cannot delete the sentinel account")
    }

    // Reassign content BEFORE deleting the auth user — comments.user_id
    // has a NO ACTION foreign key to auth.users, so deleteUser() would
    // fail with a foreign key violation if any comments still pointed at
    // the real user_id when it's removed.
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("posts")
        .set({ user_id: DELETED_USER_ID })
        .where("user_id", "=", userId)
        .execute()

      await trx
        .updateTable("comments")
        .set({ user_id: DELETED_USER_ID })
        .where("user_id", "=", userId)
        .execute()
    })

    // Deletes the auth user. This cascades user_profiles (intended —
    // that IS the personal data) and post_reactions (intended — see
    // note above) automatically via existing DB constraints.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (error) {
      throw new Error(
        `Content was reassigned to the sentinel account, but deleting the auth account failed: ${error.message}. Safe to retry — reassignment is idempotent.`,
      )
    }
  }
}
