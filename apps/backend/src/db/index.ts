import { Kysely, PostgresDialect, Generated } from "kysely"
import pg from "pg"
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"

// Load .env file
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../../.env") })

const { Pool } = pg

// ─── Kysely table types ─────────────────────────────────────────────
// These mirror the DB schema. Use `Generated` for columns with DB defaults
// so Kysely knows they're optional on INSERT.

export interface PostsTable {
  id: string
  user_id: string | null
  content: string
  photo_url: string | null
  latitude: number
  longitude: number
  tile_id: string
  tags: string[]
  comment_count: Generated<number> // DEFAULT 0 in DB
  upvote_count: Generated<number> // DEFAULT 0 in DB
  downvote_count: Generated<number> // DEFAULT 0 in DB
  expires_at: Generated<string> // DEFAULT NOW() + 24h
  archived_at: string | null
  created_at: string
  updated_at: string
  location: Generated<string> // PostGIS geography column — managed by trigger
}

export interface CommentsTable {
  id: Generated<string> // DEFAULT gen_random_uuid()
  post_id: string
  user_id: string
  content: string
  created_at: Generated<string> // DEFAULT NOW()
}

export interface UserProfilesTable {
  user_id: string
  verification_status: "unverified" | "pending" | "verified" | "rejected"
  verified_at: string | null
  restriction_status: "none" | "pending_review" // view-only gate, see #24
  created_at: Generated<string>
  updated_at: string
}

export interface PostReportsTable {
  id: Generated<string>
  post_id: string
  reporter_user_id: string
  reason: "spam" | "harassment" | "illegal" | "other"
  content_snapshot: string
  photo_url_snapshot: string | null
  tags_snapshot: string[]
  post_user_id_snapshot: string
  tile_id_snapshot: string
  post_created_at_snapshot: string
  status: Generated<"pending" | "reviewed"> // DEFAULT 'pending' in DB
  created_at: Generated<string>
}

export interface UserBansTable {
  id: Generated<string>
  user_id: string
  banned_until: string | null // null = permanent
  reason: string
  email_snapshot: string
  ip_snapshot: string[]
  created_at: Generated<string>
}

export interface UserIpLogTable {
  id: Generated<string>
  user_id: string
  ip_address: string
  first_seen: Generated<string>
  last_seen: Generated<string> // DEFAULT now() in DB
}

export interface PostReactionsTable {
  id: Generated<string> // DEFAULT gen_random_uuid()
  post_id: string
  user_id: string
  reaction: "upvote" | "downvote"
  latitude: number
  longitude: number
  created_at: Generated<string> // DEFAULT NOW()
}

// ─── Database schema interface ──────────────────────────────────────

export interface Database {
  posts: PostsTable
  comments: CommentsTable
  user_profiles: UserProfilesTable
  post_reactions: PostReactionsTable
  post_reports: PostReportsTable
  user_bans: UserBansTable
  user_ip_log: UserIpLogTable
}

// ─── Create Kysely instance ─────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set")
}

console.log("Connecting to database")

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("supabase.com")
        ? { rejectUnauthorized: false }
        : false,
    }),
  }),
})
