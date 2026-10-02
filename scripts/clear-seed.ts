import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/db/types";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local first.");
  process.exit(1);
}

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data, error } = await supabase.from("prospects").select("id").eq("is_sample", true);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) {
    console.log("No sample prospects to remove.");
    return;
  }

  const followUps = await supabase.from("follow_ups").delete().in("prospect_id", ids);
  if (followUps.error) throw new Error(followUps.error.message);
  const activity = await supabase.from("activity_log").delete().in("prospect_id", ids);
  if (activity.error) throw new Error(activity.error.message);
  const prospects = await supabase.from("prospects").delete().in("id", ids);
  if (prospects.error) throw new Error(prospects.error.message);

  console.log(`Removed ${ids.length} sample prospects.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Clear failed.";
  console.error(message);
  process.exit(1);
});
