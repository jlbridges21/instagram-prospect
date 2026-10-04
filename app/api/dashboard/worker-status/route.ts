import { parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { createClient } from "@/lib/supabase/server";
import { widgetState } from "@/lib/worker/widget-state";
import { getWorkerHealth } from "@/lib/utils/worker-health";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ online: false }, { status: 401 });

  const [settings, worker, review, events, command] = await Promise.all([
    supabase.from("settings").select("heartbeat_interval_seconds, discovery_enabled, automation_enabled, discovery_review_target, max_profiles_per_hour, discovery_run_mode").eq("id", 1).maybeSingle(),
    supabase.from("worker_instances").select("worker_id, machine_name, status, last_heartbeat_at, current_task, current_username, last_event, attention_reason, browser_connected, instagram_authenticated").order("last_heartbeat_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", "review").in("fit_label", ["strong_fit", "possible_fit"]).eq("is_sample", false),
    supabase.from("worker_events").select("id, event_type, message, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("worker_commands").select("id, command_type, status, error_message").in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const row = worker.data;
  const health = getWorkerHealth({
    status: row?.status ?? null,
    lastHeartbeatAt: row?.last_heartbeat_at ?? null,
    heartbeatIntervalSeconds: settings.data?.heartbeat_interval_seconds ?? 30,
    currentTask: row?.current_task,
    attentionReason: row?.attention_reason,
  });
  const online = health.state === "online" || health.state === "attention";
  const hourly = parseHourlyWaitEvent(row?.last_event);
  const discoveryEnabled = settings.data?.discovery_enabled !== false && settings.data?.discovery_enabled !== undefined ? settings.data.discovery_enabled : false;
  const outreachEnabled = settings.data?.automation_enabled === true;
  const view = widgetState({
    online,
    attention: health.state === "attention",
    discoveryEnabled,
    outreachEnabled,
    hourlyWaiting: Boolean(hourly) && discoveryEnabled,
    commandStatus: command.data?.status === "running" ? "running" : command.data?.status === "queued" ? "queued" : null,
    currentTask: row?.current_task ?? null,
    error: row?.status === "error",
  });

  return Response.json({
    online,
    state: view.state,
    title: view.title,
    tone: view.tone,
    machineName: row?.machine_name ?? null,
    workerId: row?.worker_id ?? null,
    lastHeartbeatAt: row?.last_heartbeat_at ?? null,
    browserConnected: row?.browser_connected === true,
    instagramAuthenticated: row?.instagram_authenticated === true,
    discoveryEnabled,
    outreachEnabled,
    discoveryMode: settings.data?.discovery_run_mode ?? "review_target",
    currentAction: row?.current_task ?? null,
    username: row?.current_username ?? null,
    reviewCount: review.count ?? 0,
    reviewTarget: settings.data?.discovery_review_target ?? "unlimited",
    hourlyLimit: settings.data?.max_profiles_per_hour ?? 30,
    hourly,
    attentionReason: row?.attention_reason ?? null,
    command: command.data ?? null,
    events: events.data ?? [],
  });
}
