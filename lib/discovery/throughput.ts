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

export type DiscoveryMissReason = "candidate_starvation" | "outreach_browser" | "browser_recovery" | "waiting_for_slot" | "other";

export function discoveryMissReason(input: {
  outreachOwnsBrowser: boolean;
  browserRecovering: boolean;
  candidateStarved: boolean;
  waitingForSlot: boolean;
}): DiscoveryMissReason {
  if (input.outreachOwnsBrowser) return "outreach_browser";
  if (input.browserRecovering) return "browser_recovery";
  if (input.candidateStarved) return "candidate_starvation";
  if (input.waitingForSlot) return "waiting_for_slot";
  return "other";
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
  degradedReason?: DiscoveryMissReason;
  discoveryMisses?: Record<DiscoveryMissReason, number>;
  outreachBlocked?: {
    minimumSpacing: number;
    followVerificationUncertain: number;
    recipientVerification: number;
    browserUnavailable: number;
    retryBackoff: number;
  };
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
  if (input.discoveryMisses) {
    lines.push(`Discovery missed — candidate starvation: ${input.discoveryMisses.candidate_starvation}`);
    lines.push(`Discovery missed — Outreach browser: ${input.discoveryMisses.outreach_browser}`);
    lines.push(`Discovery missed — browser recovery: ${input.discoveryMisses.browser_recovery}`);
    lines.push(`Discovery missed — other: ${input.discoveryMisses.other}`);
  }
  if (input.outreachBlocked) {
    lines.push(`Outreach blocked — minimum spacing: ${input.outreachBlocked.minimumSpacing}`);
    lines.push(`Outreach blocked — follow verification uncertain: ${input.outreachBlocked.followVerificationUncertain}`);
    lines.push(`Outreach blocked — recipient verification: ${input.outreachBlocked.recipientVerification}`);
    lines.push(`Outreach blocked — browser unavailable: ${input.outreachBlocked.browserUnavailable}`);
    lines.push(`Outreach blocked — retry backoff: ${input.outreachBlocked.retryBackoff}`);
  }
  if (input.degraded) {
    lines.push(input.degradedReason === "outreach_browser"
      ? "Discovery waiting — Outreach owns the browser"
      : input.degradedReason === "browser_recovery"
        ? "Discovery waiting — browser recovery"
        : "Discovery degraded — candidate starvation");
  }
  return lines.join("\n");
}

export function createThroughputClock(now = Date.now()) {
  const spent = { waiting: 0, sourcing: 0, inspecting: 0 };
  const discoveryMisses: Record<DiscoveryMissReason, number> = {
    candidate_starvation: 0,
    outreach_browser: 0,
    browser_recovery: 0,
    waiting_for_slot: 0,
    other: 0,
  };
  const outreachBlocked = {
    minimumSpacing: 0,
    followVerificationUncertain: 0,
    recipientVerification: 0,
    browserUnavailable: 0,
    retryBackoff: 0,
  };
  let seenMissed = 0;
  let lastBlock: keyof typeof outreachBlocked | null = null;
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
    noteMissed(total: number, reason: DiscoveryMissReason) {
      const delta = Math.max(0, total - seenMissed);
      seenMissed = Math.max(seenMissed, total);
      if (reason === "waiting_for_slot") return;
      if (delta > 0) discoveryMisses[reason] += delta;
    },
    noteOutreachBlock(reason: keyof typeof outreachBlocked) {
      if (lastBlock === reason) return;
      lastBlock = reason;
      outreachBlocked[reason] += 1;
    },
    clearOutreachBlock() {
      lastBlock = null;
    },
    misses() {
      return { ...discoveryMisses };
    },
    blocks() {
      return { ...outreachBlocked };
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
