/**
 * Dev-only auth routes for testing without Apple/Google OAuth.
 *
 * These endpoints let you create test users and get tokens from the command line.
 * DO NOT register these routes in production.
 *
 * Usage:
 *   # Create a test user and get a token
 *   curl -X POST http://localhost:3000/api/dev/login \
 *     -H "Content-Type: application/json" \
 *     -d '{"email": "test@loba.dev", "password": "testpass123"}'
 *
 *   # Use the token
 *   curl http://localhost:3000/api/posts/mine \
 *     -H "Authorization: Bearer <token_from_above>"
 *
 *   # Check auth status
 *   curl http://localhost:3000/api/dev/me \
 *     -H "Authorization: Bearer <token>"
 */

import { FastifyPluginAsync } from "fastify";
import { supabaseAdmin } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../db/index.js";

export const devAuthRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/dev/login
   * Creates a test user if they don't exist, then signs in and returns a token.
   *
   * Body: { "email": "test@loba.dev", "password": "testpass123" }
   * Returns: { success, token, user_id }
   */
  fastify.post("/api/dev/login", async (request, reply) => {
    const { email, password } = request.body as {
      email: string;
      password: string;
    };

    if (!email || !password) {
      return reply.status(400).send({
        success: false,
        error: "email and password are required",
      });
    }

    // Try to sign in first
    const { data: signInData, error: signInError } =
      await supabaseAdmin.auth.signInWithPassword({ email, password });

    if (signInData?.session) {
      console.log(`🔑 Dev login: ${email} (existing user)`);
      return {
        success: true,
        token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        user_id: signInData.user?.id,
      };
    }

    // User doesn't exist — create them
    const { data: signUpData, error: signUpError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Skip email verification for dev
      });

    if (signUpError || !signUpData?.user) {
      console.error("Dev signup error:", signUpError);
      return reply.status(500).send({
        success: false,
        error: signUpError?.message || "Failed to create test user",
      });
    }

    // Now sign in the new user to get a session token
    const { data: newSession, error: sessionError } =
      await supabaseAdmin.auth.signInWithPassword({ email, password });

    if (sessionError || !newSession?.session) {
      console.error("Dev session error:", sessionError);
      return reply.status(500).send({
        success: false,
        error: "User created but failed to get session",
      });
    }

    console.log(`🔑 Dev login: ${email} (new user created)`);
    return {
      success: true,
      token: newSession.session.access_token,
      refresh_token: newSession.session.refresh_token,
      user_id: newSession.user?.id,
      created: true,
    };
  });

  /**
   * GET /api/dev/me
   * Check who you are. Requires a valid Bearer token.
   * Returns your user_id and verification status.
   */
  fastify.get(
    "/api/dev/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.userId!;

      const profile = await db
        .selectFrom("user_profiles")
        .selectAll()
        .where("user_id", "=", userId)
        .executeTakeFirst();

      return {
        success: true,
        user_id: userId,
        verification_status: profile?.verification_status || "unverified",
        profile_exists: !!profile,
      };
    }
  );

  /**
   * POST /api/dev/verify
   * Manually set a user's verification status (for testing the badge).
   *
   * Body: { "status": "verified" }
   * Requires Bearer token.
   */
  fastify.post(
    "/api/dev/verify",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.userId!;
      const { status } = request.body as { status: string };

      const validStatuses = ["unverified", "pending", "verified", "rejected"];
      if (!validStatuses.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      await db
        .updateTable("user_profiles")
        .set({
          verification_status: status,
          verified_at: status === "verified" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .where("user_id", "=", userId)
        .execute();

      console.log(`✅ Dev verify: ${userId} → ${status}`);
      return {
        success: true,
        user_id: userId,
        verification_status: status,
      };
    }
  );
};
