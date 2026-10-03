import type { Metadata } from "next";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { WorkerStatusPanel } from "@/components/worker/worker-status";
import { DiscoveryControls } from "@/components/worker/discovery-controls";
import { AutomationControls } from "@/components/outreach/automation-controls";
import { DiscoveryProgress } from "@/components/worker/discovery-progress";
import { LiveProspectSync } from "@/components/prospects/live-sync";
import { getDiscoveryToday, getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { getOutreachSnapshot } from "@/lib/db/outreach";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import { formatDateTime, formatRelativeTime, platformLabel } from "@/lib/utils/format";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { parseDiscoveryStatus } from "@/lib/worker/discovery-status";

export const metadata: Metadata = { title: "Worker" };

export default async function WorkerPage() {
  const [workerResult, settingsResult] = await Promise.all([getLatestWorker(), getSettings()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const [outreach, discovery, progress] = await Promise.all([
    getOutreachSnapshot(settings.timezone),
    getDiscoveryToday(settings.timezone),
    getDiscoveryV3Snapshot(settings.timezone),
  ]);
  const worker = workerResult.ok ? workerResult.data : null;
  const health = getWorkerHealth({
    status: worker?.status ?? null,
    lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    currentTask: worker?.current_task,
    attentionReason: worker?.attention_reason,
  });

  const yesNo = (value: boolean | undefined) => {
    if (!worker) return "Not reported";
    return value ? "Yes" : "No";
  };

  return (
    <div>
      <PageHeader
        title="Worker"
        description="The browser worker runs on your Mac or Windows machine. It does not run on Vercel."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <DiscoveryControls enabled={settings.discovery.enabled} />
            <AutomationControls enabled={settings.outreach.automationEnabled} />
          </div>
        }
      />
      {!workerResult.ok && workerResult.missingTable ? (
        <div className="mb-6">
          <DatabaseSetup message={workerResult.error} />
        </div>
      ) : null}
      {!workerResult.ok && !workerResult.missingTable ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {workerResult.error}
        </div>
      ) : null}
      <LiveProspectSync />
      <div className="mb-6">
        <DiscoveryProgress
          running={settings.discovery.enabled}
          currentReview={progress.currentReview}
          target={settings.discovery.reviewTarget}
          reason={settings.discovery.stopReason}
          sessionInspections={progress.sessionInspections}
          sessionCap={settings.discovery.sessionInspectionCap}
          dailyInspections={progress.dailyInspections}
          dailyInspectionCap={settings.discovery.dailyInspectionCap}
          dailyAi={progress.dailyAi}
          dailyAiCap={settings.discovery.dailyAiCap}
          lastEvent={worker?.last_event}
          workerTask={worker?.current_task}
          attentionReason={worker?.attention_reason}
          timeZone={settings.timezone}
        />
      </div>
      <DiscoveryV2Status lastEvent={worker?.last_event} task={worker?.current_task} />
      <WorkerStatusPanel
        health={health}
        connected={health.state === "online" || health.state === "attention"}
        rows={[
          { label: "Machine name", value: worker?.machine_name || "Not reported" },
          { label: "Platform", value: platformLabel(worker?.platform) },
          { label: "Hostname", value: worker?.hostname || "Not reported" },
          { label: "Worker ID", value: worker?.worker_id || "Not reported" },
          {
            label: "Last heartbeat",
            value: worker?.last_heartbeat_at
              ? `${formatRelativeTime(worker.last_heartbeat_at)} (${formatDateTime(worker.last_heartbeat_at, settings.timezone, settings.dateFormat)})`
              : "Never",
          },
          { label: "Connection", value: health.state === "offline" ? "Offline" : health.state === "attention" ? health.label : "Online" },
          {
            label: "Current mode",
            value: health.state === "offline" ? "Offline" : modeLabel(worker?.current_task),
          },
          {
            label: "Current profile",
            value: worker?.current_username ? `@${worker.current_username}` : "None",
          },
          { label: "Last task", value: worker?.current_task === "offline" ? "Stopped" : worker?.current_task || "None" },
          { label: "Browser connected", value: yesNo(worker?.browser_connected) },
          { label: "Instagram authenticated", value: yesNo(worker?.instagram_authenticated) },
          {
            label: "Started at",
            value: worker?.started_at
              ? formatDateTime(worker.started_at, settings.timezone, settings.dateFormat)
              : "Not reported",
          },
          {
            label: "Connection health",
            value: health.label,
          },
          {
            label: "Outreach",
            value: settings.outreach.automationEnabled ? "Running" : "Paused",
          },
          { label: "Discovery", value: settings.discovery.enabled ? "On" : "Off" },
          { label: "Profiles seen today", value: String(Math.max(discovery.seenToday ?? 0, worker?.profiles_seen ?? 0)) },
          { label: "New prospects today", value: String(discovery.newProspects) },
          { label: "Already-following skipped", value: String(Math.max(discovery.followingSkipped, worker?.profiles_excluded_following ?? 0)) },
          { label: "AI qualified today", value: String(Math.max(discovery.qualified, worker?.profiles_qualified ?? 0)) },
          { label: "Session profiles seen", value: String(worker?.profiles_seen ?? 0) },
          { label: "Session prospects added", value: String(worker?.profiles_ingested ?? 0) },
          { label: "Session excluded", value: String(worker?.profiles_excluded_following ?? 0) },
          { label: "Session qualified", value: String(worker?.profiles_qualified ?? 0) },
          { label: "Session errors", value: String(worker?.session_errors ?? 0) },
          { label: "Last event", value: worker?.last_event || "None" },
          { label: "Last error", value: worker?.attention_reason || "None" },
          { label: "Current claimed job", value: outreach?.currentJob ?? "None" },
          { label: "Claimed by", value: outreach?.currentWorker ?? "None" },
          { label: "Last completed task", value: outreach?.lastCompleted ?? "None" },
          { label: "Jobs completed today", value: String(outreach?.completedToday ?? 0) },
          { label: "Jobs failed today", value: String(outreach?.failedToday ?? 0) },
          { label: "Queue depth", value: outreach ? `${outreach.queueProspects} prospects` : "Unavailable" },
          {
            label: "Next scheduled job",
            value: outreach?.nextAt
              ? formatDateTime(outreach.nextAt, settings.timezone, settings.dateFormat)
              : "None",
          },
        ]}
      />
    </div>
  );
}

function DiscoveryV2Status({ lastEvent, task }: { lastEvent?: string | null; task?: string | null }) {
  const status = parseDiscoveryStatus(lastEvent);
  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-900">Discovery</h2>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Source</dt>
          <dd className="text-slate-800">{status?.source ?? "Waiting for the worker"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Candidate queue</dt>
          <dd className="text-slate-800">{status ? `${status.pending} pending` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Profile tab 1</dt>
          <dd className="text-slate-800">{status?.tab1 ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Profile tab 2</dt>
          <dd className="text-slate-800">{status?.tab2 ?? "—"}</dd>
        </div>
      </dl>
      {task ? <p className="mt-2 text-xs text-slate-500">{modeLabel(task)}</p> : null}
    </section>
  );
}

function modeLabel(task: string | null | undefined) {
  if (!task || task === "offline") return "Idle";
  if (task === "idle") return "Idle";
  if (task === "paused") return "Paused";
  if (task === "auth_required") return "Authentication Required";
  if (task === "attention_required") return "Attention Required";
  if (task === "discovering_candidates") return "Collecting candidates";
  if (task === "inspecting_profiles") return "Inspecting profiles";
  if (task === "qualifying_profiles" || task.startsWith("qualifying")) return "Qualifying";
  if (task === "discovery_hourly_wait") return "Waiting — hourly pace";
  if (task.startsWith("discovering")) return "Discovering";
  if (task.startsWith("executing_")) return "Outreach";
  return task;
}
