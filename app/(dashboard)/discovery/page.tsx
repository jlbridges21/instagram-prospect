import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StartDiscoveryButton } from "@/components/worker/start-discovery-button";
import { DiscoveryRunButtons } from "@/components/worker/discovery-run-buttons";
import { getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import { parseHourlyWaitEvent, formatResumeClock } from "@/lib/discovery/pacing";
import { attentionKind, formatCurrentAction, formatDiscoveryStatus, statusDotClass } from "@/lib/status/operations";
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
  });
  const action = formatCurrentAction(worker?.current_task, worker?.current_username, Boolean(hourly));

  return (
    <div>
      <PageHeader
        title="Discovery"
        description="Choose a Review goal, watch progress, and pause or stop the current run."
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
        {status.resumesAt ? <p className="mt-2">Resumes automatically: {formatResumeClock(status.resumesAt, settings.timezone)}</p> : null}
        {status.action ? <p className="mt-2 text-slate-800">{status.action}</p> : null}
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric label="Review" value={settings.discovery.reviewTarget === "unlimited" ? `${progress.currentReview} / Unlimited` : `${progress.currentReview} / ${settings.discovery.reviewTarget}`} />
          <Metric label="This run" value={`${progress.sessionInspections} profiles inspected`} />
          <Metric label="This hour" value={hourly ? `${hourly.count} / ${hourly.limit}` : `— / ${settings.discovery.maxProfilesPerHour}`} />
          <Metric label="Today" value={`${progress.dailyInspections} / ${settings.discovery.dailyInspectionCap} inspections`} />
          <Metric label="AI today" value={`${progress.dailyAi} / ${settings.discovery.dailyAiCap}`} />
          <Metric label="Current action" value={action} />
        </dl>
        <div className="mt-4">
          <DiscoveryRunButtons online={online} running={settings.discovery.enabled} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Pause keeps this run so you can resume it. Stop ends the run. The next start creates a new one. Daily, session, and hourly limits still apply.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Sources: {settings.discovery.suggestedAccountsEnabled ? "Suggested Accounts" : "Suggested Accounts off"}
          {" · "}
          {settings.discovery.homeFeedEnabled ? "Home Feed" : "Home Feed off"}
          {" · "}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium text-slate-900">{value}</dd>
    </div>
  );
}
