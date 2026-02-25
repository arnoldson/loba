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

import type { FastifyRequest, FastifyReply } from "fastify";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Auth will not work."
  );
}

// Service-role client — used server-side to verify tokens and query profiles.
// This bypasses RLS, so never expose this client to the frontend.
export const supabaseAdmin = createClient(
  SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── Extend Fastify request with auth info ───────────────────────────

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────

/**
 * Extract the Bearer token from the Authorization header.
 */
function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

/**
 * Require authentication. Returns 401 if no valid token is present.
 * Attaches `request.userId` on success.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    reply.code(401).send({
      success: false,
      error: "Authentication required. Send a Bearer token in the Authorization header.",
    });
    return;
  }

  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      reply.code(401).send({
        success: false,
        error: "Invalid or expired token.",
      });
      return;
    }

    request.userId = user.id;
  } catch (err) {
    console.error("Auth error:", err);
    reply.code(401).send({
      success: false,
      error: "Authentication failed.",
    });
  }
}

/**
 * Optional authentication. Does NOT reject unauthenticated requests.
 * If a valid token is present, attaches `request.userId`.
 * If no token or invalid token, `request.userId` remains undefined.
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);
  if (!token) return;

  try {
    const {
      data: { user },
    } = await supabaseAdmin.auth.getUser(token);

    if (user) {
      request.userId = user.id;
    }
  } catch {
    // Silently ignore — user is just not authenticated
  }
}
