-- Issue #63: viewport-relative sectoring replaces persistent tile_id
--
-- Run manually in the Supabase SQL editor — see 024/043 for the same
-- one-time-manual-run convention.
--
-- Root cause being fixed: grid IDENTITY math (which tile/supertile a
-- point belongs to) used a fixed GRID_REFERENCE_LATITUDE=0 for the
-- longitude cos() correction, distorting cell shape away from the
-- equator (confirmed Seoul, ~37.5°N). Rather than pick a "better" fixed
-- reference latitude (still wrong somewhere), #63 drops persistent
-- world-anchored tile identity entirely: sectors are computed
-- server-side, per request, relative to that request's own (snapped)
-- viewport. There is no more world-anchored identity for a post to
-- carry, so tile_id has nothing left to serve.
--
-- post_reports.tile_id_snapshot is dropped too — confirmed with the
-- user that no location evidence needs to be retained on reports going
-- forward (content_snapshot, tags_snapshot, post_user_id_snapshot,
-- post_id already cover moderation review needs).
--
-- IMPORTANT — deployment order: run this AFTER the backend deploy that
-- stops writing/reading tile_id, not before. tile_id is NOT NULL with
-- no default; running this while old backend code is still live would
-- break every post-create request until the new backend deploys.

ALTER TABLE posts DROP COLUMN tile_id;
ALTER TABLE post_reports DROP COLUMN tile_id_snapshot;
