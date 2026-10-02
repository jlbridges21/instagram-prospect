import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/db/types";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.log("db skipped: supabase env missing");
  process.exit(0);
}

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = false;

function report(ok: boolean, message: string) {
  console.log(ok ? `ok ${message}` : `FAIL ${message}`);
  if (!ok) failed = true;
}

async function main() {
  const probe = await supabase.from("outreach_jobs").select("id").limit(1);
  if (probe.error) {
    console.log("db skipped: outreach queue migration is not applied yet");
    return;
  }

  const username = `queueprobe${Date.now().toString().slice(-8)}`;
  const created = await supabase
    .from("prospects")
    .insert({
      instagram_username: username,
      display_name: "Queue Probe",
      status: "approved",
      source: "home_feed",
      is_sample: true,
      qualified: true,
      fit_label: "strong_fit",
      fit_score: 90,
      follower_count: 5000,
    })
    .select("id")
    .single();
  if (created.error || !created.data) {
    console.log(`db probe could not create a prospect: ${created.error?.message ?? "unknown"}`);
    return;
  }

  const prospectId = created.data.id;
  try {
    const past = new Date(Date.now() - 60_000).toISOString();
    const queued = await supabase.rpc("queue_outreach_sequence", {
      p_prospect_id: prospectId,
      p_message: "Hi fictional.example. This is a queue probe.",
      p_verify_at: past,
      p_follow_at: past,
      p_send_at: past,
    });
    const again = await supabase.rpc("queue_outreach_sequence", {
      p_prospect_id: prospectId,
      p_message: "Hi fictional.example. This is a queue probe.",
      p_verify_at: past,
      p_follow_at: past,
      p_send_at: past,
    });
    const first = queued.data as { created?: boolean } | null;
    const second = again.data as { created?: boolean; reason?: string } | null;
    report(first?.created === true, "db sequence created");
    report(second?.created === false, "db duplicate approval did not create jobs");

    const now = new Date().toISOString();
    const [left, right] = await Promise.all([
      supabase.rpc("claim_next_outreach_job", {
        p_worker_id: "probe-a",
        p_lease_seconds: 300,
        p_now: now,
        p_prospect_id: prospectId,
      }),
      supabase.rpc("claim_next_outreach_job", {
        p_worker_id: "probe-b",
        p_lease_seconds: 300,
        p_now: now,
        p_prospect_id: prospectId,
      }),
    ]);
    const leftId = jobId(left.data);
    const rightId = jobId(right.data);
    const winners = [leftId, rightId].filter(Boolean);
    report(winners.length === 1 && leftId !== rightId, "db two workers received one job");
    report(!left.error && !right.error, "db claim completed without an error");
  } finally {
    await supabase.from("prospects").delete().eq("id", prospectId);
  }
}

function jobId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

main()
  .then(() => {
    if (failed) process.exit(1);
  })
  .catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Probe failed.");
  process.exit(1);
});
