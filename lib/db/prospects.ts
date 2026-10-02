import "server-only";

import {
  PAGE_SIZE,
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
  view: ProspectView;
};

export async function getProspectPage(
  query: ProspectQuery,
): Promise<DataResult<{ rows: ProspectRow[]; count: number }>> {
  const supabase = await createClient();
  const from = (query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let request = supabase.from("prospects").select("*", { count: "exact" });

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

  return { ok: true, data: { rows: data ?? [], count: count ?? 0 } };
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
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data };
}

export async function getReviewQueue(): Promise<DataResult<ProspectRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
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

  return { ok: true, data: data ?? [] };
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
    .select("*")
    .order("discovered_at", { ascending: false, nullsFirst: false })
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
