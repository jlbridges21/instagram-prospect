import { formatDiscoveryStatus, attentionKind, statusDotClass } from "@/lib/status/operations";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";
import type { ReviewTarget } from "@/lib/discovery/policy";
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
  const status = formatDiscoveryStatus({
    online: true,
    enabled: running,
    stopReason: reason,
    hourly: waiting,
    attention: attentionKind(workerTask, attentionReason),
    attentionText: attentionReason,
    reviewCount: currentReview,
    reviewTarget: target,
    browser: parseBrowserHealthEvent(lastEvent)?.state ?? "connected",
  });
  return (
    <section className={`rounded-2xl border p-4 text-sm ${status.tone === "blocked" ? "border-red-200 bg-red-50 text-red-950" : "border-slate-200 bg-white text-slate-700"}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status.tone)}`} aria-hidden />
        <p className="font-semibold">Discovery {status.label}</p>
      </div>
      <p className="mt-2">Desired: {status.desired}</p>
      <p>{status.reason}</p>
      {status.detail ? <p className="mt-1">{status.detail}</p> : null}
      {status.resumesAt ? <p className="mt-2">Resumes {formatResumeClock(status.resumesAt, zone)}</p> : null}
      {status.action ? <p className="mt-2">{status.action}</p> : null}
      {hour ? <p className="mt-3">This hour {hour.replace("/", " / ")} profile inspections</p> : null}
      <p className="mt-3">This run {sessionInspections} / {sessionCap.toLocaleString()} profiles inspected</p>
      <p>Today {dailyInspections} / {dailyInspectionCap} inspections</p>
      <p>{dailyAi} / {dailyAiCap} AI qualifications</p>
    </section>
  );
}
