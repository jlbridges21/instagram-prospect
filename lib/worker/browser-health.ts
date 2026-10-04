export type BrowserState = "connected" | "restarting" | "closed" | "failed";
export type SideEffect = "follow" | "send" | null;

export function browserStateFromSignals(input: { closed: boolean; restarting: boolean; failed: boolean }): BrowserState {
  if (input.restarting) return "restarting";
  if (input.failed) return "failed";
  if (input.closed) return "closed";
  return "connected";
}

export function contextUsable(input: { exists: boolean; closed: boolean; pagesReadable: boolean }) {
  return input.exists && !input.closed && input.pagesReadable;
}

export function isBrowserClosedMessage(message: string) {
  return /has been closed|Target closed|Target page, context or browser|browser has been closed|Failed to open a new tab/i.test(message);
}

export function pagesToOpen(existingOpenProfiles: number) {
  return Math.max(0, 2 - existingOpenProfiles);
}

export function tabBudget(input: { home: number; profiles: number; extra: number }) {
  return {
    total: input.home + input.profiles + input.extra,
    steady: input.home === 1 && input.profiles === 2 && input.extra === 0,
  };
}

export function recoveryDecision(input: {
  state: BrowserState;
  attempts: number;
  maxAttempts?: number;
  sideEffect: SideEffect;
}) {
  const max = input.maxAttempts ?? 3;
  if (input.state === "connected") return { action: "none" as const, log: null as string | null, reason: null as string | null };
  if (input.sideEffect) {
    return {
      action: "block" as const,
      log: "Browser closed during an uncertain Instagram action. Automatic recovery is paused.",
      reason: "outreach_recovery_required" as const,
    };
  }
  if (input.state === "failed" || input.attempts >= max) {
    return {
      action: "block" as const,
      log: "Browser recovery failed. Worker is blocked.",
      reason: "browser_failed" as const,
    };
  }
  return {
    action: "recover" as const,
    log: `Browser unavailable. Attempting safe recovery ${input.attempts + 1}/${max}...`,
    reason: "browser_closed" as const,
  };
}

export function restartBrowserAllowed(input: { online: boolean; state: BrowserState; sideEffect: SideEffect }) {
  if (!input.online) return { allowed: false as const, reason: "The worker is offline." };
  if (input.sideEffect) return { allowed: false as const, reason: "A Follow or DM may be unfinished. Use Recover Interrupted Outreach." };
  if (input.state !== "closed" && input.state !== "failed") {
    return { allowed: false as const, reason: "The automation browser is already connected." };
  }
  return { allowed: true as const, reason: null };
}

export function discoveryAdmission(input: {
  loopActive: boolean;
  pauseLatched: boolean;
  browser: BrowserState;
  desiredEnabled: boolean;
  sideEffect: SideEffect;
}) {
  if (input.sideEffect) return { enter: false as const, reason: "recovery" as const };
  if (input.browser !== "connected") return { enter: false as const, reason: "browser" as const };
  if (!input.desiredEnabled || input.pauseLatched) return { enter: false as const, reason: "paused" as const };
  if (input.loopActive) return { enter: false as const, reason: "already_running" as const };
  return { enter: true as const, reason: "start" as const };
}

export function startDiscoveryEffect(input: { loopActive: boolean }) {
  return { clearPauseLatch: true as const, startAnotherLoop: !input.loopActive };
}

export function executionStates(input: {
  browser: BrowserState;
  discoveryEnabled: boolean;
  outreachEnabled: boolean;
  sideEffect: SideEffect;
}) {
  const discoveryDesired = input.discoveryEnabled ? "running" as const : "paused" as const;
  const outreachDesired = input.outreachEnabled ? "running" as const : "paused" as const;
  if (input.browser === "restarting") {
    return {
      discoveryDesired,
      discoveryActual: input.discoveryEnabled ? "waiting" as const : "paused" as const,
      outreachDesired,
      outreachActual: input.outreachEnabled ? "blocked" as const : "paused" as const,
      reason: "browser_restarting",
    };
  }
  if (input.browser !== "connected") {
    return {
      discoveryDesired,
      discoveryActual: "blocked" as const,
      outreachDesired,
      outreachActual: input.outreachEnabled ? "blocked" as const : "paused" as const,
      reason: input.sideEffect ? "outreach_recovery_required" : input.browser === "failed" ? "browser_failed" : "browser_closed",
    };
  }
  return {
    discoveryDesired,
    discoveryActual: input.discoveryEnabled ? "running" as const : "paused" as const,
    outreachDesired,
    outreachActual: input.outreachEnabled ? "running" as const : "paused" as const,
    reason: null as string | null,
  };
}

export function formatBrowserHealthEvent(input: {
  state: BrowserState;
  discoveryDesired: string;
  discoveryActual: string;
  outreachDesired: string;
  outreachActual: string;
  reason: string | null;
}) {
  return `Browser health | state=${input.state} | discovery_desired=${input.discoveryDesired} | discovery_actual=${input.discoveryActual} | outreach_desired=${input.outreachDesired} | outreach_actual=${input.outreachActual} | reason=${input.reason ?? "none"}`;
}

export function parseBrowserHealthEvent(value: string | null | undefined) {
  if (!value?.startsWith("Browser health |")) return null;
  const read = (key: string) => {
    const match = value.match(new RegExp(`${key}=([^|]+)`));
    return match?.[1]?.trim() ?? null;
  };
  const state = read("state");
  if (state !== "connected" && state !== "restarting" && state !== "closed" && state !== "failed") return null;
  const browserState: BrowserState = state;
  return {
    state: browserState,
    discoveryDesired: read("discovery_desired"),
    discoveryActual: read("discovery_actual"),
    outreachDesired: read("outreach_desired"),
    outreachActual: read("outreach_actual"),
    reason: read("reason"),
  };
}

export function shouldLogBrowserFailure(previous: string | null, next: string) {
  return previous !== next;
}
