import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/db/types";
import { loadLocalEnv } from "./load-env";
import { buildSampleProspects, sampleActivities, sampleFollowUps } from "./sample-data";

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

async function removeSamples() {
  const { data, error } = await supabase.from("prospects").select("id").eq("is_sample", true);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return;

  const followUps = await supabase.from("follow_ups").delete().in("prospect_id", ids);
  if (followUps.error) throw new Error(followUps.error.message);
  const activity = await supabase.from("activity_log").delete().in("prospect_id", ids);
  if (activity.error) throw new Error(activity.error.message);
  const prospects = await supabase.from("prospects").delete().in("id", ids);
  if (prospects.error) throw new Error(prospects.error.message);
}

async function main() {
  await removeSamples();
  const prospects = buildSampleProspects();
  const { data, error } = await supabase
    .from("prospects")
    .insert(prospects)
    .select("id, instagram_username");

  if (error || !data) throw new Error(error?.message ?? "Insert failed.");

  const ids = new Map(data.map((row) => [row.instagram_username, row.id]));

  const activityRows = data.flatMap((row) =>
    sampleActivities(row.instagram_username).map((event) => ({
      prospect_id: row.id,
      event_type: event.event_type,
      description: event.description,
      metadata: event.metadata,
      created_at: event.created_at,
    })),
  );

  if (activityRows.length > 0) {
    const activity = await supabase.from("activity_log").insert(activityRows);
    if (activity.error) throw new Error(activity.error.message);
  }

  const followUpRows = sampleFollowUps().flatMap((followUp) => {
    const prospectId = ids.get(followUp.username);
    if (!prospectId) return [];
    return [
      {
        prospect_id: prospectId,
        due_at: followUp.due_at,
        status: followUp.status,
        notes: followUp.notes,
      },
    ];
  });

  if (followUpRows.length > 0) {
    const followUps = await supabase.from("follow_ups").insert(followUpRows);
    if (followUps.error) throw new Error(followUps.error.message);
  }

  console.log(`Inserted ${data.length} sample prospects. Remove them with npm run db:clear-seed.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Seed failed.";
  console.error(message);
  process.exit(1);
});
