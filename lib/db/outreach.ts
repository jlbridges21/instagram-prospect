import "server-only";

import { isMissingRelation } from "@/lib/db/errors";
import type { DataResult } from "@/lib/db/models";
import type { OutreachJobRow, ProspectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { startOfTodayIso } from "@/lib/utils/format";

export type OutreachSnapshot = {
  queueProspects: number;
  scheduledToday: number;
  sentToday: number;
  failedJobs: number;
  completedToday: number;
  failedToday: number;
  nextAt: string | null;
  currentJob: string | null;
  currentWorker: string | null;
  lastCompleted: string | null;
};

const OPEN_STATUSES = ["pending", "retry_wait", "claimed", "running"] as const;

export async function getOutreachSnapshot(
  timeZone: string,
  now = new Date(),
): Promise<OutreachSnapshot | null> {
  const supabase = await createClient();
  const todayStart = startOfTodayIso(timeZone, now);
  const { data, error } = await supabase
    .from("outreach_jobs")
    .select("prospect_id, status, job_type, scheduled_for, completed_at, failed_at, claimed_by_worker_id");

  if (error || !data) return null;

  const open = data.filter((job) => OPEN_STATUSES.some((status) => status === job.status));
  const queueProspects = new Set(open.map((job) => job.prospect_id)).size;
  const scheduledToday = open.filter((job) => job.scheduled_for >= todayStart).length;
  const sentToday = data.filter(
    (job) => job.job_type === "send_message" && job.status === "completed" && (job.completed_at ?? "") >= todayStart,
  ).length;
  const failedJobs = data.filter((job) => job.status === "failed").length;
  const completedToday = data.filter((job) => job.status === "completed" && (job.completed_at ?? "") >= todayStart).length;
  const failedToday = data.filter((job) => job.status === "failed" && (job.failed_at ?? "") >= todayStart).length;
  const upcoming = open
    .filter((job) => job.status === "pending" || job.status === "retry_wait")
    .map((job) => job.scheduled_for)
    .sort();
  const current = data.find((job) => job.status === "claimed" || job.status === "running");
  const lastCompleted = data
    .filter((job) => job.status === "completed" && job.completed_at)
    .sort((left, right) => (right.completed_at ?? "").localeCompare(left.completed_at ?? ""))[0];

  return {
    queueProspects,
    scheduledToday,
    sentToday,
    failedJobs,
    completedToday,
    failedToday,
    nextAt: upcoming[0] ?? null,
    currentJob: current ? current.job_type.replaceAll("_", " ") : null,
    currentWorker: current?.claimed_by_worker_id ?? null,
    lastCompleted: lastCompleted ? lastCompleted.job_type.replaceAll("_", " ") : null,
  };
}

export async function getProspectOutreach(prospectId: string): Promise<DataResult<OutreachJobRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_jobs")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("sequence_order", { ascending: true });

  if (error) {
    return { ok: false, error: error.message, missingTable: isMissingRelation(error) };
  }
  return { ok: true, data: data ?? [] };
}

export type QueueProspect = Pick<
  ProspectRow,
  | "id"
  | "display_name"
  | "first_name"
  | "instagram_username"
  | "fit_score"
  | "fit_label"
  | "profile_url"
  | "status"
  | "queued_message_text"
  | "outreach_cancelled_at"
  | "already_following"
>;

export async function listOutreachJobs(): Promise<
  DataResult<{ jobs: OutreachJobRow[]; prospects: QueueProspect[] }>
> {
  const supabase = await createClient();
  const jobs = await supabase
    .from("outreach_jobs")
    .select("*")
    .order("scheduled_for", { ascending: true })
    .limit(300);
  if (jobs.error) {
    return { ok: false, error: jobs.error.message, missingTable: isMissingRelation(jobs.error) };
  }

  const ids = [...new Set((jobs.data ?? []).map((job) => job.prospect_id))];
  if (ids.length === 0) return { ok: true, data: { jobs: [], prospects: [] } };

  const prospects = await supabase
    .from("prospects")
    .select(
      "id, display_name, first_name, instagram_username, fit_score, fit_label, profile_url, status, queued_message_text, outreach_cancelled_at, already_following",
    )
    .in("id", ids);
  if (prospects.error) {
    return { ok: false, error: prospects.error.message, missingTable: isMissingRelation(prospects.error) };
  }

  return { ok: true, data: { jobs: jobs.data ?? [], prospects: prospects.data ?? [] } };
}

export async function getOutreachAnalytics(since: string | null) {
  const supabase = await createClient();
  let jobsQuery = supabase
    .from("outreach_jobs")
    .select("job_type, status, created_at, completed_at")
    .eq("job_type", "send_message");
  if (since) jobsQuery = jobsQuery.gte("created_at", since);
  const jobs = await jobsQuery;
  if (jobs.error) return null;

  let prospectsQuery = supabase
    .from("prospects")
    .select("approved_at, contacted_at")
    .not("approved_at", "is", null)
    .not("contacted_at", "is", null);
  if (since) prospectsQuery = prospectsQuery.gte("contacted_at", since);
  const prospects = await prospectsQuery;
  if (prospects.error) return null;

  const rows = jobs.data ?? [];
  const queued = rows.length;
  const sent = rows.filter((row) => row.status === "completed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const durations = (prospects.data ?? [])
    .map((row) => {
      if (!row.approved_at || !row.contacted_at) return null;
      return new Date(row.contacted_at).getTime() - new Date(row.approved_at).getTime();
    })
    .filter((value): value is number => value !== null && value >= 0);
  const averageMs =
    durations.length === 0 ? null : durations.reduce((sum, value) => sum + value, 0) / durations.length;

  return { queued, sent, failed, averageMs };
}
