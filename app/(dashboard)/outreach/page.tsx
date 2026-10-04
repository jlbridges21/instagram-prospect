import type { Metadata } from "next";
import { AutomationControls } from "@/components/outreach/automation-controls";
import { RecalculateScheduleButton } from "@/components/outreach/recalculate-schedule-button";
import { QueueBoard } from "@/components/outreach/queue-board";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { listOutreachJobs, getOutreachSnapshot } from "@/lib/db/outreach";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatDateTime } from "@/lib/utils/format";
import { getLatestWorker } from "@/lib/db/workers";
import { attentionKind, formatCurrentAction, formatOutreachStatus, statusDotClass } from "@/lib/status/operations";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { formatResumeClock } from "@/lib/discovery/pacing";
import { claimPaceDecision, formatEligibleIn, paceReasonLabel, reflowPlan, type PaceJob } from "@/lib/outreach/pace";

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
  const paceJobs: PaceJob[] = queue.ok
    ? queue.data.jobs.map((job) => ({
        id: job.id,
        prospectId: job.prospect_id,
        username: queue.data.prospects.find((prospect) => prospect.id === job.prospect_id)?.instagram_username ?? null,
        jobType: job.job_type,
        status: job.status,
        scheduledFor: job.scheduled_for,
        availableAt: job.available_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        createdAt: job.created_at,
        result: job.result,
        lastError: job.last_error,
      }))
    : [];
  const completedSendTimes = paceJobs
    .filter((job) => job.jobType === "send_message" && job.status === "completed" && job.completedAt)
    .map((job) => new Date(job.completedAt as string));
  const paceInput = {
    now,
    timeZone: settings.timezone,
    minimumSpacingSeconds: settings.outreach.minimumActionDelaySeconds,
    hourlyMaximum: settings.outreach.hourlyMaximum,
    dailyMaximum: settings.outreach.dailyMaximum,
    completedSendTimes,
    jobs: paceJobs,
  };
  const pace = claimPaceDecision(paceInput);
  const outlook = reflowPlan(paceInput);
  const pacingWait =
    settings.outreach.automationEnabled && pace.action === "wait" && pace.at
      ? { reason: paceReasonLabel(pace.reason), nextAt: pace.at.toISOString() }
      : null;
  const outreachStatus = formatOutreachStatus({
    online,
    enabled: settings.outreach.automationEnabled,
    queueCount: snapshot?.queueProspects ?? 0,
    pacingWait,
    acting: worker?.current_task?.startsWith("executing_") === true,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
  });

  return (
    <div>
      <PageHeader
        title="Outreach Queue"
        description="Outreach can run at any time while enabled. Pacing and daily/hourly limits still apply. Approving a prospect does not send a message."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RecalculateScheduleButton />
            <AutomationControls enabled={settings.outreach.automationEnabled} />
          </div>
        }
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
        {pace.username ? <p className="mt-2">Next outreach: @{pace.username}</p> : null}
        {pace.at ? <p className="mt-1">Eligible in: {formatEligibleIn(pace.at, now)}</p> : null}
        {pace.action === "wait" ? <p className="mt-1">Reason: {paceReasonLabel(pace.reason)}</p> : null}
        {outreachStatus.resumesAt ? <p className="mt-1 text-slate-600">{formatResumeClock(outreachStatus.resumesAt, settings.timezone)}</p> : null}
        {outlook.remaining > 0 ? (
          <p className="mt-2">
            {outlook.remaining} prospect{outlook.remaining === 1 ? "" : "s"} remaining
            {outlook.estimatedCompletion ? `. Estimated completion: ~${formatDateTime(outlook.estimatedCompletion.toISOString(), settings.timezone, settings.dateFormat)}` : ""}
          </p>
        ) : null}
        <p className="mt-2">Current action: {formatCurrentAction(worker?.current_task, worker?.current_username)}</p>
        <p className="mt-3 text-xs text-slate-500">Pause stops new claims and keeps the queue. Stop ends this run the same way and does not cancel pending outreach. Cancel Pending Outreach stays a separate confirmed action in the control above.</p>
      </section>
      {snapshot ? (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Queued prospects" value={String(snapshot.queueProspects)} />
          <Stat label="Scheduled today" value={String(snapshot.scheduledToday)} />
          <Stat label="Sent today" value={String(snapshot.sentToday)} />
          <Stat
            label="Next eligible action"
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
