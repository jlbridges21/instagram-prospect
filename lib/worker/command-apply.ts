import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { setAutomation } from "@/lib/outreach/service";
import type { WorkerCommandType } from "@/lib/worker/commands";

type Client = SupabaseClient<Database>;

export async function applyWorkerCommand(
  admin: Client,
  type: WorkerCommandType,
  payload: Record<string, unknown>,
) {
  if (type === "start_discovery") return startDiscovery(admin, payload);
  if (type === "pause_discovery") return setDiscovery(admin, false, false);
  if (type === "stop_discovery") return setDiscovery(admin, false, true);
  if (type === "start_outreach") return setAutomation(admin, true, "dashboard", false);
  if (type === "pause_outreach") return setAutomation(admin, false, "dashboard", false);
  return { ok: true as const };
}

async function startDiscovery(admin: Client, payload: Record<string, unknown>) {
  const mode = payload.mode === "duration" || payload.mode === "inspection_count" || payload.mode === "continuous"
    ? payload.mode
    : "review_target";
  const now = new Date().toISOString();
  const reviewTarget = typeof payload.reviewTarget === "number" ? payload.reviewTarget : null;
  const patch: Database["public"]["Tables"]["settings"]["Update"] = {
    discovery_enabled: true,
    discovery_auto_paused: false,
    discovery_stop_reason: null,
    discovery_run_mode: mode,
    discovery_run_started_at: now,
    discovery_run_minutes: mode === "duration" && typeof payload.durationMinutes === "number" ? payload.durationMinutes : null,
    discovery_run_inspection_limit: mode === "inspection_count" && typeof payload.inspectionCount === "number" ? payload.inspectionCount : null,
  };
  if (mode === "review_target" && reviewTarget != null) patch.discovery_review_target = reviewTarget;
  if (typeof payload.hourlyPace === "number") patch.max_profiles_per_hour = payload.hourlyPace;
  if (typeof payload.suggestedAccounts === "boolean") patch.suggested_accounts_enabled = payload.suggestedAccounts;
  if (typeof payload.homeFeed === "boolean") patch.home_feed_enabled = payload.homeFeed;
  const { error } = await admin.from("settings").update(patch).eq("id", 1);
  if (error) return { ok: false as const, error: error.message };

  const open = await admin.from("discovery_sessions").select("id").is("stopped_at", null).limit(1).maybeSingle();
  if (!open.data) {
    await admin.from("discovery_sessions").insert({
      starting_review_count: 0,
      target: mode === "review_target" ? reviewTarget : null,
    });
  }
  return { ok: true as const };
}

async function setDiscovery(admin: Client, enabled: boolean, endSession: boolean) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("settings")
    .update({
      discovery_enabled: enabled,
      discovery_stop_reason: enabled ? null : "manual_pause",
      discovery_auto_paused: false,
    })
    .eq("id", 1);
  if (error) return { ok: false as const, error: error.message };
  if (endSession) {
    await admin.from("discovery_sessions").update({ stopped_at: now, stop_reason: "manual_pause" }).is("stopped_at", null);
  }
  return { ok: true as const };
}

export function commandResult(type: WorkerCommandType, payload: Record<string, unknown>): Json {
  return { type, payload: payload as Json };
}
