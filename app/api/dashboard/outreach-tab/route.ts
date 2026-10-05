import { statusesForTab, type QueueTab } from "@/lib/outreach/queue-sort";
import type { OutreachJobStatus } from "@/lib/outreach/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TABS = new Set<QueueTab>(["upcoming", "progress", "failed", "completed", "cancelled", "all"]);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ jobs: [], prospects: [] }, { status: 401 });

  const tab = new URL(request.url).searchParams.get("tab") ?? "upcoming";
  if (!TABS.has(tab as QueueTab)) return Response.json({ jobs: [], prospects: [] }, { status: 400 });
  const current = tab as QueueTab;
  const statuses = (statusesForTab(current) ?? ["pending", "retry_wait", "claimed", "running", "failed", "completed", "cancelled"]) as OutreachJobStatus[];
  const order = orderFor(current);

  const jobs = await supabase
    .from("outreach_jobs")
    .select("id, prospect_id, job_type, status, priority, sequence_order, depends_on_job_id, scheduled_for, available_at, claimed_at, claimed_by_worker_id, claim_expires_at, started_at, completed_at, failed_at, cancelled_at, attempt_count, max_attempts, last_error, result, idempotency_key, created_at, updated_at")
    .in("status", statuses)
    .order(order.column, { ascending: order.ascending })
    .limit(80);
  if (jobs.error) return Response.json({ jobs: [], prospects: [], error: jobs.error.message }, { status: 500 });

  const ids = [...new Set((jobs.data ?? []).map((job) => job.prospect_id))];
  const prospects = ids.length
    ? await supabase
        .from("prospects")
        .select("id, display_name, first_name, instagram_username, fit_score, fit_label, profile_url, status, queued_message_text, outreach_cancelled_at, already_following")
        .in("id", ids)
    : { data: [] };

  return Response.json({ jobs: jobs.data ?? [], prospects: prospects.data ?? [] });
}

function orderFor(tab: QueueTab) {
  if (tab === "completed") return { column: "completed_at", ascending: false };
  if (tab === "failed") return { column: "failed_at", ascending: false };
  if (tab === "progress") return { column: "started_at", ascending: false };
  if (tab === "cancelled") return { column: "cancelled_at", ascending: false };
  if (tab === "upcoming") return { column: "scheduled_for", ascending: true };
  return { column: "updated_at", ascending: false };
}
