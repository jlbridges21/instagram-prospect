import { discoveryProgressLabel, type DiscoveryStopReason, type ReviewTarget } from "@/lib/discovery/policy";
import { formatResumeClock, parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { parseDiscoveryStatus } from "@/lib/worker/discovery-status";

export function DiscoveryProgress({
  running,
  currentReview,
  target,
  reason,
  sessionInspections,
  sessionCap,
  dailyInspections,
  dailyInspectionCap,
  dailyAi,
  dailyAiCap,
  lastEvent,
  workerTask,
  attentionReason,
  timeZone,
}: {
  running: boolean;
  currentReview: number;
  target: ReviewTarget;
  reason: string | null;
  sessionInspections: number;
  sessionCap: number;
  dailyInspections: number;
  dailyInspectionCap: number;
  dailyAi: number;
  dailyAiCap: number;
  lastEvent?: string | null;
  workerTask?: string | null;
  attentionReason?: string | null;
  timeZone?: string;
}) {
  const waiting = running ? parseHourlyWaitEvent(lastEvent) : null;
  const hour = parseDiscoveryStatus(lastEvent)?.hour;
  const zone = timeZone || "UTC";
  if (workerTask === "attention_required" || workerTask === "auth_required") {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Browser automation paused</p>
        <p className="mt-2 whitespace-pre-wrap">{attentionReason || "Instagram needs attention in the browser window."}</p>
        <p className="mt-2">Discovery and Outreach database toggles were not changed. No follow, message, or profile inspection runs until the checkpoint is resolved.</p>
      </section>
    );
  }
  if (waiting) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">Discovery</p>
        <p>WAITING</p>
        <p className="mt-3">Review target</p>
        <p>{target === "unlimited" ? "Unlimited" : `${currentReview} / ${target}`}</p>
        <p className="mt-3">Hourly inspections</p>
        <p>{waiting.count} / {waiting.limit}</p>
        <p className="mt-3">This hour</p>
        <p>{waiting.count} / {waiting.limit} profile inspections</p>
        <p className="mt-3">Resumes</p>
        <p>{formatResumeClock(waiting.resumesAt, zone)}</p>
        <p className="mt-2 text-slate-500">Discovery stays on. Profile inspection resumes when the hourly pace window opens.</p>
      </section>
    );
  }
  const label = discoveryProgressLabel({
    running,
    currentReview,
    target,
    reason: (reason as DiscoveryStopReason | null) ?? null,
  });
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <pre className="whitespace-pre-wrap font-sans">{label}</pre>
      {hour ? <p className="mt-3">This hour {hour.replace("/", " / ")} profile inspections</p> : null}
      <p className="mt-3">This session {sessionInspections} / {sessionCap.toLocaleString()} profiles inspected</p>
      <p>Today {dailyInspections} / {dailyInspectionCap} inspections</p>
      <p>{dailyAi} / {dailyAiCap} AI qualifications</p>
      <p className="mt-2 text-slate-500">
        Discovery pauses when the review target or a discovery limit is reached. It stays paused until you start it again.
      </p>
    </section>
  );
}
