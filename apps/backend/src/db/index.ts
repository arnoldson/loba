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
  location: any // PostGIS geography column — managed by trigger
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
  created_at: Generated<string>
  updated_at: string
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
}

// ─── Create Kysely instance ─────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set")
}

console.log(
  "Connecting to database with URL:",
  process.env.DATABASE_URL.substring(0, 50) + "...",
)

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
