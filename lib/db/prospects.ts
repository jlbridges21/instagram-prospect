import "server-only";

import {
  PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type FitLabel,
  type ProspectSort,
  type ProspectSource,
  type ProspectStatus,
} from "@/lib/constants/prospects";
import { databaseErrorMessage, isMissingRelation } from "@/lib/db/errors";
import type { DataResult } from "@/lib/db/models";
import type { ProspectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch, startOfTodayIso } from "@/lib/utils/format";

export type ProspectView = "active" | "review" | "approved" | "outreach" | "contacted" | "excluded" | "suppressed" | "all";

export type ProspectQuery = {
  q: string;
  status: ProspectStatus | "all";
  fit: FitLabel | "all";
  category: string;
  source: ProspectSource | "";
  minFollowers: string;
  maxFollowers: string;
  sort: ProspectSort;
  page: number;
  pageSize: number;
  view: ProspectView;
};

const PROSPECT_LIST_COLUMNS =
  "id, instagram_username, display_name, first_name, profile_url, profile_picture_url, category, follower_count, follow_relationship, fit_score, fit_label, qualification_reason, qualification_error, qualified, already_following, already_contacted, status, source, discovered_at, message_override, ai_analyzed_at, location_text, instagram_post_url, instagram_post_thumbnail_url";

const PROSPECT_DETAIL_COLUMNS =
  `${PROSPECT_LIST_COLUMNS}, bio, following_count, language, notes, message_text, sent_message_text, queued_message_text, ai_analysis, ai_model, ai_input_hash, approved_at, contacted_at, replied_at, demo_booked_at, converted_at, last_status_changed_at, is_sample, outreach_cancelled_at, created_at, updated_at`;

export async function getProspectPage(
  query: ProspectQuery,
): Promise<DataResult<{ rows: ProspectRow[]; count: number }>> {
  const supabase = await createClient();
  const pageSize = PAGE_SIZE_OPTIONS.some((size) => size === query.pageSize) ? query.pageSize : PAGE_SIZE;
  const from = (query.page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (query.view === "suppressed") return { ok: true, data: { rows: [], count: 0 } };
  const queuedIds = query.view === "outreach" ? await openOutreachProspectIds(supabase) : null;
  if (queuedIds && queuedIds.length === 0) return { ok: true, data: { rows: [], count: 0 } };

  let request = supabase.from("prospects").select(PROSPECT_LIST_COLUMNS, { count: "exact" });

  if (query.view === "active") {
    request = request.eq("already_following", false).not("status", "in", "(disqualified,skipped,converted)");
  } else if (query.view === "review") {
    request = request.in("status", ["qualified", "review"]);
  } else if (query.view === "approved") {
    request = request.eq("status", "approved");
  } else if (query.view === "outreach" && queuedIds) {
    request = request.in("id", queuedIds);
  } else if (query.view === "contacted") {
    request = request.in("status", ["contacted", "replied", "follow_up", "demo_booked", "converted"]);
  } else if (query.view === "excluded") {
    request = request.or("already_following.eq.true,status.eq.disqualified,status.eq.skipped");
  }
  if (query.status !== "all") request = request.eq("status", query.status);
  if (query.fit !== "all") request = request.eq("fit_label", query.fit);
  if (query.category) request = request.eq("category", query.category);
  if (query.source) request = request.eq("source", query.source);

  const minFollowers = Number.parseInt(query.minFollowers, 10);
  const maxFollowers = Number.parseInt(query.maxFollowers, 10);
  if (Number.isFinite(minFollowers)) request = request.gte("follower_count", minFollowers);
  if (Number.isFinite(maxFollowers)) request = request.lte("follower_count", maxFollowers);

  const search = sanitizeSearch(query.q);
  if (search) {
    const pattern = `%${search}%`;
    request = request.or(
      [
        `instagram_username.ilike.${pattern}`,
        `display_name.ilike.${pattern}`,
        `first_name.ilike.${pattern}`,
        `category.ilike.${pattern}`,
      ].join(","),
    );
  }

  if (query.sort === "oldest") {
    request = request.order("discovered_at", { ascending: true, nullsFirst: false });
  } else if (query.sort === "fit") {
    request = request.order("fit_score", { ascending: false, nullsFirst: false });
  } else if (query.sort === "fit_asc") {
    request = request.order("fit_score", { ascending: true, nullsFirst: false });
  } else if (query.sort === "followers_desc") {
    request = request.order("follower_count", { ascending: false, nullsFirst: false });
  } else if (query.sort === "followers_asc") {
    request = request.order("follower_count", { ascending: true, nullsFirst: false });
  } else {
    request = request.order("discovered_at", { ascending: false, nullsFirst: false });
  }

  request = request.order("created_at", { ascending: false });

  const { data, error, count } = await request.range(from, to);

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: { rows: (data ?? []) as ProspectRow[], count: count ?? 0 } };
}

const OPEN_OUTREACH = ["pending", "retry_wait", "claimed", "running"] as const;

async function openOutreachProspectIds(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("outreach_jobs").select("prospect_id").in("status", [...OPEN_OUTREACH]).limit(2000);
  return [...new Set((data ?? []).map((row) => row.prospect_id).filter((id): id is string => Boolean(id)))];
}

export async function getProspectTabCounts() {
  const supabase = await createClient();
  const [review, approved, contacted, excluded, queued, suppressed] = await Promise.all([
    supabase.from("prospects").select("id", { count: "exact", head: true }).in("status", ["qualified", "review"]),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("prospects").select("id", { count: "exact", head: true }).in("status", ["contacted", "replied", "follow_up", "demo_booked", "converted"]),
    supabase.from("prospects").select("id", { count: "exact", head: true }).or("already_following.eq.true,status.eq.disqualified,status.eq.skipped"),
    openOutreachProspectIds(supabase),
    supabase.from("discovery_suppressions").select("instagram_username_normalized", { count: "exact", head: true }),
  ]);
  return {
    review: review.count ?? 0,
    approved: approved.count ?? 0,
    outreach: queued.length,
    contacted: contacted.count ?? 0,
    excluded: excluded.count ?? 0,
    suppressed: suppressed.count ?? 0,
  };
}

export async function listProspectIds(query: ProspectQuery) {
  const supabase = await createClient();
  const ids: string[] = [];
  if (query.view === "suppressed") return [];
  const queuedIds = query.view === "outreach" ? await openOutreachProspectIds(supabase) : null;
  if (queuedIds && queuedIds.length === 0) return [];
  for (let page = 0; page < 20; page += 1) {
    let request = supabase.from("prospects").select("id");
    if (query.view === "active") {
      request = request.eq("already_following", false).not("status", "in", "(disqualified,skipped,converted)");
    } else if (query.view === "review") {
      request = request.in("status", ["qualified", "review"]);
    } else if (query.view === "approved") {
      request = request.eq("status", "approved");
    } else if (query.view === "outreach" && queuedIds) {
      request = request.in("id", queuedIds);
    } else if (query.view === "contacted") {
      request = request.in("status", ["contacted", "replied", "follow_up", "demo_booked", "converted"]);
    } else if (query.view === "excluded") {
      request = request.or("already_following.eq.true,status.eq.disqualified,status.eq.skipped");
    }
    if (query.status !== "all") request = request.eq("status", query.status);
    if (query.fit !== "all") request = request.eq("fit_label", query.fit);
    if (query.source) request = request.eq("source", query.source);
    const { data, error } = await request.range(page * 100, page * 100 + 99);
    if (error || !data?.length) break;
    ids.push(...data.map((row) => row.id));
    if (data.length < 100) break;
  }
  return ids;
}

export async function getProspectCategories(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("category")
    .not("category", "is", null);

  if (error || !data) return [];

  return [...new Set(data.map((row) => row.category).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b));
}

export async function getProspectById(
  id: string,
): Promise<DataResult<ProspectRow | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select(PROSPECT_DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: data as ProspectRow | null };
}

export async function getReviewQueue(): Promise<DataResult<ProspectRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select(PROSPECT_LIST_COLUMNS)
    .in("status", ["qualified", "review"])
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("discovered_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: (data ?? []) as ProspectRow[] };
}

export async function getReviewTodayCounts(timeZone: string) {
  const supabase = await createClient();
  const start = startOfTodayIso(timeZone);
  const [analyzed, excluded] = await Promise.all([
    supabase.from("prospects").select("id", { count: "exact", head: true }).gte("ai_analyzed_at", start),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .or("already_following.eq.true,status.eq.disqualified,status.eq.skipped")
      .gte("last_status_changed_at", start),
  ]);
  return {
    analyzed: analyzed.count ?? 0,
    excluded: excluded.count ?? 0,
  };
}

export type LocatedProspect = {
  id: string;
  instagram_username: string;
  display_name: string | null;
  profile_picture_url: string | null;
  follower_count: number | null;
  fit_label: ProspectRow["fit_label"];
  fit_score: number | null;
  status: ProspectRow["status"];
  location_text: string | null;
  category: string | null;
  source?: string | null;
  follow_relationship?: string | null;
};

export async function getLocatedProspects(limit = 300): Promise<DataResult<LocatedProspect[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("id, instagram_username, display_name, profile_picture_url, follower_count, fit_label, fit_score, status, location_text, category")
    .not("location_text", "is", null)
    .order("discovered_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return { ok: false, error: databaseErrorMessage(error), missingTable: isMissingRelation(error) };
  return { ok: true, data: (data ?? []) as LocatedProspect[] };
}

export async function getProspectCard(username: string | null): Promise<LocatedProspect | null> {
  const normalized = username?.replace(/^@/, "").trim();
  if (!normalized) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("prospects")
    .select("id, instagram_username, display_name, profile_picture_url, follower_count, fit_label, fit_score, status, location_text, category, source, follow_relationship")
    .eq("instagram_username", normalized)
    .maybeSingle();
  return (data as LocatedProspect | null) ?? null;
}

export async function getRecentProspects(limit = 6): Promise<DataResult<ProspectRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("id, instagram_username, display_name, first_name, profile_picture_url, follower_count, fit_score, fit_label, status, discovered_at, location_text, category, source")
    .order("discovered_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: (data ?? []) as ProspectRow[] };
}
