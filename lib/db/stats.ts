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
  let request = supabase
    .from("prospects")
    .select(
      "qualified, status, discovered_at, approved_at, contacted_at, replied_at, demo_booked_at, converted_at",
    );

  if (discoveredSince) request = request.gte("discovered_at", discoveredSince);

  const { data, error } = await request;

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: summarizeProspects(data ?? [], todayStartIso) };
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
  const { data, error } = await supabase
    .from("prospects")
    .select("fit_label, status, ai_analyzed_at");

  if (error) return null;

  const today = new Date(todayStartIso).getTime();
  const snapshot = { analyzedToday: 0, strongFits: 0, possibleFits: 0, disqualified: 0 };
  for (const row of data ?? []) {
    if (row.fit_label === "strong_fit") snapshot.strongFits += 1;
    if (row.fit_label === "possible_fit") snapshot.possibleFits += 1;
    if (row.status === "disqualified") snapshot.disqualified += 1;
    if (row.ai_analyzed_at && new Date(row.ai_analyzed_at).getTime() >= today) {
      snapshot.analyzedToday += 1;
    }
  }
  return snapshot;
}

export async function getRecentActivity(
  limit = 8,
): Promise<DataResult<ActivityLogRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

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
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: data ?? [] };
}
