import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/db/types";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

const fix = process.argv.includes("--fix");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!url || !serviceKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to reconcile.");
    process.exitCode = 1;
    return;
  }
  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jobs = await supabase
    .from("outreach_jobs")
    .select("id, prospect_id, status, job_type")
    .in("status", ["pending", "retry_wait", "claimed", "running"]);
  if (jobs.error) {
    console.error(jobs.error.message);
    process.exitCode = 1;
    return;
  }
  const prospects = await supabase
    .from("prospects")
    .select("id, instagram_username, status, already_following, already_contacted, contacted_at, queued_message_text")
    .limit(1000);
  if (prospects.error || !prospects.data) {
    console.error(prospects.error?.message ?? "Could not read prospects.");
    process.exitCode = 1;
    return;
  }
  const byId = new Map(prospects.data.map((prospect) => [prospect.id, prospect]));
  let issues = 0;
  for (const job of jobs.data ?? []) {
    const prospect = byId.get(job.prospect_id);
    if (!prospect) continue;
    const blocked = prospect.already_following || prospect.status === "disqualified" || prospect.status === "skipped";
    if (!blocked) continue;
    issues += 1;
    console.log(`Active ${job.job_type} remains for @${prospect.instagram_username} (${prospect.status}).`);
    if (fix) {
      await supabase
        .from("outreach_jobs")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), last_error: "Reconciled because this prospect is excluded." })
        .eq("id", job.id);
    }
  }
  for (const prospect of prospects.data) {
    if (prospect.status === "approved" && !prospect.queued_message_text) {
      issues += 1;
      console.log(`@${prospect.instagram_username} is approved without a locked message.`);
    }
    if (prospect.status === "contacted" && !prospect.contacted_at) {
      issues += 1;
      console.log(`@${prospect.instagram_username} is contacted without a contacted time.`);
      if (fix) {
        await supabase.from("prospects").update({ contacted_at: new Date().toISOString() }).eq("id", prospect.id);
      }
    }
  }
  console.log(issues === 0 ? "No outreach inconsistencies found." : `${issues} issue${issues === 1 ? "" : "s"}${fix ? " processed." : ". Re-run with --fix to apply safe cancellations."}`);
}

main();
