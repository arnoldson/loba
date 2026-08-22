/**
 * Supabase Auth middleware for Fastify.
 *
 * Verifies the JWT from the Authorization header and attaches
 * the authenticated user's ID to the request.
 *
 * Usage:
 *   // Protect a single route
 *   fastify.post('/posts', { preHandler: [requireAuth] }, handler)
 *
 *   // Optional auth (user may or may not be logged in)
 *   fastify.get('/posts', { preHandler: [optionalAuth] }, handler)
 */

import type { FastifyRequest, FastifyReply } from "fastify"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"
import { db } from "../db/index.js"
import { sql } from "kysely"

// Load .env
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../../.env") })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Auth will not work.",
  )
}

// Service-role client — used server-side to verify tokens and query profiles.
// This bypasses RLS, so never expose this client to the frontend.
export const supabaseAdmin = createClient(
  SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ─── Extend Fastify request with auth info ───────────────────────────

declare module "fastify" {
  interface FastifyRequest {
    userId?: string
  }
}

// ─── Ban / restriction enforcement (#24) ───────────────────────────────
//
// Bans are native, not Supabase's ban_duration. Supabase access tokens
// are stateless JWTs — ban_duration only blocks new sign-in/refresh, it
// does NOT revoke a token already in a user's hands, which stays valid
// until it naturally expires. Checking user_bans here, on every request,
// closes that gap without touching Supabase's session machinery at all:
// a banned user's JWT can be perfectly valid to Supabase and still get
// rejected here.

/**
 * True if the user has an active ban (permanent, or temp and not yet
 * expired). Checked on every authenticated request, not just sign-in.
 */
async function isUserBanned(userId: string): Promise<boolean> {
  const ban = await db
    .selectFrom("user_bans")
    .select("id")
    .where("user_id", "=", userId)
    .where((eb) =>
      eb.or([
        eb("banned_until", "is", null),
        eb("banned_until", ">", new Date().toISOString()),
      ]),
    )
    .executeTakeFirst()

  return !!ban
}

/**
 * True if the user is in the view-only pending-review state (flagged at
 * signup for sharing an IP with a banned account — see routes/auth.ts).
 * Only blocks mutating requests; GET requests still pass so the account
 * can browse the map while under review.
 */
async function isRestrictedFromWriting(
  userId: string,
  method: string,
): Promise<boolean> {
  if (method === "GET") return false

  const profile = await db
    .selectFrom("user_profiles")
    .select("restriction_status")
    .where("user_id", "=", userId)
    .executeTakeFirst()

  return profile?.restriction_status === "pending_review"
}

/**
 * Upserts the request's IP against this user_id, and — the first time
 * this exact (user, ip) pair is ever seen — checks whether that IP is
 * shared with a currently-banned user, flagging this account for
 * view-only pending review if so.
 *
 * "First time seen" (via Postgres's xmax = 0 insert-detection trick,
 * distinguishing a fresh INSERT from an ON CONFLICT UPDATE) matters: if
 * this ran on every request unconditionally, a restriction you'd
 * manually cleared after review would just get silently re-applied on
 * the user's very next request from that same shared IP, undoing the
 * review. Checking only once per newly-seen IP avoids that.
 *
 * Fire-and-forget from the caller's perspective — errors are logged,
 * never thrown. This is a background signal, not something that should
 * ever fail a real request.
 */
async function logUserIp(userId: string, ip: string): Promise<void> {
  try {
    const result = await db
      .insertInto("user_ip_log")
      .values({ user_id: userId, ip_address: ip })
      .onConflict((oc) =>
        oc
          .columns(["user_id", "ip_address"])
          .doUpdateSet({ last_seen: new Date().toISOString() }),
      )
      .returning(sql<boolean>`(xmax = 0)`.as("was_new_ip"))
      .executeTakeFirst()

    if (result?.was_new_ip) {
      await flagIfSharingIpWithBannedUser(userId, ip)
    }
  } catch (err) {
    console.error("Failed to log user IP (non-fatal):", err)
  }
}

/**
 * Weak, ambiguous signal (shared WiFi/carrier NAT/VPN all produce false
 * positives) — restricts to view-only pending review rather than
 * blocking outright. See scripts/sql/024-ugc-moderation-and-bans.sql
 * for the manual-review query and the full design reasoning.
 */
async function flagIfSharingIpWithBannedUser(
  userId: string,
  ip: string,
): Promise<void> {
  const match = await db
    .selectFrom("user_ip_log")
    .innerJoin("user_bans", "user_bans.user_id", "user_ip_log.user_id")
    .select("user_bans.id")
    .where("user_ip_log.ip_address", "=", ip)
    .where("user_ip_log.user_id", "!=", userId)
    .where((eb) =>
      eb.or([
        eb("user_bans.banned_until", "is", null),
        eb("user_bans.banned_until", ">", new Date().toISOString()),
      ]),
    )
    .executeTakeFirst()

  if (match) {
    await db
      .updateTable("user_profiles")
      .set({ restriction_status: "pending_review" })
      .where("user_id", "=", userId)
      .execute()
  }
}

// ─── Middleware ───────────────────────────────────────────────────────

/**
 * Extract the Bearer token from the Authorization header.
 */
function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) return null
  return authHeader.slice(7)
}

/**
 * Require authentication. Returns 401 if no valid token is present.
 * Attaches `request.userId` on success.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request)

  if (!token) {
    reply.code(401).send({
      success: false,
      error:
        "Authentication required. Send a Bearer token in the Authorization header.",
    })
    return
  }

  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token)

    if (error || !user) {
      reply.code(401).send({
        success: false,
        error: "Invalid or expired token.",
      })
      return
    }

    if (await isUserBanned(user.id)) {
      reply.code(403).send({
        success: false,
        error: "This account has been suspended.",
        code: "banned",
      })
      return
    }

    if (await isRestrictedFromWriting(user.id, request.method)) {
      reply.code(403).send({
        success: false,
        error: "This account is under review. Browsing is still available.",
        code: "restricted",
      })
      return
    }

    request.userId = user.id
    void logUserIp(user.id, request.ip)
  } catch (err) {
    console.error("Auth error:", err)
    reply.code(401).send({
      success: false,
      error: "Authentication failed.",
    })
  }
}

/**
 * Optional authentication. Does NOT reject unauthenticated requests.
 * If a valid token is present, attaches `request.userId`.
 * If no token or invalid token, `request.userId` remains undefined.
 */
export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request)
  if (!token) return

  try {
    const {
      data: { user },
    } = await supabaseAdmin.auth.getUser(token)

    if (!user) return

    // A ban is now a hard reject here too, matching requireAuth — this
    // used to fall back to "treat as anonymous" on the reasoning that a
    // banned user could browse anonymously anyway, so blocking here
    // wouldn't accomplish anything. That reasoning didn't hold: mobile's
    // AuthGate (app/_layout.tsx) requires a valid session to reach ANY
    // screen at all, so there's no anonymous-browsing fallback for a
    // banned user to fall into. See the #24 design discussion.
    if (await isUserBanned(user.id)) {
      reply.code(403).send({
        success: false,
        error: "This account has been suspended.",
        code: "banned",
      })
      return
    }

    request.userId = user.id
    void logUserIp(user.id, request.ip)
  } catch {
    // Silently ignore — user is just not authenticated
  }
}
