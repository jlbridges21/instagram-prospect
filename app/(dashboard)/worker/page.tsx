import type { Metadata } from "next";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { WorkerStatusPanel } from "@/components/worker/worker-status";
import { DiscoveryControls } from "@/components/worker/discovery-controls";
import { AutomationControls } from "@/components/outreach/automation-controls";
import { getDiscoveryToday } from "@/lib/db/discovery";
import { getOutreachSnapshot } from "@/lib/db/outreach";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import { formatDateTime, formatRelativeTime, platformLabel } from "@/lib/utils/format";
import { getWorkerHealth } from "@/lib/utils/worker-health";

export const metadata: Metadata = { title: "Worker" };

export default async function WorkerPage() {
  const [workerResult, settingsResult] = await Promise.all([getLatestWorker(), getSettings()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const [outreach, discovery] = await Promise.all([
    getOutreachSnapshot(settings.timezone),
    getDiscoveryToday(settings.timezone),
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
          { label: "Current task", value: worker?.current_task || "None" },
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
          { label: "Profiles seen today", value: String(discovery.seenToday ?? worker?.profiles_seen ?? 0) },
          { label: "New prospects today", value: String(discovery.newProspects) },
          { label: "AI qualified today", value: String(discovery.qualified) },
          { label: "Existing following skipped", value: String(discovery.followingSkipped) },
          { label: "Profiles seen this session", value: String(worker?.profiles_seen ?? 0) },
          { label: "Profiles qualified this session", value: String(worker?.profiles_qualified ?? 0) },
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
