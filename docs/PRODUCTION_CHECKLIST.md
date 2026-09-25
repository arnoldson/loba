# 🚀 Production Deployment Checklist

**Review this checklist before every production deployment.**

## App Store Submission Blockers

- [ ] #25 Account deletion must be live — privacy.html states deletion
      is available "from within the app's settings"
- [ ] #24 Report + block must be live — terms.html describes
      reporting/moderation tooling as available

## ⛔ Security

- [ ] `NODE_ENV=production` is set in the deployment environment
- [ ] Dev auth routes (`/api/dev/*`) are NOT registered (gated by `NODE_ENV !== "production"` in `apps/backend/src/index.ts`)
- [ ] Verify by hitting `/api/dev/login` on production — should return 404
- [ ] `DATABASE_URL` uses production credentials, not dev/local
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set and correct
- [ ] Service role key is NOT exposed to the frontend
- [ ] `DELETED_USER_ID` is set — run `scripts/create-deleted-user-sentinel.mjs`
      against the production DB first, then set the resulting user id.
      Without this, `DELETE /account` throws immediately (see
      `apps/backend/src/services/account.ts`) and account deletion is
      broken in prod even though it works locally.
- [ ] No CORS headers in production: `curl -sI -H "Origin: https://example.com" <prod>/health`
      shows no `access-control-allow-origin` (CORS is only registered
      outside production, see `apps/backend/src/app.ts`)

## 🗄️ Database

- [ ] All migrations have been run on the production database
- [ ] Spatial indexes are confirmed with `EXPLAIN ANALYZE`
- [ ] Archive cron job is running (pg_cron or equivalent — not setInterval)
- [ ] Hard-delete job is set up for posts archived >30 days
- [ ] `PROD_DATABASE_URL` secret is set on GitHub so `cron-job-health.yml`
      can reach the production DB — without it, every scheduled run fails
      immediately on a connection error, which still alerts but gives a
      useless message. Optionally set `ALERT_WEBHOOK_URL` (Slack-compatible
      incoming webhook) for a second notification channel beyond GitHub's
      own scheduled-workflow-failure email.

## 🔐 Authentication

- [ ] Supabase Auth email confirmation is enabled (no auto-confirm)
- [ ] JWT secret matches between Supabase and backend
- [ ] `/api/auth/login` rate limit is live per client IP (see smoke tests).
      Login is proxied through the backend, so Supabase's own per-IP
      limit sees only Railway's address and can't do this job.
- [ ] Supabase "Before User Created" hook is set to `hook_reject_banned_email`
      (Authentication → Hooks); the function existing isn't enough

## 📱 Frontend

- [ ] `API_URL` points to production backend (not localhost)
- [ ] No console.log statements in production builds
- [ ] Error boundaries are in place

## 🏗️ Infrastructure

- [ ] Backend is deployed and accessible
- [ ] SSL/TLS is configured (HTTPS only)
- [ ] Health check endpoint (`/health`) is monitored
- [ ] Logs are plain JSON in production (pino-pretty is dev-only, see
      `apps/backend/src/index.ts`)

## 🧪 Smoke Tests

After deployment, verify:

- [ ] `GET /health` returns 200
- [ ] `GET /api/dev/login` returns 404 (dev routes disabled)
- [ ] `POST /api/posts/in-bounds` returns posts
- [ ] Auth flow works (signup → login → create post)
- [ ] Proximity check rejects distant reactions
- [ ] Login rate limit: 11 failed logins within 5 minutes from one
      network get a 429 on the 11th, including when each request sends
      a different forged `X-Forwarded-For` (proves `trustProxy` is keyed
      on the IP Railway appends). A second network (e.g. phone on
      cellular) must still get 401, not 429 (proves users don't share
      one bucket).
- [ ] Account deletion works end-to-end. `scripts/test-account-deletion.sh`
      needs `/api/dev/login`, so against production do it in the app:
      sign up, post, delete the account in Settings. Old credentials
      fail to log in afterward; posts/comments remain
      visible reassigned to the sentinel; vote counts stay frozen (see
      `apps/backend/src/services/account.ts` for why votes aren't reassigned)

---

\_Last reviewed: \_**\_-**-\_\_\_
_Reviewed by: **\*\***\_\_\_\_**\*\***_
