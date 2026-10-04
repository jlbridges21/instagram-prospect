import type { Metadata } from "next";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { RecentProspects } from "@/components/dashboard/recent-prospects";
import { HomeActions } from "@/components/home/home-actions";
import { LiveProspectSync } from "@/components/prospects/live-sync";
import { ProgressMetric } from "@/components/ui/progress-metric";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { PageHeader } from "@/components/layout/page-header";
import { getOutreachSnapshot } from "@/lib/db/outreach";
import { getRecentActivity } from "@/lib/db/stats";
import { getRecentProspects } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import type { ProspectRow } from "@/lib/db/types";
import { formatDate, formatRelativeTime } from "@/lib/utils/format";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { attentionKind, formatCurrentAction, formatDiscoveryStatus, formatOutreachStatus, formatWorkerStatus, isStateSyncFailure } from "@/lib/status/operations";
import { parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";

export const metadata: Metadata = { title: "Home" };

function nameOf(row: Pick<ProspectRow, "display_name" | "first_name" | "instagram_username">) {
  return row.display_name || row.first_name || row.instagram_username;
}

export default async function OverviewPage() {
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const [recentResult, activityResult, workerResult, outreach] =
    await Promise.all([
      getRecentProspects(),
      getRecentActivity(),
      getLatestWorker(),
      getOutreachSnapshot(settings.timezone),
    ]);

  const failures = [settingsResult, recentResult, activityResult, workerResult].flatMap(
    (result) => (result.ok ? [] : [result]),
  );
  const missing = failures.find((result) => result.missingTable);
  const failure = failures.find((result) => !result.missingTable);
  const health = getWorkerHealth({
    status: workerResult.ok ? workerResult.data?.status ?? null : null,
    lastHeartbeatAt: workerResult.ok ? workerResult.data?.last_heartbeat_at ?? null : null,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    currentTask: workerResult.ok ? workerResult.data?.current_task : null,
    attentionReason: workerResult.ok ? workerResult.data?.attention_reason : null,
  });
  const worker = workerResult.ok ? workerResult.data : null;
  const now = new Date();
  const nextOutreachAt = outreach?.nextAt ?? null;
  const outreachPacing =
    settings.outreach.automationEnabled && nextOutreachAt && new Date(nextOutreachAt).getTime() > now.getTime()
      ? { reason: "Waiting for the next scheduled action", nextAt: nextOutreachAt }
      : null;
  const progress = await getDiscoveryV3Snapshot(settings.timezone);
  const online = health.state === "online" || health.state === "attention";
  const workerState = formatWorkerStatus({
    online,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    attentionText: worker?.attention_reason,
  });
  const discoveryState = formatDiscoveryStatus({
    online,
    enabled: settings.discovery.enabled,
    stopReason: settings.discovery.stopReason,
    hourly: settings.discovery.enabled ? parseHourlyWaitEvent(worker?.last_event) : null,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    attentionText: worker?.attention_reason,
    reviewCount: progress.currentReview,
    reviewTarget: settings.discovery.reviewTarget,
    browser: parseBrowserHealthEvent(worker?.last_event)?.state ?? "connected",
    yieldingToOutreach: settings.discovery.enabled && !parseHourlyWaitEvent(worker?.last_event) && Boolean(worker?.current_task?.startsWith("executing_")),
  });
  const outreachState = formatOutreachStatus({
    online,
    enabled: settings.outreach.automationEnabled,
    queueCount: outreach?.queueProspects ?? 0,
    pacingWait: outreachPacing,
    acting: worker?.current_task?.startsWith("executing_") === true,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    stateSync: isStateSyncFailure(worker?.attention_reason) ? { username: worker?.current_username } : null,
    browser: parseBrowserHealthEvent(worker?.last_event)?.state ?? "connected",
  });

  return (
    <div>
      <PageHeader
        title="Home"
        description="Your Instagram outreach control center."
      />
      <LiveProspectSync />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatusLink href="/worker" label="Worker" value={workerState.label} detail={health.state === "offline" ? `Last seen ${worker?.last_heartbeat_at ? formatRelativeTime(worker.last_heartbeat_at) : "never"}` : "Browser and Instagram status are on Worker."} />
        <StatusLink href="/discovery" label="Discovery" value={discoveryState.actual} detail={discoveryState.reason} />
        <StatusLink href="/outreach" label="Outreach" value={outreachState.actual} detail={outreachState.reason} />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <ProgressMetric label="Review progress" value={progress.currentReview} max={settings.discovery.reviewTarget} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <ProgressMetric label="Profiles inspected today" value={progress.dailyInspections} max={settings.discovery.dailyInspectionCap} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <ProgressMetric label="Qualified today" value={progress.dailyAi} max={settings.discovery.dailyAiCap} hint="AI qualifications used today." />
        </div>
      </section>
      <HomeActions
        online={health.state === "online" || health.state === "attention"}
        discoveryRunning={settings.discovery.enabled}
        outreachRunning={settings.outreach.automationEnabled}
        reviewCount={progress.currentReview}
        queueCount={outreach?.queueProspects ?? 0}
        hourlyMaximum={settings.outreach.hourlyMaximum}
        dailyMaximum={settings.outreach.dailyMaximum}
        minimumSpacingSeconds={settings.outreach.minimumActionDelaySeconds}
      />
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold text-slate-900">Current worker activity</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Current action" value={formatCurrentAction(worker?.current_task, worker?.current_username)} />
          <Field label="Current username" value={worker?.current_username ? `@${worker.current_username.replace(/^@/, "")}` : "None"} />
          <Field label="Outreach" value={outreachState.actual} />
          <Field label="Discovery" value={discoveryState.actual} />
          <Field label="Worker health" value={workerState.label} />
          <Field label="Last event" value={worker?.last_event || "None yet"} />
        </dl>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-indigo-700">Advanced details</summary>
          <dl className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <Field label="Worker id" value={worker?.worker_id ?? "Not connected"} />
            <Field label="Browser" value={parseBrowserHealthEvent(worker?.last_event)?.state ?? (worker?.browser_connected ? "connected" : "not reported")} />
            <Field label="Heartbeat" value={worker?.last_heartbeat_at ? formatRelativeTime(worker.last_heartbeat_at) : "Never"} />
            <Field label="Queue" value={String(outreach?.queueProspects ?? 0)} />
            <Field label="Last error" value={worker?.attention_reason || "None"} />
          </dl>
        </details>
      </section>
      {missing ? <div className="mb-6"><DatabaseSetup message={missing.error} /></div> : null}
      {failure ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {failure.error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecentProspects
            prospects={(recentResult.ok ? recentResult.data : []).map((prospect) => ({
              id: prospect.id,
              name: nameOf(prospect),
              username: prospect.instagram_username,
              status: prospect.status,
              followers: prospect.follower_count,
              discoveredLabel: formatDate(
                prospect.discovered_at,
                settings.timezone,
                settings.dateFormat,
              ),
              pictureUrl: prospect.profile_picture_url,
              fitLabel: prospect.fit_label,
              fitScore: prospect.fit_score,
            }))}
          />
        </div>
        <div className="lg:col-span-2">
          <RecentActivity
            events={(activityResult.ok ? activityResult.data : []).map((event) => ({
              id: event.id,
              description: event.description,
              timeLabel: formatRelativeTime(event.created_at),
              href: event.prospect_id ? `/prospects/${event.prospect_id}` : null,
              eventType: event.event_type,
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function StatusLink({ href, label, value, detail }: { href: string; label: string; value: string; detail: string }) {
  return (
    <a href={href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-600">{detail}</p>
    </a>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
    </div>
  );
}
