import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const env = getPublicSupabaseEnv();
  if (!env) {
    throw new Error("Supabase is not configured.");
  }

  return createBrowserClient<Database>(env.url, env.anonKey);
}
