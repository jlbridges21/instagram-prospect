import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ProgressMetric } from "@/components/ui/progress-metric";
import { StartDiscoveryButton } from "@/components/worker/start-discovery-button";
import { DiscoveryRunButtons } from "@/components/worker/discovery-run-buttons";
import { getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import { parseHourlyWaitEvent, formatResumeClock } from "@/lib/discovery/pacing";
import { attentionKind, formatCurrentAction, formatDiscoveryStatus, outreachOwnsWorker, statusDotClass } from "@/lib/status/operations";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";
import { getWorkerHealth } from "@/lib/utils/worker-health";

export const metadata: Metadata = { title: "Discovery" };

export default async function DiscoveryPage() {
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const workerResult = await getLatestWorker();
  const worker = workerResult.ok ? workerResult.data : null;
  const progress = await getDiscoveryV3Snapshot(settings.timezone);
  const health = getWorkerHealth({
    status: worker?.status ?? null,
    lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    currentTask: worker?.current_task,
    attentionReason: worker?.attention_reason,
  });
  const online = health.state === "online" || health.state === "attention";
  const hourly = settings.discovery.enabled ? parseHourlyWaitEvent(worker?.last_event) : null;
  const status = formatDiscoveryStatus({
    online,
    enabled: settings.discovery.enabled,
    stopReason: settings.discovery.stopReason,
    hourly,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    attentionText: worker?.attention_reason,
    reviewCount: progress.currentReview,
    reviewTarget: settings.discovery.reviewTarget,
    browser: parseBrowserHealthEvent(worker?.last_event)?.state ?? "connected",
    yieldingToOutreach: settings.discovery.enabled && !hourly && outreachOwnsWorker(worker?.current_task),
  });
  const servicingOutreach = outreachOwnsWorker(worker?.current_task) && !worker?.current_task?.includes("spacing");
  const action = hourly
    ? "Waiting for the hourly inspection slot"
    : servicingOutreach
      ? "Temporarily yielding to Outreach"
      : formatCurrentAction(worker?.current_task, worker?.current_username);

  return (
    <div>
      <PageHeader
        title="Discovery"
        description="Find qualified prospects and fill your Review queue."
        action={<StartDiscoveryButton disabled={!online} reviewCount={progress.currentReview} />}
      />
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status.tone)}`} aria-hidden />
          <h2 className="font-semibold text-slate-900">Discovery {status.actual}</h2>
        </div>
        <p className="mt-2 text-slate-700">Desired: {status.desired}</p>
        <p className="mt-1 text-slate-700">{status.reason}</p>
        {status.detail ? <p className="mt-1 text-slate-600">{status.detail}</p> : null}
        {status.resumesAt ? <p className="mt-2">Next profile slot opens at {formatResumeClock(status.resumesAt, settings.timezone)}. One older inspection leaves the rolling hour at that time. The full allowance does not reset at once.</p> : null}
        {status.action ? <p className="mt-2 text-slate-800">{status.action}</p> : null}
        {servicingOutreach ? <p className="mt-2 text-slate-700">Temporarily yielding browser control to Outreach.</p> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ProgressMetric label="Review target" value={progress.currentReview} max={settings.discovery.reviewTarget} hint="Possible Fit and Strong Fit profiles waiting for a decision." />
          <ProgressMetric label="Hourly inspections" value={hourly?.count ?? 0} max={hourly?.limit ?? settings.discovery.maxProfilesPerHour} hint="Profile inspections in the rolling hour. This does not limit Follow or DM." />
          <ProgressMetric label="Daily inspections" value={progress.dailyInspections} max={settings.discovery.dailyInspectionCap} />
          <ProgressMetric label="Daily AI qualifications" value={progress.dailyAi} max={settings.discovery.dailyAiCap} />
          <ProgressMetric label="Session inspections" value={progress.sessionInspections} max={settings.discovery.sessionInspectionCap} />
          <div>
            <p className="text-xs font-medium text-slate-500">Current action</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{action}</p>
            <p className="mt-2 text-xs text-slate-500">
              Sources: {settings.discovery.suggestedAccountsEnabled ? "Suggested Accounts" : "Suggested Accounts off"}
              {" · "}
              {settings.discovery.homeFeedEnabled ? "Home Feed" : "Home Feed off"}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <DiscoveryRunButtons online={online} running={settings.discovery.enabled} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Pause stops new Discovery work and keeps this session available to resume. Stop ends this session. The next start begins a new one.
          {" "}
          <Link href="/settings" className="text-indigo-700">Edit Discovery settings</Link>
        </p>
      </section>
      {status.actual === "STOPPED" || status.actual === "BLOCKED" || status.actual === "WAITING" ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold text-slate-900">Why Discovery is {status.actual.toLowerCase()}</h2>
          <p className="mt-2">{status.reason}</p>
          {status.detail ? <p className="mt-1 text-slate-600">{status.detail}</p> : null}
          {status.action ? <p className="mt-2">{status.action}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

