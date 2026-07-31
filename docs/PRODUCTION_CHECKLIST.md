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
- [ ] CORS origin is restricted (not `origin: true`)

## 🗄️ Database

- [ ] All migrations have been run on the production database
- [ ] Spatial indexes are confirmed with `EXPLAIN ANALYZE`
- [ ] Archive cron job is running (pg_cron or equivalent — not setInterval)
- [ ] Hard-delete job is set up for posts archived >30 days

## 🔐 Authentication

- [ ] Supabase Auth email confirmation is enabled (no auto-confirm)
- [ ] JWT secret matches between Supabase and backend
- [ ] Rate limiting is configured on auth endpoints

## 📱 Frontend

- [ ] `API_URL` points to production backend (not localhost)
- [ ] No console.log statements in production builds
- [ ] Error boundaries are in place

## 🏗️ Infrastructure

- [ ] Backend is deployed and accessible
- [ ] SSL/TLS is configured (HTTPS only)
- [ ] Health check endpoint (`/health`) is monitored
- [ ] Logging is configured for production (not pino-pretty)

## 🧪 Smoke Tests

After deployment, verify:

- [ ] `GET /health` returns 200
- [ ] `GET /api/dev/login` returns 404 (dev routes disabled)
- [ ] `POST /api/posts/in-bounds` returns posts
- [ ] Auth flow works (signup → login → create post)
- [ ] Proximity check rejects distant reactions
- [ ] Account deletion works end-to-end (`scripts/test-account-deletion.sh`):
      old credentials fail to log in afterward; posts/comments remain
      visible reassigned to the sentinel; vote counts stay frozen (see
      `apps/backend/src/services/account.ts` for why votes aren't reassigned)

---

\_Last reviewed: \_**\_-**-\_\_\_
_Reviewed by: **\*\***\_\_\_\_**\*\***_
