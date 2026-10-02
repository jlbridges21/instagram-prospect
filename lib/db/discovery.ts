import "server-only";

import { zonedParts, zonedTimeToUtc } from "@/lib/outreach/time";
import { createClient } from "@/lib/supabase/server";

export async function getDiscoveryToday(timeZone: string) {
  const parts = zonedParts(new Date(), timeZone);
  const start = zonedTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 },
    timeZone,
  ).toISOString();
  const supabase = await createClient();
  const [created, qualified, following, sessions] = await Promise.all([
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .gte("discovered_at", start)
      .eq("is_sample", false),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .gte("ai_analyzed_at", start)
      .eq("qualified", true)
      .eq("is_sample", false),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .gte("discovered_at", start)
      .eq("already_following", true)
      .eq("is_sample", false),
    supabase.from("worker_sessions").select("profiles_seen").gte("started_at", start),
  ]);

  const seenToday = sessions.error
    ? null
    : (sessions.data ?? []).reduce((sum, row) => sum + (row.profiles_seen ?? 0), 0);

  return {
    seenToday,
    newProspects: created.count ?? 0,
    qualified: qualified.count ?? 0,
    followingSkipped: following.count ?? 0,
  };
}
