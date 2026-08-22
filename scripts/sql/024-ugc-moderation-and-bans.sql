-- Issue #24: Minimal UGC moderation (report + native ban system)
--
-- Run this manually in the Supabase SQL editor. No migration tooling is
-- used in this repo — see scripts/create-deleted-user-sentinel.mjs for
-- the same one-time-manual-run convention.
--
-- Design decisions (see issue #24 discussion for full reasoning):
--   - User-facing "block" is deliberately OUT of scope. Display names are
--     hash(user_id, post_id) — different every post, by design, so no
--     user accumulates visible reputation. A persistent block has to key
--     off user_id to survive the name rotating, which reintroduces a
--     narrow cross-post correlation channel for an already-suspicious
--     observer ("this display name vanished right when I blocked
--     someone — must be the same person"). Accepted the App Store
--     rejection risk on this point for v1 rather than ship that
--     tradeoff prematurely. Report + developer ban is the v1 path.
--   - Bans are handled natively, NOT via Supabase's ban_duration. Supabase
--     access tokens are stateless JWTs — a ban_duration only blocks new
--     sign-in/refresh, it does not revoke an access token already in a
--     user's hands, which stays valid until it naturally expires. Native
--     enforcement (checked on every request in requireAuth) closes that
--     gap without needing to touch Supabase's session machinery at all.
--   - Signup stays 100% client-side (supabase.auth.signUp(), unchanged) —
--     see the hook_reject_banned_email function below for why, and how
--     email-ban blocking is enforced without touching that flow. IP-match
--     restriction is enforced via requireAuth on the first authenticated
--     request instead of at signup time — see middleware/auth.ts.
--   - RLS is enabled on all three new tables as future-proofing (Data API
--     is currently off, so it's not load-bearing today), with an
--     explicit supabase_auth_admin policy on user_bans specifically —
--     see the RLS section below for why that one table needs it and the
--     other two don't.

-- ─── Reports ────────────────────────────────────────────────────────────

CREATE TYPE report_reason AS ENUM ('spam', 'harassment', 'illegal', 'other');

CREATE TABLE post_reports (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id                   uuid NOT NULL,           -- no FK: post may be
                                                       -- hard-deleted by #13
  reporter_user_id          uuid NOT NULL REFERENCES auth.users(id),
  reason                    report_reason NOT NULL,

  -- Snapshot columns, copied at report time. Plain data, NOT FKs to posts
  -- — must survive the post being archived/hard-deleted.
  content_snapshot          text NOT NULL,
  photo_url_snapshot        text,
  tags_snapshot             text[] NOT NULL DEFAULT '{}',
  post_user_id_snapshot     uuid NOT NULL,
  tile_id_snapshot          text NOT NULL,
  post_created_at_snapshot  timestamptz NOT NULL,

  status                    text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'reviewed')),
  created_at                timestamptz NOT NULL DEFAULT now(),

  UNIQUE (post_id, reporter_user_id)
);

CREATE INDEX idx_post_reports_status ON post_reports (status, created_at);

-- ─── Bans (native, not Supabase ban_duration) ──────────────────────────

CREATE TABLE user_bans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id),
  banned_until   timestamptz,          -- NULL = permanent
  reason         text NOT NULL,        -- developer-facing, free text
  email_snapshot text NOT NULL,        -- lowercased, for future exact-match
                                         -- signup blocking
  ip_snapshot    text[] NOT NULL DEFAULT '{}',  -- pulled from user_ip_log
                                                  -- at ban time
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_bans_user_id ON user_bans (user_id);
-- Fast "is this user currently banned" lookups from requireAuth
CREATE INDEX idx_user_bans_active ON user_bans (user_id, banned_until);

-- ─── IP logging (for ban evasion detection, not just signup) ──────────

CREATE TABLE user_ip_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  ip_address   text NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, ip_address)
);

CREATE INDEX idx_user_ip_log_ip ON user_ip_log (ip_address);

-- ─── Row Level Security ────────────────────────────────────────────────
--
-- Enabled (not FORCED) on all three tables — this is future-proofing,
-- not a functional requirement today, since the Data API is currently
-- disabled and every read/write to these tables goes through the
-- backend anyway. ENABLE (vs FORCE) means the table OWNER (the
-- `postgres` role — used by both DATABASE_URL and the SQL editor)
-- automatically bypasses RLS entirely, so nothing changes for you or
-- the backend. This only becomes a real boundary if the Data API is
-- ever re-enabled, or a second, non-owner DB role gets added later —
-- at which point "no policies" correctly means "no access" by default,
-- rather than everything being open until someone remembers to lock it
-- down.
--
-- EXCEPTION: the "Before User Created" Auth Hook (hook_reject_banned_email,
-- below) runs as supabase_auth_admin — NOT the postgres/owner role — so
-- it does NOT get the owner bypass. Without an explicit grant + policy,
-- enabling RLS on user_bans would make the hook's query silently return
-- zero rows for every check, meaning the email-ban block would appear to
-- work but never actually match anyone. post_reports and user_ip_log
-- aren't touched by the hook, so they don't need this.

ALTER TABLE post_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ip_log ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON user_bans TO supabase_auth_admin;

CREATE POLICY "supabase_auth_admin_can_read_bans"
  ON user_bans
  FOR SELECT
  TO supabase_auth_admin
  USING (true);

-- ─── Restriction status (view-only pending-review state) ──────────────

ALTER TABLE user_profiles
  ADD COLUMN restriction_status text NOT NULL DEFAULT 'none'
    CHECK (restriction_status IN ('none', 'pending_review'));

-- ─── Email-ban signup blocking (Postgres Auth Hook, not application code) ─
--
-- Mobile's signup call stays exactly as-is (supabase.auth.signUp(),
-- client-side) — moving signup through our own backend would have meant
-- calling admin.createUser() instead, which does NOT send the
-- confirmation email the way the native client signUp() flow does. That
-- would've silently broken email verification for every new signup.
--
-- Instead this uses Supabase's "Before User Created" Auth Hook: a
-- Postgres function that runs before the user row is inserted and can
-- reject the request outright, with zero changes to the client signup
-- call or its email-sending behavior.
--
-- In practice this only matters for an EJECTED user's email trying to
-- re-register — if a user_bans row exists but the account itself is
-- still alive (a plain temp/permanent ban, not an ejection), Supabase's
-- own unique constraint on auth.users.email already rejects a duplicate
-- signup with that email before this hook is ever relevant.

CREATE OR REPLACE FUNCTION hook_reject_banned_email(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  new_email text := lower(event->'user'->>'email');
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_bans
    WHERE email_snapshot = new_email
      AND (banned_until IS NULL OR banned_until > now())
  ) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This account cannot be created.'
      )
    );
  END IF;

  RETURN jsonb_build_object();
END;
$$;

-- Explicit grant/revoke, matching Supabase's own documented example for
-- this hook — the general Auth Hooks docs say registering a hook via the
-- dashboard applies these automatically, but the hook's own docs still
-- show this done explicitly, so it's included here too rather than
-- relying solely on that automatic behavior.
GRANT EXECUTE ON FUNCTION hook_reject_banned_email TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION hook_reject_banned_email FROM authenticated, anon, public;

-- After running this, register it in the Supabase dashboard:
-- Authentication → Hooks → "Before User Created" → select
-- hook_reject_banned_email as a Postgres function hook. This is a
-- one-time manual dashboard step, not something this repo can automate.

-- ─── Documented queries for manual review (v1 has no admin route) ─────

-- View pending reports, oldest first
-- SELECT * FROM post_reports WHERE status = 'pending' ORDER BY created_at ASC;

-- Act on a report: archive the live post (soft-remove, consistent with
-- existing archived_at semantics — TTL job / #13 will hard-delete later)
-- UPDATE posts SET archived_at = now() WHERE id = '<post_id>';

-- Mark the report reviewed once acted on
-- UPDATE post_reports SET status = 'reviewed' WHERE id = '<report_id>';

-- Ban a user (fixed presets — pick one):
--   temp 24h:
--     INSERT INTO user_bans (user_id, banned_until, reason, email_snapshot, ip_snapshot)
--     SELECT '<user_id>', now() + interval '24 hours', '<reason>', lower(email),
--            ARRAY(SELECT ip_address FROM user_ip_log WHERE user_id = '<user_id>')
--     FROM auth.users WHERE id = '<user_id>';
--   temp 7d:   banned_until = now() + interval '7 days'
--   temp 30d:  banned_until = now() + interval '30 days'
--   permanent: banned_until = NULL

-- Lift a ban early
-- DELETE FROM user_bans WHERE user_id = '<user_id>';

-- Clear a pending-review (view-only) restriction after manual review
-- UPDATE user_profiles SET restriction_status = 'none' WHERE user_id = '<user_id>';

-- Find currently-restricted accounts awaiting review
-- SELECT * FROM user_profiles WHERE restriction_status = 'pending_review';

-- Ban evasion check: which currently-unbanned users share an IP with a
-- banned user? (manual judgment call — shared IPs are common and often
-- innocent; this is a signal to investigate, not to auto-act on)
-- SELECT DISTINCT up.user_id
-- FROM user_ip_log up
-- JOIN user_ip_log banned_ip ON up.ip_address = banned_ip.ip_address
-- JOIN user_bans b ON b.user_id = banned_ip.user_id
--   AND (b.banned_until IS NULL OR b.banned_until > now())
-- WHERE up.user_id != banned_ip.user_id
--   AND NOT EXISTS (
--     SELECT 1 FROM user_bans ub
--     WHERE ub.user_id = up.user_id
--       AND (ub.banned_until IS NULL OR ub.banned_until > now())
--   );

-- Eject a user entirely (manual, reusing account.ts's sentinel pattern by
-- hand — for severe/repeat offenders, stronger than a ban):
--   1. Reassign their content to the sentinel, same as self-delete:
--      UPDATE posts SET user_id = '<DELETED_USER_ID>' WHERE user_id = '<offender_user_id>';
--      UPDATE comments SET user_id = '<DELETED_USER_ID>' WHERE user_id = '<offender_user_id>';
--   2. Delete the auth user via Supabase dashboard or:
--      supabaseAdmin.auth.admin.deleteUser('<offender_user_id>')
--      (cascades user_profiles + post_reactions automatically)