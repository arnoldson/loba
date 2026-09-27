-- Issue #83: user-to-user blocking (App Store guideline 1.2)
--
-- Run manually in the Supabase SQL editor — same one-time-manual-run
-- convention as 024/043/063. Safe to run before or after the backend
-- deploy: nothing reads this table until the new backend is live.
--
-- Design: FUTURE-ONLY blocking. #24 deliberately left blocking out
-- because display names rotate per post, and hiding ALL of an author's
-- content the moment you block them shows you exactly which other posts
-- vanished, i.e. which posts share an author. So a block hides:
--   1. the specific post or comment it was made from (post_id /
--      comment_id below), immediately, and
--   2. anything the blocked author creates AFTER the block
--      (content.created_at >= user_blocks.created_at).
-- The author's older content stays visible until it expires (24h-7d),
-- so nothing else changes at the moment of blocking. The client never
-- learns the author's user_id: the backend resolves it from the post or
-- comment server-side.
--
-- One row per blocked item. The author-level block is implied: the
-- earliest row for a (blocker, blocked) pair is when "future" starts.
-- "Unblock all" deletes every row for the blocker.

CREATE TABLE user_blocks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The item the block was made from; exactly one is set. ON DELETE
  -- CASCADE so the hard-delete job (#13) cleans these up with the post.
  post_id          uuid REFERENCES posts(id) ON DELETE CASCADE,
  comment_id       uuid REFERENCES comments(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (blocker_user_id <> blocked_user_id),
  CHECK ((post_id IS NULL) <> (comment_id IS NULL))
);

-- Blocking the same item twice is a no-op (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX user_blocks_post_unique
  ON user_blocks (blocker_user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX user_blocks_comment_unique
  ON user_blocks (blocker_user_id, comment_id) WHERE comment_id IS NOT NULL;

-- Serves the NOT EXISTS filter on every map/comment read.
CREATE INDEX idx_user_blocks_pair
  ON user_blocks (blocker_user_id, blocked_user_id, created_at);

-- Same future-proofing as 024: RLS on, no policies. The backend connects
-- as the table owner and bypasses RLS; the Data API gets nothing.
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
