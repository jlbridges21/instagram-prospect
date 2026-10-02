import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSettings } from "@/lib/db/models";
import type { Database } from "@/lib/db/types";
import { isOutreachJobType, type OutreachJobType } from "@/lib/outreach/types";
import { profileUrlForUsername } from "@/lib/utils/format";

type Client = SupabaseClient<Database>;

export async function previewNextJob(admin: Client, settings: AppSettings) {
  if (!settings.workerEnabled) {
    return { ok: true as const, job: null, reason: "worker_disabled" as const };
  }
  const now = new Date().toISOString();
  const jobs = await admin
    .from("outreach_jobs")
    .select("id, job_type, prospect_id, depends_on_job_id, sequence_order")
    .in("status", ["pending", "retry_wait"])
    .lte("available_at", now)
    .order("sequence_order", { ascending: true })
    .limit(30);
  if (jobs.error) return { ok: false as const, error: "Could not read the outreach queue." };

  for (const job of jobs.data ?? []) {
    if (!isOutreachJobType(job.job_type)) continue;
    if (job.depends_on_job_id) {
      const dependency = await admin
        .from("outreach_jobs")
        .select("status")
        .eq("id", job.depends_on_job_id)
        .maybeSingle();
      if (dependency.data?.status !== "completed") continue;
    }
    const prospect = await admin
      .from("prospects")
      .select("id, instagram_username, profile_url, queued_message_text, status")
      .eq("id", job.prospect_id)
      .maybeSingle();
    if (!prospect.data || prospect.data.status !== "approved") continue;
    return {
      ok: true as const,
      job: publicPreview(job.id, job.job_type, prospect.data),
      reason: null,
    };
  }

  return { ok: true as const, job: null, reason: "no_job" as const };
}

function publicPreview(
  jobId: string,
  jobType: OutreachJobType,
  prospect: {
    id: string;
    instagram_username: string;
    profile_url: string | null;
    queued_message_text: string | null;
  },
) {
  const base = {
    id: jobId,
    type: jobType,
    prospectId: prospect.id,
    instagramUsername: prospect.instagram_username,
    profileUrl: profileUrlForUsername(prospect.instagram_username, prospect.profile_url),
  };
  if (jobType !== "send_message") return base;
  return { ...base, message: prospect.queued_message_text ?? "" };
}
