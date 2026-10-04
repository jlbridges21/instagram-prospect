export type OperationTone = "running" | "ready" | "waiting" | "blocked" | "stopped" | "offline";

export type OperationState = {
  desired: "RUNNING" | "PAUSED" | "STOPPED";
  actual: "RUNNING" | "WAITING" | "PAUSED" | "STOPPED" | "BLOCKED" | "IDLE" | "OFFLINE" | "READY";
  tone: OperationTone;
  label: string;
  reason: string;
  detail: string | null;
  resumesAt: string | null;
  action: string | null;
};

export type AttentionKind = "checkpoint" | "logged_out" | "other" | null;

const FIT_TEXT: Record<string, string> = {
  strong_fit: "Strong Fit",
  possible_fit: "Possible Fit",
  weak_fit: "Weak Fit",
  skip: "Skip",
  not_relevant: "Not relevant",
};

export function attentionKind(task: string | null | undefined, reason: string | null | undefined): AttentionKind {
  const text = `${task ?? ""} ${reason ?? ""}`;
  if (!text.trim()) return null;
  if (/browser_closed|browser_failed|browser_restarting|outreach_recovery_required/i.test(text)) return null;
  if (/login|logged out|sign in/i.test(text)) return "logged_out";
  if (/checkpoint|challenge/i.test(text)) return "checkpoint";
  if (task === "attention_required" || task === "auth_required" || reason) return "other";
  return null;
}

export function formatDiscoveryStatus(input: {
  online: boolean;
  enabled: boolean;
  stopReason: string | null;
  hourly: { count: number; limit: number; resumesAt: string } | null;
  attention: AttentionKind;
  attentionText?: string | null;
  reviewCount: number;
  reviewTarget: number | "unlimited";
  browser?: "connected" | "restarting" | "closed" | "failed" | null;
  yieldingToOutreach?: boolean;
}): OperationState {
  const review = input.reviewTarget === "unlimited" ? `${input.reviewCount} / Unlimited` : `${input.reviewCount} / ${input.reviewTarget}`;
  const desired: OperationState["desired"] = input.enabled
    ? "RUNNING"
    : input.stopReason && input.stopReason !== "manual_pause"
      ? "STOPPED"
      : "PAUSED";

  if (!input.online) {
    return {
      desired,
      actual: "OFFLINE",
      tone: "offline",
      label: "OFFLINE — Worker disconnected",
      reason: "Worker disconnected",
      detail: "Discovery cannot inspect profiles until the Windows worker reconnects.",
      resumesAt: null,
      action: "Start the Windows worker.",
    };
  }
  if (input.browser === "closed" || input.browser === "failed") {
    const failed = input.browser === "failed";
    return {
      desired,
      actual: "BLOCKED",
      tone: "blocked",
      label: failed ? "BLOCKED — Browser recovery failed" : "BLOCKED — Browser closed",
      reason: failed ? "Browser recovery failed" : "Automation browser was closed.",
      detail: "No profile inspection, Follow, or DM will run until the automation browser is available.",
      resumesAt: null,
      action: "Restart the automation browser, or restart the Windows worker.",
    };
  }
  if (input.browser === "restarting") {
    return {
      desired,
      actual: input.enabled ? "WAITING" : "PAUSED",
      tone: "waiting",
      label: "WAITING — Waiting for the browser",
      reason: "Waiting for the browser",
      detail: "The automation browser is restarting. No Follow or DM is performed.",
      resumesAt: null,
      action: null,
    };
  }
  if (input.attention === "checkpoint" || input.attention === "logged_out" || input.attention === "other") {
    const reason = input.attention === "logged_out"
      ? "Instagram logged out"
      : input.attention === "checkpoint"
        ? "Instagram checkpoint"
        : input.attentionText || "Instagram needs attention";
    return {
      desired,
      actual: "BLOCKED",
      tone: "blocked",
      label: `BLOCKED — ${reason}`,
      reason,
      detail: "Automation is paused locally. No profile inspection, Follow, or DM runs until this is resolved in the Windows Chrome window.",
      resumesAt: null,
      action: input.attention === "logged_out"
        ? "Sign in to Instagram in the Windows Chrome window."
        : "Resolve it in the Windows Chrome window.",
    };
  }
  if (input.enabled && input.hourly) {
    return {
      desired: "RUNNING",
      actual: "WAITING",
      tone: "waiting",
      label: "WAITING — Hourly inspection limit reached",
      reason: "Hourly inspection limit reached",
      detail: `${input.hourly.count} / ${input.hourly.limit} profiles inspected in the rolling hour. Review is ${review}.`,
      resumesAt: input.hourly.resumesAt,
      action: null,
    };
  }
  if (input.enabled) {
    return {
      desired: "RUNNING",
      actual: "RUNNING",
      tone: "running",
      label: "RUNNING",
      reason: input.yieldingToOutreach ? "Temporarily yielding to Outreach" : "Discovery is looking for qualified prospects.",
      detail: input.yieldingToOutreach ? `Worker currently servicing Outreach. Review ${review}.` : `Review ${review}.`,
      resumesAt: null,
      action: null,
    };
  }
  return stoppedDiscovery(input.stopReason, review);
}

function stoppedDiscovery(stopReason: string | null, review: string): OperationState {
  const reasons: Record<string, { actual: "PAUSED" | "STOPPED"; reason: string; action: string | null }> = {
    manual_pause: { actual: "PAUSED", reason: "You paused Discovery", action: "Resume Discovery to continue this run." },
    review_target_reached: { actual: "STOPPED", reason: "Review target reached", action: "No action is required. Start Discovery again when you want more prospects." },
    daily_inspection_cap: { actual: "STOPPED", reason: "Daily inspection limit reached", action: "Discovery can start again after the daily window resets." },
    daily_ai_cap: { actual: "STOPPED", reason: "Daily AI limit reached", action: "Discovery can start again after the daily window resets." },
    inspection_session_cap: { actual: "STOPPED", reason: "Session inspection limit reached", action: "Start Discovery again to open a new run." },
    candidate_dry_spell: { actual: "STOPPED", reason: "No new candidates found", action: "Start Discovery again when you want another search." },
    instagram_checkpoint: { actual: "STOPPED", reason: "Instagram checkpoint", action: "Resolve the checkpoint in the Windows Chrome window." },
    error: { actual: "STOPPED", reason: "Discovery stopped because of an error", action: "Open Worker for the last error, then start Discovery again." },
    worker_stopped: { actual: "STOPPED", reason: "The worker stopped this run", action: "Start Discovery again when the worker is connected." },
  };
  const match = stopReason ? reasons[stopReason] : null;
  const actual = match?.actual ?? "PAUSED";
  const reason = match?.reason ?? "Discovery is not running";
  return {
    desired: actual === "PAUSED" ? "PAUSED" : "STOPPED",
    actual,
    tone: actual === "PAUSED" ? "waiting" : "stopped",
    label: `${actual} — ${reason}`,
    reason,
    detail: `Review ${review}.`,
    resumesAt: null,
    action: match?.action ?? "Start Discovery when you want a new run.",
  };
}

export function formatOutreachStatus(input: {
  online: boolean;
  enabled: boolean;
  queueCount: number;
  attention: AttentionKind;
  /** A real pacing wait, such as minimum spacing or the next scheduled step. Not a time-of-day window. */
  pacingWait?: { reason: string; nextAt: string | null } | null;
  acting?: boolean;
  browser?: "connected" | "restarting" | "closed" | "failed" | null;
}): OperationState {
  const desired: OperationState["desired"] = input.enabled ? "RUNNING" : "PAUSED";
  if (input.online && (input.browser === "closed" || input.browser === "failed" || input.browser === "restarting")) {
    return {
      desired,
      actual: input.enabled ? "BLOCKED" : "PAUSED",
      tone: input.enabled ? "blocked" : "waiting",
      label: input.enabled ? "BLOCKED — Browser unavailable" : "PAUSED — You paused Outreach",
      reason: input.enabled ? "Automation browser was closed." : "You paused Outreach",
      detail: input.enabled ? "No Follow or DM will run until the browser is available." : "The queue is kept.",
      resumesAt: null,
      action: input.enabled ? "Restart the automation browser, or restart the Windows worker." : null,
    };
  }
  if (!input.online) {
    return {
      desired,
      actual: "OFFLINE",
      tone: "offline",
      label: "OFFLINE — Worker disconnected",
      reason: "Worker disconnected",
      detail: "Outreach cannot run until the Windows worker reconnects.",
      resumesAt: null,
      action: "Start the Windows worker.",
    };
  }
  if (input.attention) {
    return {
      desired,
      actual: "BLOCKED",
      tone: "blocked",
      label: "BLOCKED — Instagram needs attention",
      reason: "Instagram needs attention",
      detail: "No Follow or DM runs until the browser checkpoint is resolved.",
      resumesAt: null,
      action: "Resolve it in the Windows Chrome window.",
    };
  }
  if (input.enabled && input.pacingWait && !input.acting) {
    return {
      desired: "RUNNING",
      actual: "WAITING",
      tone: "waiting",
      label: `WAITING — ${input.pacingWait.reason}`,
      reason: input.pacingWait.reason,
      detail: "Hourly, daily, and spacing limits still apply. Outreach is not limited to a time of day.",
      resumesAt: input.pacingWait.nextAt,
      action: null,
    };
  }
  if (input.enabled && input.queueCount === 0) {
    return {
      desired: "RUNNING",
      actual: "IDLE",
      tone: "ready",
      label: "IDLE — Outreach queue empty",
      reason: "Outreach queue empty",
      detail: "The worker stays connected. Approve prospects from Review to add them.",
      resumesAt: null,
      action: null,
    };
  }
  if (input.enabled) {
    return {
      desired: "RUNNING",
      actual: "RUNNING",
      tone: "running",
      label: "RUNNING",
      reason: "Outreach is working through the approved queue.",
      detail: `${input.queueCount} remaining.`,
      resumesAt: null,
      action: null,
    };
  }
  return {
    desired: "PAUSED",
    actual: "PAUSED",
    tone: "waiting",
    label: "PAUSED — You paused Outreach",
    reason: "You paused Outreach",
    detail: "The queue is kept. Pause does not cancel pending outreach.",
    resumesAt: null,
    action: "Start Outreach when you want to continue.",
  };
}

export function formatWorkerStatus(input: { online: boolean; attention: AttentionKind; attentionText?: string | null }): OperationState {
  if (!input.online) {
    return {
      desired: "PAUSED",
      actual: "OFFLINE",
      tone: "offline",
      label: "OFFLINE",
      reason: "Worker disconnected",
      detail: "Start the Windows worker with npm run agent.",
      resumesAt: null,
      action: "Start the Windows worker.",
    };
  }
  if (input.attention) {
    const reason = input.attention === "logged_out"
      ? "Instagram logged out"
      : input.attention === "checkpoint"
        ? "Instagram checkpoint"
        : input.attentionText || "Instagram needs attention";
    return {
      desired: "RUNNING",
      actual: "BLOCKED",
      tone: "blocked",
      label: "BLOCKED",
      reason,
      detail: "Automation is paused locally until you resolve it in the Windows Chrome window.",
      resumesAt: null,
      action: "Resolve it in the Windows Chrome window.",
    };
  }
  return {
    desired: "RUNNING",
    actual: "READY",
    tone: "ready",
    label: "Connected",
    reason: "Worker connected",
    detail: null,
    resumesAt: null,
    action: null,
  };
}

export function outreachOwnsWorker(task: string | null | undefined) {
  return task === "executing_verify_profile" || task === "executing_follow_profile" || task === "executing_send_message" || task === "outreach_spacing_wait";
}

export function formatOutreachAction(input: {
  task: string | null | undefined;
  username: string | null | undefined;
  waiting: { reason: string; eligibleIn: string } | null;
}) {
  if (input.task === "executing_verify_profile" || input.task === "executing_follow_profile" || input.task === "executing_send_message") {
    return formatCurrentAction(input.task, input.username);
  }
  if (input.waiting) return `${input.waiting.reason}. Eligible in ${input.waiting.eligibleIn}`;
  return "Queue empty";
}

export function formatCurrentAction(task: string | null | undefined, username: string | null | undefined, hourlyWaiting = false) {
  if ((hourlyWaiting || task === "discovery_hourly_wait") && !task?.startsWith("executing_") && task !== "outreach_spacing_wait") {
    return "Waiting for the hourly Discovery slot";
  }
  const who = username?.replace(/^@/, "");
  const name = who ? `@${who}` : null;
  switch (task) {
    case "inspecting_profiles":
      return name ? `Inspecting ${name}` : "Inspecting a profile";
    case "qualifying_profiles":
      return name ? `AI qualifying ${name}` : "AI qualifying a profile";
    case "discovering_candidates":
      return "Looking for profiles";
    case "executing_verify_profile":
      return name ? `Verifying ${name}` : "Verifying a profile";
    case "executing_follow_profile":
      return name ? `Following ${name}` : "Following a profile";
    case "executing_send_message":
      return name ? `Sending message to ${name}` : "Sending a message";
    case "attention_required":
      return "Instagram needs attention";
    case "auth_required":
      return "Instagram needs a sign-in";
    case "command_running":
      return "Running a dashboard action";
    case "outreach_spacing_wait":
      return "Waiting for the next Outreach action";
    case "paused":
    case "idle":
    case "standby":
    case "offline":
    case null:
    case undefined:
    case "":
      return "Standby";
    default:
      return name ? `Working on ${name}` : "Working";
  }
}

export function widgetHeadline(input: {
  online: boolean;
  attention: AttentionKind;
  action: string;
  discoveryActual: OperationState["actual"];
}) {
  if (!input.online) return "Worker · Offline";
  if (input.attention) return "Worker · Attention required";
  if (input.action !== "Standby") return `Worker · ${input.action}`;
  if (input.discoveryActual === "WAITING") return "Worker · Discovery waiting";
  if (input.discoveryActual === "RUNNING") return "Worker · Discovery running";
  return "Worker · Ready";
}

export function prospectWhy(input: {
  status: string;
  fitLabel: string | null;
  fitScore: number | null;
  reason: string | null;
  alreadyFollowing?: boolean;
}) {
  const fitName = input.fitLabel ? FIT_TEXT[input.fitLabel] ?? input.fitLabel : null;
  const fit = fitName && input.fitScore != null ? `${fitName} — ${input.fitScore}/100` : fitName;
  const reason = input.reason?.trim() || null;
  if (input.status === "review" || input.status === "qualified") {
    return {
      headline: fit ? `Included because: ${fit}` : "Included for review",
      detail: reason || "Qualified and waiting for your decision.",
    };
  }
  if (input.alreadyFollowing) {
    return { headline: "Excluded because: Already following", detail: reason || "This profile was not sent to outreach." };
  }
  if (input.status === "disqualified" || input.status === "skipped") {
    return {
      headline: fit ? `Excluded because: ${fit}` : "Excluded because: Did not qualify",
      detail: reason || "This profile was evaluated and did not qualify.",
    };
  }
  if (input.status === "approved") {
    return { headline: "Approved for outreach", detail: reason || "Waiting to be processed." };
  }
  if (["contacted", "replied", "follow_up", "demo_booked", "converted"].includes(input.status)) {
    return { headline: "Outreach completed", detail: reason || "A message was sent." };
  }
  return { headline: "In the workspace", detail: reason || "No qualification note is stored." };
}

export function recommendedDiagnostic(codeOrText: string | null | undefined) {
  const text = (codeOrText ?? "").toLowerCase();
  if (!text) return null;
  if (/composer|message draft|semantic/.test(text)) {
    return { label: "Test Message Composer", href: "/worker#diagnostics" };
  }
  if (/recipient|direct|dm_/.test(text)) {
    return { label: "Test Instagram DM Detection", href: "/worker#diagnostics" };
  }
  if (/follow/.test(text)) {
    return { label: "Recover Interrupted Outreach", href: "/worker#diagnostics" };
  }
  return null;
}

export function showInActivity(eventType: string, message: string) {
  return !/duplicate|cache/i.test(`${eventType} ${message}`);
}

export function versionGate(input: { reported: string | null; required: string }) {
  if (!input.reported || input.reported === input.required) {
    return { mismatch: false, message: null as string | null };
  }
  return {
    mismatch: true,
    message: `Worker update required. The Windows worker is running ${input.reported}. This dashboard expects ${input.required}.`,
  };
}

export function statusDotClass(tone: OperationTone) {
  if (tone === "running") return "bg-emerald-500";
  if (tone === "ready") return "bg-indigo-500";
  if (tone === "waiting") return "bg-amber-500";
  if (tone === "blocked") return "bg-red-500";
  return "bg-slate-400";
}
