import { parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";
import { showInActivity } from "@/lib/status/operations";
import { createClient } from "@/lib/supabase/server";
import { widgetState } from "@/lib/worker/widget-state";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { WORKER_VERSION } from "@/worker/version";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ online: false }, { status: 401 });

  const [settings, worker, review, events, command, jobs] = await Promise.all([
    supabase.from("settings").select("heartbeat_interval_seconds, timezone, discovery_enabled, automation_enabled, discovery_review_target, discovery_stop_reason, max_profiles_per_hour, discovery_run_mode, hourly_maximum, daily_maximum, minimum_action_delay_seconds").eq("id", 1).maybeSingle(),
    supabase.from("worker_instances").select("worker_id, machine_name, status, last_heartbeat_at, current_task, current_username, last_event, attention_reason, browser_connected, instagram_authenticated").order("last_heartbeat_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", "review").in("fit_label", ["strong_fit", "possible_fit"]).eq("is_sample", false),
    supabase.from("worker_events").select("id, event_type, message, metadata, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("worker_commands").select("id, command_type, status, error_message, error_code").in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("outreach_jobs").select("prospect_id, scheduled_for, status").in("status", ["pending", "retry_wait", "claimed", "running"]).limit(500),
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

  const timeZone = settings.data?.timezone || "America/Chicago";
  const queueCount = new Set((jobs.data ?? []).map((job) => job.prospect_id)).size;
  const nextEligibleAt = (jobs.data ?? [])
    .filter((job) => job.status === "pending" || job.status === "retry_wait")
    .map((job) => job.scheduled_for)
    .filter((value): value is string => Boolean(value) && new Date(value).getTime() > Date.now())
    .sort()[0] ?? null;
  const versionEvent = (events.data ?? []).find((event) => event.event_type === "worker_connected");
  const metadata = versionEvent?.metadata;
  const reportedVersion = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "version" in metadata
    ? String(metadata.version || "") || null
    : null;
  const visibleEvents = (events.data ?? []).filter((event) => showInActivity(event.event_type, event.message));

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
    browser: parseBrowserHealthEvent(row?.last_event),
    stopReason: settings.data?.discovery_stop_reason ?? null,
    queueCount,
    nextEligibleAt,
    hourlyMaximum: settings.data?.hourly_maximum ?? 20,
    dailyMaximum: settings.data?.daily_maximum ?? 150,
    minimumSpacingSeconds: settings.data?.minimum_action_delay_seconds ?? 180,
    attentionReason: row?.attention_reason ?? null,
    command: command.data ?? null,
    events: visibleEvents,
    reportedVersion,
    requiredVersion: WORKER_VERSION,
    timeZone,
  });
}
