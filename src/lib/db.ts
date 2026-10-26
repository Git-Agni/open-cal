import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role Supabase client. Every table has row level security on with no policies
 * (deny-all), so the anon key can read nothing; only server code with this key gets in.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("database_not_configured");
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
