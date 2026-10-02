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

export type ProspectView = "active" | "review" | "approved" | "contacted" | "excluded" | "all";

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

  let request = supabase.from("prospects").select(PROSPECT_LIST_COLUMNS, { count: "exact" });

  if (query.view === "active") {
    request = request.eq("already_following", false).not("status", "in", "(disqualified,skipped,converted)");
  } else if (query.view === "review") {
    request = request.in("status", ["qualified", "review"]);
  } else if (query.view === "approved") {
    request = request.eq("status", "approved");
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

export async function getRecentProspects(limit = 6): Promise<DataResult<ProspectRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("id, instagram_username, display_name, first_name, profile_picture_url, follower_count, fit_score, fit_label, status, discovered_at")
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
