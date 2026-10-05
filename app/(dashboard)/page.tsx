import type { Metadata } from "next";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { OverviewStage, type OverviewPin, type OverviewProspect } from "@/components/home/overview-stage";
import { LiveProspectSync } from "@/components/prospects/live-sync";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { getOutreachSnapshot } from "@/lib/db/outreach";
import { getRecentActivity } from "@/lib/db/stats";
import { getLocatedProspects, getProspectCard, getProspectTabCounts, getRecentProspects } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import type { ProspectRow } from "@/lib/db/types";
import { locateUsPlace, projectUsPlace } from "@/lib/geo/us-places";
import { formatRelativeTime } from "@/lib/utils/format";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { attentionKind, formatCurrentAction, formatDiscoveryStatus, formatOutreachStatus, isStateSyncFailure } from "@/lib/status/operations";
import { parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";

export const metadata: Metadata = { title: "Overview" };

function nameOf(row: Pick<ProspectRow, "display_name" | "first_name" | "instagram_username">) {
  return row.display_name || row.first_name || row.instagram_username;
}

export default async function OverviewPage() {
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const [recentResult, activityResult, workerResult, outreach, locatedResult] = await Promise.all([
    getRecentProspects(8),
    getRecentActivity(),
    getLatestWorker(),
    getOutreachSnapshot(settings.timezone),
    getLocatedProspects(),
  ]);
  const failures = [settingsResult, recentResult, activityResult, workerResult, locatedResult].flatMap((result) => (result.ok ? [] : [result]));
  const missing = failures.find((result) => result.missingTable);
  const failure = failures.find((result) => !result.missingTable);
  const worker = workerResult.ok ? workerResult.data : null;
  const health = getWorkerHealth({
    status: worker?.status ?? null,
    lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    currentTask: worker?.current_task,
    attentionReason: worker?.attention_reason,
  });
  const progress = await getDiscoveryV3Snapshot(settings.timezone);
  const counts = await getProspectTabCounts();
  const online = health.state === "online" || health.state === "attention";
  const hourly = settings.discovery.enabled ? parseHourlyWaitEvent(worker?.last_event) : null;
  const browser = parseBrowserHealthEvent(worker?.last_event);
  const now = new Date();
  const nextOutreachAt = outreach?.nextAt ?? null;
  const outreachPacing = settings.outreach.automationEnabled && nextOutreachAt && new Date(nextOutreachAt).getTime() > now.getTime()
    ? { reason: "Waiting for the next scheduled action", nextAt: nextOutreachAt }
    : null;
  const discoveryState = formatDiscoveryStatus({
    online,
    enabled: settings.discovery.enabled,
    stopReason: settings.discovery.stopReason,
    hourly,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    attentionText: worker?.attention_reason,
    reviewCount: progress.currentReview,
    reviewTarget: settings.discovery.reviewTarget,
    browser: browser?.state ?? "connected",
    yieldingToOutreach: settings.discovery.enabled && !hourly && Boolean(worker?.current_task?.startsWith("executing_")),
  });
  const outreachState = formatOutreachStatus({
    online,
    enabled: settings.outreach.automationEnabled,
    queueCount: outreach?.queueProspects ?? 0,
    pacingWait: outreachPacing,
    acting: worker?.current_task?.startsWith("executing_") === true,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    stateSync: isStateSyncFailure(worker?.attention_reason) ? { username: worker?.current_username } : null,
    browser: browser?.state ?? "connected",
  });
  const card = await getProspectCard(worker?.current_username ?? null);
  const current: OverviewProspect | null = card
    ? {
        id: card.id,
        username: card.instagram_username,
        name: card.display_name || card.instagram_username,
        pictureUrl: card.profile_picture_url,
        followers: card.follower_count,
        fitLabel: card.fit_label,
        fitScore: card.fit_score,
        status: card.status,
        location: card.location_text,
        category: card.category,
        source: card.source ?? null,
        relationship: card.follow_relationship ?? null,
      }
    : null;
  const pins: OverviewPin[] = [];
  for (const row of locatedResult.ok ? locatedResult.data : []) {
    const place = locateUsPlace(row.location_text);
    if (!place) continue;
    const point = projectUsPlace(place);
    pins.push({
      id: row.id,
      username: row.instagram_username,
      name: row.display_name || row.instagram_username,
      pictureUrl: row.profile_picture_url,
      followers: row.follower_count,
      fitLabel: row.fit_label,
      fitScore: row.fit_score,
      status: row.status,
      place: place.label,
      category: row.category,
      x: point.x,
      y: point.y,
    });
  }
  const queue: OverviewProspect[] = (recentResult.ok ? recentResult.data : []).map((prospect) => ({
    id: prospect.id,
    username: prospect.instagram_username,
    name: nameOf(prospect),
    pictureUrl: prospect.profile_picture_url,
    followers: prospect.follower_count,
    fitLabel: prospect.fit_label,
    fitScore: prospect.fit_score,
    status: prospect.status,
    location: prospect.location_text,
    category: prospect.category,
    source: prospect.source,
    relationship: null,
  }));

  return (
    <div>
      <LiveProspectSync />
      {missing ? <div className="mb-6"><DatabaseSetup message={missing.error} /></div> : null}
      {failure ? <div className="mb-6 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{failure.error}</div> : null}
      <OverviewStage
        actions={{
          online,
          discoveryRunning: settings.discovery.enabled,
          outreachRunning: settings.outreach.automationEnabled,
          reviewCount: progress.currentReview,
          queueCount: outreach?.queueProspects ?? 0,
          hourlyMaximum: settings.outreach.hourlyMaximum,
          dailyMaximum: settings.outreach.dailyMaximum,
          minimumSpacingSeconds: settings.outreach.minimumActionDelaySeconds,
          browserRestart: browser?.state === "closed" || browser?.state === "failed",
        }}
        current={current}
        worker={{
          task: worker?.current_task ?? null,
          username: worker?.current_username ?? null,
          browser: browser?.state ?? (worker?.browser_connected ? "connected" : "not reported"),
          authenticated: worker?.instagram_authenticated === true,
          connected: online,
          action: formatCurrentAction(worker?.current_task, worker?.current_username),
        }}
        pins={pins}
        pipeline={[
          { label: "Suppressed", count: counts.suppressed },
          { label: "Review", count: counts.review },
          { label: "Approved", count: counts.approved },
          { label: "Outreach", count: counts.outreach },
          { label: "Contacted", count: counts.contacted },
          { label: "Excluded", count: counts.excluded },
        ]}
        queue={queue}
      />
      <p className="mt-2 text-xs text-slate-500">
        Discovery {discoveryState.actual}. Outreach {outreachState.actual}.
        {hourly ? ` Hourly inspections ${hourly.count} / ${hourly.limit}.` : ` ${progress.dailyInspections} profiles inspected today.`}
      </p>
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
  );
}
