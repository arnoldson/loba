/**
 * Server-side login (#24 follow-up).
 *
 * Mobile previously called supabase.auth.signInWithPassword() directly.
 * That's fine for a normal account, but for a banned one it meant
 * Supabase issued a real, valid session before our own AuthGate/
 * checkBanStatus ever got a chance to react — a genuine (if brief)
 * window where a banned user held working credentials. sign-in has no
 * side-effect-email concern the way signup did (no confirmation email
 * is sent on sign-in), so unlike signup, moving this server-side is
 * safe with no collateral damage to any existing flow.
 *
 * The approach: verify credentials via supabaseAdmin (which does mint a
 * session), check user_bans BEFORE returning anything to the client,
 * and simply never forward the tokens if banned. Nothing else ever
 * learns those tokens exist, so there's no session to "revoke" — it's
 * just discarded.
 */

import type { FastifyInstance } from "fastify"
import { db } from "../db/index.js"
import { supabaseAdmin } from "../middleware/auth.js"

interface LoginBody {
  email: string
  password: string
}

interface LoginResponse {
  success: boolean
  access_token?: string
  refresh_token?: string
  error?: string
  code?: "banned"
}

export async function authLoginRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: LoginBody; Reply: LoginResponse }>(
    "/auth/login",
    async (request, reply) => {
      const { email, password } = request.body

      if (!email || !password) {
        return reply.code(400).send({
          success: false,
          error: "email and password are required",
        })
      }

      const { data, error } = await supabaseAdmin.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      })

      if (error || !data.session || !data.user) {
        return reply.code(401).send({
          success: false,
          error: error?.message || "Invalid email or password",
        })
      }

      const ban = await db
        .selectFrom("user_bans")
        .select("id")
        .where("user_id", "=", data.user.id)
        .where((eb) =>
          eb.or([
            eb("banned_until", "is", null),
            eb("banned_until", ">", new Date().toISOString()),
          ]),
        )
        .executeTakeFirst()

      if (ban) {
        // A session WAS minted above, but it's never returned to the
        // client — nobody outside this request ever holds it, so
        // there's nothing to revoke, just tokens that go nowhere.
        return reply.code(403).send({
          success: false,
          error: "This account has been suspended.",
          code: "banned",
        })
      }

      return {
        success: true,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }
    },
  )
}
