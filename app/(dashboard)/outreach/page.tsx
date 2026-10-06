import type { Metadata } from "next";
import { MobileOutreach } from "@/components/mobile/mobile-outreach";
import { AutomationControls } from "@/components/outreach/automation-controls";
import { RecalculateScheduleButton } from "@/components/outreach/recalculate-schedule-button";
import { OutreachLive } from "@/components/outreach/outreach-live";
import { QueueBoard } from "@/components/outreach/queue-board";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { listOutreachJobs, getOutreachSnapshot } from "@/lib/db/outreach";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatDateTime } from "@/lib/utils/format";
import { getLatestWorker } from "@/lib/db/workers";
import { attentionKind, formatOutreachStatus, isStateSyncFailure } from "@/lib/status/operations";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { claimPaceDecision, paceReasonLabel, queueHealth, reflowPlan, type PaceJob } from "@/lib/outreach/pace";
import { compareQueueJobs, statusesForTab } from "@/lib/outreach/queue-sort";

export const metadata: Metadata = { title: "Outreach" };

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
  const healthCounts = queueHealth(paceJobs);
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
    stateSync: isStateSyncFailure(worker?.attention_reason) ? { username: worker?.current_username } : null,
  });

  const upcomingStatuses = new Set(statusesForTab("upcoming") ?? []);
  const prospectsById = new Map((queue.ok ? queue.data.prospects : []).map((prospect) => [prospect.id, prospect]));
  const upcoming = (queue.ok ? queue.data.jobs : [])
    .filter((job) => upcomingStatuses.has(job.status))
    .sort((left, right) => compareQueueJobs("upcoming", left, right))
    .slice(0, 12)
    .map((job) => {
      const prospect = prospectsById.get(job.prospect_id);
      return {
        id: job.prospect_id,
        username: prospect?.instagram_username ?? "prospect",
        pictureUrl: null,
        state: job.job_type.replaceAll("_", " "),
        when: null,
      };
    });

  return (
    <div>
      <MobileOutreach
        running={settings.outreach.automationEnabled}
        queued={snapshot?.queueProspects ?? 0}
        contacted={snapshot?.sentToday ?? 0}
        nextAt={pace.at?.toISOString() ?? null}
        currentTask={worker?.current_task ?? null}
        currentUsername={worker?.current_username ?? null}
        remaining={healthCounts.remaining}
        fresh={healthCounts.fresh}
        retrying={healthCounts.retrying}
        failed={healthCounts.failed}
        spacingSeconds={settings.outreach.minimumActionDelaySeconds}
        upcoming={upcoming}
        workerOnline={online}
        browser="connected"
        discovery={settings.discovery.enabled ? "RUNNING" : "PAUSED"}
      />
      <div className="hidden md:block">
      <PageHeader
        title="Outreach"
        description="Process approved prospects through verification, Follow, and DM. Pacing and daily limits still apply."
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
      <OutreachLive
        actual={outreachStatus.actual}
        tone={outreachStatus.tone}
        desired={outreachStatus.desired}
        reason={outreachStatus.reason}
        detail={outreachStatus.detail}
        username={pace.username}
        paceAt={pace.at?.toISOString() ?? null}
        paceReason={pace.action === "wait" ? paceReasonLabel(pace.reason) : null}
        remaining={healthCounts.remaining}
        fresh={healthCounts.fresh}
        retrying={healthCounts.retrying}
        failed={healthCounts.failed}
        queued={snapshot?.queueProspects ?? healthCounts.remaining}
        scheduledToday={snapshot?.scheduledToday ?? 0}
        sentToday={snapshot?.sentToday ?? 0}
        currentTask={worker?.current_task ?? null}
        currentUsername={worker?.current_username ?? null}
      />
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold text-slate-900">Pacing</h2>
        <p className="mt-1 text-xs text-slate-500">Approximate, based on saved settings and completed sends. Discovery can use the gaps between these sends.</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Minimum spacing" value={`${settings.outreach.minimumActionDelaySeconds} seconds`} />
          <Stat label="Completed sends per hour" value={String(settings.outreach.hourlyMaximum)} />
          <Stat label="Daily maximum" value={String(settings.outreach.dailyMaximum)} />
          <Stat label="Estimated finish" value={outlook.estimatedCompletion ? formatDateTime(outlook.estimatedCompletion.toISOString(), settings.timezone, settings.dateFormat) : "None queued"} />
        </dl>
      </section>
      {queue.ok ? (
        <QueueBoard
          jobs={queue.data.jobs}
          prospects={queue.data.prospects}
          timeZone={settings.timezone}
          dateFormat={settings.dateFormat}
        />
      ) : null}
      </div>
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
