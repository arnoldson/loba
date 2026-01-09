import { Database } from "@/types/database";
import { createClient } from "@supabase/supabase-js";
import { Kysely } from "kysely";
import { SupabaseDialect } from "kysely-supabase";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Supabase client (for auth, storage, realtime)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Kysely client (for type-safe queries)
export const db = new Kysely<Database>({
  dialect: new SupabaseDialect({
    supabase,
  }),
});
