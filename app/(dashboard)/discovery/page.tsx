import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ProgressMetric } from "@/components/ui/progress-metric";
import { StartDiscoveryButton } from "@/components/worker/start-discovery-button";
import { DiscoveryRunButtons } from "@/components/worker/discovery-run-buttons";
import { getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { discoveryOutcomeWindow, discoveryQualityStats, discoverySourceStats, listDiscoverySeeds, optimizationStartedAt } from "@/lib/db/seeds";
import { optimizationComparison } from "@/lib/discovery/quality";
import { QualityMarkerButton } from "@/components/discovery/quality-marker";
import { reviewYield } from "@/lib/discovery/seeds";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import { parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { parseDiscoveryStatus } from "@/lib/worker/discovery-status";
import { attentionKind, formatCurrentAction, formatDiscoveryStatus, outreachOwnsWorker, statusDotClass } from "@/lib/status/operations";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";
import { getWorkerHealth } from "@/lib/utils/worker-health";
import { NextInspectionCountdown } from "@/components/discovery/next-inspection";
import { DroneMark } from "@/components/visual/drone-mark";

export const metadata: Metadata = { title: "Discovery" };

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const range = params.range === "7" ? 7 : params.range === "30" ? 30 : null;
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const workerResult = await getLatestWorker();
  const worker = workerResult.ok ? workerResult.data : null;
  const now = Date.now();
  const marker = await optimizationStartedAt().catch(() => null);
  const [progress, seedsResult, sources, quality, today, week, month, allTime, beforeOptimization, afterOptimization] = await Promise.all([
    getDiscoveryV3Snapshot(settings.timezone),
    listDiscoverySeeds(),
    discoverySourceStats(range),
    discoveryQualityStats(range),
    discoveryOutcomeWindow(new Date(now - 24 * 60 * 60 * 1000).toISOString()),
    discoveryOutcomeWindow(new Date(now - 7 * 86400000).toISOString()),
    discoveryOutcomeWindow(new Date(now - 30 * 86400000).toISOString()),
    discoveryOutcomeWindow(null),
    marker ? discoveryOutcomeWindow(null, marker) : Promise.resolve(null),
    marker ? discoveryOutcomeWindow(marker) : Promise.resolve(null),
  ]);
  const comparison = beforeOptimization && afterOptimization
    ? optimizationComparison({ before: beforeOptimization, after: afterOptimization })
    : null;
  const seeds = seedsResult.ok ? seedsResult.data : [];
  const activeSeed = seeds.find((seed) => seed.is_active) ?? null;
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
  const candidatePool = parseDiscoveryStatus(worker?.last_event)?.pool ?? null;
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status.tone)}`} aria-hidden />
            <h2 className="font-semibold text-slate-900">Discovery {status.actual}</h2>
          </div>
          <DroneMark className="h-14 w-14" />
        </div>
        <p className="mt-2 text-slate-700">Desired: {status.desired}</p>
        <p className="mt-1 text-slate-700">{status.reason}</p>
        {status.detail ? <p className="mt-1 text-slate-600">{status.detail}</p> : null}
        <NextInspectionCountdown initialAt={status.resumesAt} enabled={settings.discovery.enabled} />
        {status.action ? <p className="mt-2 text-slate-800">{status.action}</p> : null}
        {servicingOutreach ? <p className="mt-2 text-slate-700">Temporarily yielding browser control to Outreach.</p> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ProgressMetric label="Review target" value={progress.currentReview} max={settings.discovery.reviewTarget} hint="Possible Fit and Strong Fit profiles waiting for a decision." />
          <ProgressMetric label="Profiles per hour" value={settings.discovery.maxProfilesPerHour} max={settings.discovery.maxProfilesPerHour} hint="Cadence only. Discovery inspects one profile per interval." />
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
      {candidatePool ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold text-slate-900">Candidate pool</h2>
          <p className="mt-1 text-slate-600">Local Discovery candidates. A profile appears on Prospects only after it is opened and ingested.</p>
          <p className="mt-3">{candidatePool.total} candidates</p>
          <p className="mt-1">Ranked: {candidatePool.ranked}</p>
          <p className="mt-1">Exploration eligible: {candidatePool.explorationEligible}</p>
          <p className="mt-1">Deferred: {candidatePool.deferred}</p>
          <p className="mt-1">Top candidate: {candidatePool.highest ?? "—"}</p>
        </section>
      ) : null}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold text-slate-900">Discovery quality</h2>
        <p className="mt-1 text-slate-600">Review yield is Review prospects divided by profiles inspected. Approval yield is Approved prospects divided by profiles inspected.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {[
            { label: "Today", stats: today },
            { label: "7 days", stats: week },
            { label: "30 days", stats: month },
            { label: "All time", stats: allTime },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-slate-50 p-3">
              <p className="font-medium text-slate-900">{item.label}</p>
              <p className="mt-1">{item.stats.inspected} inspected</p>
              <p>{item.stats.review} Review</p>
              <p>{item.stats.approved} Approved</p>
              <p className="mt-1">Review yield {item.stats.inspected === 0 ? "—" : `${Math.round(item.stats.reviewYield * 1000) / 10}%`}</p>
              <p>Approval yield {item.stats.inspected === 0 ? "—" : `${Math.round(item.stats.approvalYield * 1000) / 10}%`}</p>
            </div>
          ))}
        </div>
        {comparison ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="font-medium">Before this measurement</p>
              <p className="mt-1">{comparison.before.inspected} inspected · {comparison.before.review} Review · {comparison.before.approved} Approved</p>
              <p>Review yield {comparison.before.inspected === 0 ? "—" : `${Math.round(comparison.before.reviewYield * 1000) / 10}%`}</p>
              <p>Approval yield {comparison.before.inspected === 0 ? "—" : `${Math.round(comparison.before.approvalYield * 1000) / 10}%`}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="font-medium">After this measurement</p>
              <p className="mt-1">{comparison.after.inspected} inspected · {comparison.after.review} Review · {comparison.after.approved} Approved</p>
              <p>Review yield {comparison.after.inspected === 0 ? "—" : `${Math.round(comparison.after.reviewYield * 1000) / 10}%`}</p>
              <p>Approval yield {comparison.after.inspected === 0 ? "—" : `${Math.round(comparison.after.approvalYield * 1000) / 10}%`}</p>
              <p className="mt-1 text-slate-600">{comparison.ready ? "Sample is large enough to compare." : "Wait until 100 inspections have been stored after the marker."}</p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-slate-600">Set a marker before judging whether these scoring changes improved Review yield.</p>
        )}
        <QualityMarkerButton />
      </section>
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold text-slate-900">Pre-score results</h2>
        <p className="mt-1 text-slate-600">Review yield is counted from profiles that were actually opened after pre-score ranking. Compare this after 100–200 new inspections.</p>
        {quality ? (
          <>
            <p className="mt-3">Candidates collected: {quality.collected ?? "—"}</p>
            <p className="mt-1">Candidates pre-filtered: {quality.deferred ?? "—"}</p>
            <p className="mt-1">Profiles opened with a pre-score: {quality.opened}</p>
            <p className="mt-1">Review: {quality.review}</p>
            <p className="mt-1">Review yield per opened profile: {Math.round(quality.reviewPerOpened * 1000) / 10}%</p>
            <p className="mt-1">Review yield per collected candidate: {quality.reviewPerCollected == null ? "—" : `${Math.round(quality.reviewPerCollected * 1000) / 10}%`}</p>
            {quality.mix ? (
              <>
                <p className="mt-3">Fallback 18–24 inspections: {quality.mix.fallback} of {quality.mix.inspected} ({Math.round(quality.mix.fallbackShare * 100)}%)</p>
                <p className="mt-1">Score 25 or higher: {quality.mix.stronger}</p>
                <p className="mt-1">Average stored pre-score: {quality.mix.average == null ? "—" : Math.round(quality.mix.average)}</p>
                <p className="mt-1">Median stored pre-score: {quality.mix.median ?? "—"}</p>
              </>
            ) : null}
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1 font-medium">Pre-score</th>
                  <th className="py-1 font-medium">Opened</th>
                  <th className="py-1 font-medium">Review</th>
                  <th className="py-1 font-medium">Review yield</th>
                </tr>
              </thead>
              <tbody>
                {quality.bands.map((band) => (
                  <tr key={band.label}>
                    <td className="py-1">{band.label}</td>
                    <td>{band.inspected}</td>
                    <td>{band.review}</td>
                    <td>{band.inspected === 0 ? "—" : `${Math.round(band.reviewYield * 1000) / 10}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="mt-3 text-slate-500">Pre-score bands appear after the pre-score migration and new inspections.</p>
        )}
      </section>
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold text-slate-900">Discovery Sources</h2>
        <p className="mt-2">Leading seed: {activeSeed ? `@${activeSeed.instagram_username}` : "None yet"}</p>
        <p className="mt-1">Inspecting: {worker?.current_username ? `@${worker.current_username}` : "Idle"}</p>
        <p className="mt-1">Seed yield: {activeSeed ? `${Math.round(reviewYield(activeSeed.profiles_inspected, activeSeed.profiles_reaching_review) * 100)}%` : "—"}</p>
        <p className="mt-1 text-slate-600">Home Feed usage: {settings.optimization.homeFeedUsage}. Strategy: {settings.optimization.strategy}.</p>
        <p className="mt-3 text-xs text-slate-500">
          <Link href="/discovery?range=7">7 days</Link>
          {" · "}
          <Link href="/discovery?range=30">30 days</Link>
          {" · "}
          <Link href="/discovery">All time</Link>
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-1 font-medium">Source</th>
              <th className="py-1 font-medium">Profiles opened</th>
              <th className="py-1 font-medium">Review</th>
              <th className="py-1 font-medium">Review yield</th>
              <th className="py-1 font-medium">Approved</th>
              <th className="py-1 font-medium">Approval yield</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={row.source}>
                <td className="py-1">{row.source}</td>
                <td>{row.inspected}</td>
                <td>{row.review}</td>
                <td>{Math.round(row.reviewYield * 100)}%</td>
                <td>{row.approved}</td>
                <td>{Math.round(row.approvalYield * 100)}%</td>
              </tr>
            ))}
            <tr><td className="py-2 text-xs text-slate-500" colSpan={6}>Profiles opened, Review, and Review yield come from stored prospects for seed network, seed suggestions, Suggested Accounts, and Home Feed. Candidate collection is the session total above. Pre-filtered usernames are not counted as inspections.</td></tr>
          </tbody>
        </table>
        <h3 className="mt-4 font-semibold text-slate-900">Top Discovery Seeds</h3>
        <ul className="mt-2 space-y-1">
          {seeds.slice(0, 8).map((seed) => (
            <li key={seed.id}>
              @{seed.instagram_username} · {seed.profiles_inspected} inspected · {seed.profiles_reaching_review} Review · {Math.round(reviewYield(seed.profiles_inspected, seed.profiles_reaching_review) * 100)}% · {seed.profiles_approved} approved
            </li>
          ))}
          {seeds.length === 0 ? <li className="text-slate-500">Add seeds in Settings → Discovery.</li> : null}
        </ul>
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

