#!/usr/bin/env node
// scripts/create-deleted-user-sentinel.mjs
//
// ONE-TIME SETUP SCRIPT. Run this once per environment (local, staging,
// production) to provision the permanent "[deleted]" sentinel account.
//
// Account deletion reassigns a deleted user's posts/comments to this
// account's user_id instead of hard-deleting them or setting user_id to
// NULL — same effect as Reddit's "[deleted]" author, preserving content
// and discussion threads while removing the real account.
//
// This account:
//   - Has a random, never-stored password — nobody can log in as it.
//   - Should never be deleted itself.
//   - Is excluded from any user-facing account listings/analytics.
//
// After running, copy the printed user_id into your .env as
// DELETED_USER_ID and restart the backend.
//
// Usage:
//   node scripts/create-deleted-user-sentinel.mjs

import { createClient } from "@supabase/supabase-js"
import { randomUUID, randomBytes } from "node:crypto"
import dotenv from "dotenv"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../apps/backend/.env") })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (apps/backend/.env)",
  )
  process.exit(1)
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  // Unguessable email in a reserved subdomain-style local-part — never
  // meant to receive mail or be used to sign in.
  const email = `deleted-user+${randomUUID()}@loba.internal`
  const password = randomBytes(32).toString("hex") // never stored, never shared

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { is_deleted_user_sentinel: true },
  })

  if (error || !data.user) {
    console.error("❌ Failed to create sentinel account:", error)
    process.exit(1)
  }

  console.log("✅ Sentinel account created.")
  console.log("")
  console.log("   Add this to apps/backend/.env:")
  console.log("")
  console.log(`   DELETED_USER_ID=${data.user.id}`)
  console.log("")
  console.log(
    "   Do not delete this account. It's the permanent [deleted] placeholder",
  )
  console.log("   that deleted users' posts/comments get reassigned to.")

  process.exit(0)
}

main().catch((err) => {
  console.error("❌ Script error:", err)
  process.exit(1)
})
