import { discoveryProgressLabel, type DiscoveryStopReason, type ReviewTarget } from "@/lib/discovery/policy";

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
}) {
  const label = discoveryProgressLabel({
    running,
    currentReview,
    target,
    reason: (reason as DiscoveryStopReason | null) ?? null,
  });
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <pre className="whitespace-pre-wrap font-sans">{label}</pre>
      <p className="mt-3">This session {sessionInspections} / {sessionCap.toLocaleString()} profiles inspected</p>
      <p>Today {dailyInspections} / {dailyInspectionCap} inspections</p>
      <p>{dailyAi} / {dailyAiCap} AI qualifications</p>
      <p className="mt-2 text-slate-500">
        Discovery pauses when the review target or a discovery limit is reached. It stays paused until you start it again.
      </p>
    </section>
  );
}
