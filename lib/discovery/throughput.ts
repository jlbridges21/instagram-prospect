import { formatElapsed } from "./cadence";

export type ThroughputPhase = "waiting" | "sourcing" | "inspecting" | "idle";

export function missedInspectionOpportunities(now: number, nextInspectionAt: number, intervalMs: number) {
  if (intervalMs <= 0 || now <= nextInspectionAt) return 0;
  return Math.floor((now - nextInspectionAt) / intervalMs);
}

export function throughputDegraded(input: {
  running: boolean;
  inspectionsSinceProgress: number;
  overdueMs: number;
  intervalMs: number;
  missedThreshold?: number;
}) {
  if (!input.running || input.intervalMs <= 0) return false;
  const missed = Math.floor(Math.max(0, input.overdueMs) / input.intervalMs);
  const threshold = input.missedThreshold ?? 3;
  return input.inspectionsSinceProgress === 0 && missed >= threshold;
}

export function formatThroughputReport(input: {
  configuredPerHour: number;
  actualLast60Minutes: number;
  opportunities: number;
  missed: number;
  waitingMs: number;
  sourcingMs: number;
  inspectingMs: number;
  degraded: boolean;
}) {
  const lines = [
    `Configured: ${input.configuredPerHour}/hr`,
    `Actual: ${input.actualLast60Minutes}/hr`,
    `Opportunities: ${input.opportunities}`,
    `Missed: ${input.missed}`,
    `Candidate-starved: ${formatElapsed(input.waitingMs)}`,
    `Sourcing: ${formatElapsed(input.sourcingMs)}`,
    `Inspecting: ${formatElapsed(input.inspectingMs)}`,
  ];
  if (input.degraded) lines.push("Discovery degraded — candidate starvation");
  return lines.join("\n");
}

export function createThroughputClock(now = Date.now()) {
  const spent = { waiting: 0, sourcing: 0, inspecting: 0 };
  let phase: ThroughputPhase = "idle";
  let at = now;
  return {
    enter(next: ThroughputPhase, time = Date.now()) {
      if (phase === "waiting" || phase === "sourcing" || phase === "inspecting") {
        spent[phase] += Math.max(0, time - at);
      }
      phase = next;
      at = time;
    },
    spent(time = Date.now()) {
      const extra = phase === "waiting" || phase === "sourcing" || phase === "inspecting" ? Math.max(0, time - at) : 0;
      return {
        waitingMs: spent.waiting + (phase === "waiting" ? extra : 0),
        sourcingMs: spent.sourcing + (phase === "sourcing" ? extra : 0),
        inspectingMs: spent.inspecting + (phase === "inspecting" ? extra : 0),
      };
    },
  };
}
