import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Post, UserProfile } from '@loba/shared';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

const { Pool } = pg;

// Database schema interface
export interface Database {
  posts: Post;
  user_profiles: UserProfile;
}

// Create Kysely instance
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

console.log('Connecting to database with URL:', process.env.DATABASE_URL.substring(0, 50) + '...');

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('supabase.com') 
        ? { rejectUnauthorized: false } 
        : false,
    }),
  }),
});
