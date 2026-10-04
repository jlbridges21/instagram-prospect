import type { Metadata } from "next";
import { AutomationControls } from "@/components/outreach/automation-controls";
import { QueueBoard } from "@/components/outreach/queue-board";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { listOutreachJobs, getOutreachSnapshot } from "@/lib/db/outreach";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatDateTime } from "@/lib/utils/format";
import { getLatestWorker } from "@/lib/db/workers";
import { nextOpenInstant } from "@/lib/outreach/time";
import { attentionKind, formatCurrentAction, formatOutreachStatus, statusDotClass } from "@/lib/status/operations";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { formatResumeClock } from "@/lib/discovery/pacing";

export const metadata: Metadata = { title: "Outreach Queue" };

export default async function OutreachPage() {
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const [queue, snapshot, workerResult] = await Promise.all([
    listOutreachJobs(),
    getOutreachSnapshot(settings.timezone),
    getLatestWorker(),
  ]);
  const worker = workerResult.ok ? workerResult.data : null;
  const health = getWorkerHealth({
    status: worker?.status ?? null,
    lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    currentTask: worker?.current_task,
    attentionReason: worker?.attention_reason,
  });
  const online = health.state === "online" || health.state === "attention";
  const now = new Date();
  const opens = nextOpenInstant(now, settings.timezone, settings.outreach);
  const waiting = settings.outreach.automationEnabled && Math.abs(opens.getTime() - now.getTime()) >= 1000;
  const outreachStatus = formatOutreachStatus({
    online,
    enabled: settings.outreach.automationEnabled,
    queueCount: snapshot?.queueProspects ?? 0,
    outsideHours: waiting,
    nextWindow: waiting ? opens.toISOString() : snapshot?.nextAt ?? null,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
  });

  return (
    <div>
      <PageHeader
        title="Outreach Queue"
        description="Start, pause, or watch the approved queue. Approving a prospect does not send a message."
        action={<AutomationControls enabled={settings.outreach.automationEnabled} />}
      />
      {!queue.ok && queue.missingTable ? (
        <DatabaseSetup message="Run the Prompt 4 migration before using the outreach queue." />
      ) : null}
      {!queue.ok && !queue.missingTable ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {queue.error}
        </div>
      ) : null}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(outreachStatus.tone)}`} aria-hidden />
          <h2 className="font-semibold">Outreach {outreachStatus.actual}</h2>
        </div>
        <p className="mt-2">Desired: {outreachStatus.desired}</p>
        <p className="mt-1">{outreachStatus.reason}</p>
        {outreachStatus.detail ? <p className="mt-1 text-slate-600">{outreachStatus.detail}</p> : null}
        {outreachStatus.resumesAt ? <p className="mt-2">Next outreach window: {formatResumeClock(outreachStatus.resumesAt, settings.timezone)}</p> : null}
        <p className="mt-2">Current action: {formatCurrentAction(worker?.current_task, worker?.current_username)}</p>
        <p className="mt-3 text-xs text-slate-500">Pause stops new claims and keeps the queue. Stop ends this run the same way and does not cancel pending outreach. Cancel Pending Outreach stays a separate confirmed action in the control above.</p>
      </section>
      {snapshot ? (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Queued prospects" value={String(snapshot.queueProspects)} />
          <Stat label="Scheduled today" value={String(snapshot.scheduledToday)} />
          <Stat label="Sent today" value={String(snapshot.sentToday)} />
          <Stat
            label="Next outreach"
            value={snapshot.nextAt ? formatDateTime(snapshot.nextAt, settings.timezone, settings.dateFormat) : "None"}
          />
        </dl>
      ) : null}
      {queue.ok ? (
        <QueueBoard
          jobs={queue.data.jobs}
          prospects={queue.data.prospects}
          timeZone={settings.timezone}
          dateFormat={settings.dateFormat}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
