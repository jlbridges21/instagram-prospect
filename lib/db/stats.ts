import "server-only";

import { REVIEW_QUEUE_STATUSES } from "@/lib/constants/prospects";
import { databaseErrorMessage, isMissingRelation } from "@/lib/db/errors";
import type { DataResult } from "@/lib/db/models";
import type { ActivityLogRow, ProspectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export type ProspectMetric = Pick<
  ProspectRow,
  | "qualified"
  | "status"
  | "discovered_at"
  | "approved_at"
  | "contacted_at"
  | "replied_at"
  | "demo_booked_at"
  | "converted_at"
>;

export type PipelineCounts = {
  discovered: number;
  qualified: number;
  approved: number;
  contacted: number;
  replied: number;
  demoBooked: number;
  converted: number;
  foundToday: number;
  pendingReview: number;
  approvedCurrent: number;
};

export function emptyPipeline(): PipelineCounts {
  return {
    discovered: 0,
    qualified: 0,
    approved: 0,
    contacted: 0,
    replied: 0,
    demoBooked: 0,
    converted: 0,
    foundToday: 0,
    pendingReview: 0,
    approvedCurrent: 0,
  };
}

export function summarizeProspects(
  rows: ProspectMetric[],
  todayStartIso: string,
): PipelineCounts {
  const counts = emptyPipeline();
  const today = new Date(todayStartIso).getTime();

  for (const row of rows) {
    counts.discovered += 1;
    if (row.qualified) counts.qualified += 1;
    if (row.approved_at) counts.approved += 1;
    if (row.contacted_at) counts.contacted += 1;
    if (row.replied_at) counts.replied += 1;
    if (row.demo_booked_at) counts.demoBooked += 1;
    if (row.converted_at || row.status === "converted") counts.converted += 1;
    if (row.status === "approved") counts.approvedCurrent += 1;
    if (REVIEW_QUEUE_STATUSES.some((status) => status === row.status)) {
      counts.pendingReview += 1;
    }
    if (row.discovered_at && new Date(row.discovered_at).getTime() >= today) {
      counts.foundToday += 1;
    }
  }

  return counts;
}

export async function getPipelineCounts(
  todayStartIso: string,
  discoveredSince: string | null = null,
): Promise<DataResult<PipelineCounts>> {
  const supabase = await createClient();
  const countStatus = (status: ProspectMetric["status"]) => {
    let request = supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", status);
    if (discoveredSince) request = request.gte("discovered_at", discoveredSince);
    return request;
  };
  const [discovered, qualified, approved, contacted, replied, demoBooked, converted, foundToday, pendingReview] = await Promise.all([
    countStatus("discovered"),
    countStatus("qualified"),
    countStatus("approved"),
    countStatus("contacted"),
    countStatus("replied"),
    countStatus("demo_booked"),
    countStatus("converted"),
    supabase.from("prospects").select("id", { count: "exact", head: true }).gte("discovered_at", todayStartIso),
    supabase.from("prospects").select("id", { count: "exact", head: true }).in("status", [...REVIEW_QUEUE_STATUSES]),
  ]);
  const failed = [discovered, qualified, approved, contacted, replied, demoBooked, converted, foundToday, pendingReview].find((result) => result.error);
  if (failed?.error) {
    return { ok: false, error: databaseErrorMessage(failed.error), missingTable: isMissingRelation(failed.error) };
  }
  return {
    ok: true,
    data: {
      discovered: discovered.count ?? 0,
      qualified: qualified.count ?? 0,
      approved: approved.count ?? 0,
      contacted: contacted.count ?? 0,
      replied: replied.count ?? 0,
      demoBooked: demoBooked.count ?? 0,
      converted: converted.count ?? 0,
      foundToday: foundToday.count ?? 0,
      pendingReview: pendingReview.count ?? 0,
      approvedCurrent: approved.count ?? 0,
    },
  };
}

export type QualificationSnapshot = {
  analyzedToday: number;
  strongFits: number;
  possibleFits: number;
  disqualified: number;
};

export async function getQualificationSnapshot(
  todayStartIso: string,
): Promise<QualificationSnapshot | null> {
  const supabase = await createClient();
  const [strongFits, possibleFits, disqualified, analyzedToday] = await Promise.all([
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("fit_label", "strong_fit"),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("fit_label", "possible_fit"),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", "disqualified"),
    supabase.from("prospects").select("id", { count: "exact", head: true }).gte("ai_analyzed_at", todayStartIso),
  ]);
  if (strongFits.error || possibleFits.error || disqualified.error || analyzedToday.error) return null;
  return {
    analyzedToday: analyzedToday.count ?? 0,
    strongFits: strongFits.count ?? 0,
    possibleFits: possibleFits.count ?? 0,
    disqualified: disqualified.count ?? 0,
  };
}

export async function getRecentActivity(
  limit = 8,
): Promise<DataResult<ActivityLogRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, prospect_id, event_type, description, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 20));

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: data ?? [] };
}

export async function getProspectActivity(
  prospectId: string,
): Promise<DataResult<ActivityLogRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, prospect_id, event_type, description, metadata, created_at")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: data ?? [] };
}
