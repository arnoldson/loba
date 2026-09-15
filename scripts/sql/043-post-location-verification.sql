-- Issue #43: server-side location verification on post creation
--
-- Run this manually in the Supabase SQL editor. No migration tooling is
-- used in this repo — see scripts/sql/024-ugc-moderation-and-bans.sql
-- for the same one-time-manual-run convention.
--
-- Design (see issue #43 discussion for full reasoning):
--   - The actual verification (GPS reading staleness/accuracy) needs no
--     schema change — it's enforced in utils/proximity.ts against fields
--     already in the request body, not stored.
--   - This column exists for the one signal that IS worth persisting:
--     when a post's claimed location was wildly inconsistent with
--     IP-based geolocation (checkIpConsistency). IP geolocation is
--     coarse and VPNs/carrier NAT produce real false positives, so this
--     is a flag for moderation visibility, never a rejection — a
--     flagged post is still created normally.
--   - Scoped to posts only, not reactions or comments. Posts are the
--     "fake local buzz" threat the issue is actually about; reactions
--     and comments have no moderation review flow to consume a stored
--     flag, so a mismatch there is just logged (console.warn) rather
--     than persisted, matching the anti-overengineering default.
--   - Deliberately never exposed to clients, including the post's own
--     author — see the explicit strip in PostService.toPublicPosts and
--     toOwnPost. A spoofer who could see they'd been flagged could
--     adjust behavior to avoid it next time.

ALTER TABLE posts
ADD COLUMN flagged_ip_mismatch boolean NOT NULL DEFAULT false;
