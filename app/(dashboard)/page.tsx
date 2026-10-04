import type { Metadata } from "next";
import { CalendarClock, Check, Inbox, MessageSquare, Reply, Sparkles, UserCheck } from "lucide-react";
import { FunnelChart, StatCard } from "@/components/dashboard/metrics";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { RecentProspects } from "@/components/dashboard/recent-prospects";
import { WorkerSummary } from "@/components/dashboard/worker-summary";
import { LiveProspectSync } from "@/components/prospects/live-sync";
import { OperationSummary } from "@/components/status/operation-summary";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { PageHeader } from "@/components/layout/page-header";
import { countFollowUpsDue } from "@/lib/db/follow-ups";
import { getOutreachSnapshot } from "@/lib/db/outreach";
import { getRecentActivity, getPipelineCounts, getQualificationSnapshot, emptyPipeline } from "@/lib/db/stats";
import { getRecentProspects } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import type { ProspectRow } from "@/lib/db/types";
import { endOfTodayIso, formatDate, formatDateTime, formatRelativeTime, platformLabel, startOfTodayIso } from "@/lib/utils/format";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { attentionKind, formatCurrentAction, formatDiscoveryStatus, formatOutreachStatus, formatWorkerStatus, isStateSyncFailure } from "@/lib/status/operations";
import { parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";

export const metadata: Metadata = { title: "Overview" };

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function nameOf(row: Pick<ProspectRow, "display_name" | "first_name" | "instagram_username">) {
  return row.display_name || row.first_name || row.instagram_username;
}

export default async function OverviewPage() {
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const todayStart = startOfTodayIso(settings.timezone);

  const [pipelineResult, recentResult, activityResult, workerResult, dueFollowUps, qualification, outreach] =
    await Promise.all([
      getPipelineCounts(todayStart),
      getRecentProspects(),
      getRecentActivity(),
      getLatestWorker(),
      countFollowUpsDue(endOfTodayIso(settings.timezone)),
      getQualificationSnapshot(todayStart),
      getOutreachSnapshot(settings.timezone),
    ]);

  const failures = [settingsResult, pipelineResult, recentResult, activityResult, workerResult].flatMap(
    (result) => (result.ok ? [] : [result]),
  );
  const missing = failures.find((result) => result.missingTable);
  const failure = failures.find((result) => !result.missingTable);

  const counts = pipelineResult.ok ? pipelineResult.data : emptyPipeline();
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

  const cards = [
    { label: "Found today", value: counts.foundToday, hint: "Since midnight", icon: Inbox },
    { label: "Qualified", value: counts.qualified, hint: "Matches targeting criteria", icon: Sparkles },
    { label: "Pending review", value: counts.pendingReview, hint: "Needs a decision", icon: UserCheck },
    { label: "Approved", value: counts.approvedCurrent, hint: "Ready for outreach", icon: Check },
    { label: "Contacted", value: counts.contacted, hint: "Messages sent", icon: MessageSquare },
    { label: "Replies", value: counts.replied, hint: "Replies recorded", icon: Reply },
    { label: "Demos", value: counts.demoBooked, hint: "Demos booked", icon: CalendarClock },
    { label: "Follow-ups due", value: dueFollowUps, hint: "Due today or overdue", icon: CalendarClock },
  ];

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Worker, Discovery, and the current action. Open a workflow page to change it."
      />
      <LiveProspectSync />
      <OperationSummary
        timeZone={settings.timezone}
        action={formatCurrentAction(worker?.current_task, worker?.current_username)}
        review={settings.discovery.reviewTarget === "unlimited" ? `${progress.currentReview} / Unlimited` : `${progress.currentReview} / ${settings.discovery.reviewTarget}`}
        today={{ inspected: progress.dailyInspections, ai: progress.dailyAi, sent: outreach?.sentToday ?? 0 }}
        worker={formatWorkerStatus({
          online: health.state === "online" || health.state === "attention",
          attention: attentionKind(worker?.current_task, worker?.attention_reason),
          attentionText: worker?.attention_reason,
        })}
        discovery={formatDiscoveryStatus({
          online: health.state === "online" || health.state === "attention",
          enabled: settings.discovery.enabled,
          stopReason: settings.discovery.stopReason,
          hourly: settings.discovery.enabled ? parseHourlyWaitEvent(worker?.last_event) : null,
          attention: attentionKind(worker?.current_task, worker?.attention_reason),
          attentionText: worker?.attention_reason,
          reviewCount: progress.currentReview,
          reviewTarget: settings.discovery.reviewTarget,
          browser: parseBrowserHealthEvent(worker?.last_event)?.state ?? "connected",
        })}
        outreach={formatOutreachStatus({
          online: health.state === "online" || health.state === "attention",
          enabled: settings.outreach.automationEnabled,
          queueCount: outreach?.queueProspects ?? 0,
          pacingWait: outreachPacing,
          acting: worker?.current_task?.startsWith("executing_") === true,
          attention: attentionKind(worker?.current_task, worker?.attention_reason),
          stateSync: isStateSyncFailure(worker?.attention_reason) ? { username: worker?.current_username } : null,
          browser: parseBrowserHealthEvent(worker?.last_event)?.state ?? "connected",
        })}
      />
      {missing ? <div className="mb-6"><DatabaseSetup message={missing.error} /></div> : null}
      {failure ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {failure.error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={String(card.value)}
            hint={card.hint}
            icon={card.icon}
          />
        ))}
      </div>

      {outreach ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Outreach</h2>
              <p className="mt-1 text-xs text-slate-500">
                {outreach.nextAt
                  ? `Next ${formatDateTime(outreach.nextAt, settings.timezone, settings.dateFormat)}`
                  : "Open Outreach to start or pause."}
              </p>
            </div>
            <a href="/outreach" className="text-sm font-medium text-indigo-700">Open Outreach</a>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Queue" value={outreach.queueProspects} />
            <Mini label="Sent today" value={outreach.sentToday} />
            <Mini label="Failed jobs" value={outreach.failedJobs} />
            <Mini label="Scheduled today" value={outreach.scheduledToday} />
          </dl>
        </section>
      ) : null}

      {qualification ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Qualification</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Analyzed today" value={qualification.analyzedToday} />
            <Mini label="Strong fits" value={qualification.strongFits} />
            <Mini label="Possible fits" value={qualification.possibleFits} />
            <Mini label="Disqualified" value={qualification.disqualified} />
          </dl>
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold text-slate-900">Outreach funnel</h2>
          <p className="mt-1 text-xs text-slate-500">
            Each stage counts prospects with that milestone recorded.
          </p>
          <div className="mt-5">
            <FunnelChart
              stages={[
                { label: "Discovered", count: counts.discovered },
                { label: "Qualified", count: counts.qualified },
                { label: "Approved", count: counts.approved },
                { label: "Contacted", count: counts.contacted },
                { label: "Replied", count: counts.replied },
                { label: "Demo booked", count: counts.demoBooked },
                { label: "Converted", count: counts.converted },
              ]}
            />
          </div>
        </section>
        <div className="lg:col-span-2">
          <WorkerSummary
            health={health}
            machineName={worker?.machine_name || "Not reported"}
            osLabel={platformLabel(worker?.platform)}
            lastHeartbeat={
              worker?.last_heartbeat_at
                ? formatRelativeTime(worker.last_heartbeat_at)
                : "Never"
            }
            currentTask={worker?.current_task || "None"}
          />
        </div>
      </div>

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
