-- Issue #86: report comments, not just posts (App Store guideline 1.2)
--
-- Run manually in the Supabase SQL editor, like 024/083. Safe before the
-- backend deploy: nothing writes here until the new backend is live.
--
-- Mirrors post_reports (024): snapshot columns are plain copies, NOT FKs,
-- so the evidence survives the comment being deleted by its author or
-- removed with its post by the hard-delete job (#13). Reuses 024's
-- report_reason enum.

CREATE TABLE comment_reports (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id                   uuid NOT NULL,
  post_id                      uuid NOT NULL,
  reporter_user_id             uuid NOT NULL,
  reason                       report_reason NOT NULL,
  content_snapshot             text NOT NULL,
  comment_user_id_snapshot     uuid NOT NULL,
  comment_created_at_snapshot  timestamptz NOT NULL,
  status                       text NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'reviewed')),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, reporter_user_id)
);

CREATE INDEX idx_comment_reports_status ON comment_reports (status, created_at);

ALTER TABLE comment_reports ENABLE ROW LEVEL SECURITY;

-- ─── Manual review (v1 has no admin route; see 024 for post reports) ────
--
-- Pending comment reports, oldest first, with how many distinct people
-- reported each comment:
--   SELECT comment_id, post_id, reason, content_snapshot,
--          comment_user_id_snapshot, created_at,
--          count(*) OVER (PARTITION BY comment_id) AS reports_on_comment
--   FROM comment_reports WHERE status = 'pending' ORDER BY created_at;
--
-- Remove the comment (if it still exists), then mark the report reviewed:
--   DELETE FROM comments WHERE id = '<comment_id>';
--   UPDATE comment_reports SET status = 'reviewed' WHERE comment_id = '<comment_id>';
