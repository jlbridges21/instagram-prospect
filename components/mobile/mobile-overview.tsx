"use client";

import { useEffect, useState, useTransition } from "react";
import { Pause, Radar, Send } from "lucide-react";
import { toast } from "sonner";
import { LiveCountdown } from "@/components/ui/live-countdown";
import { StartDiscoveryButton } from "@/components/worker/start-discovery-button";
import { StartOutreachButton } from "@/components/worker/start-outreach-button";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";
import { formatCurrentAction, formatDiscoveryStatus, formatOutreachStatus, attentionKind, isStateSyncFailure } from "@/lib/status/operations";
import { subscribeDashboardStatus, type DashboardStatus } from "@/components/worker/status-poll";
import { cn } from "@/lib/utils/cn";

const largeButton = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold disabled:opacity-50";

export function MobileOverview({
  discovery,
  discoveryDetail,
  reviewCount,
  outreach,
  outreachDetail,
  workerOnline,
  workerDetail,
  queueCount,
  contactedCount,
  inspectedCount,
  inspectedLabel,
  currentTask,
  currentUsername,
  nextOutreachAt,
  hourlyResumesAt,
  browserState,
  discoveryEnabled,
  outreachEnabled,
  reviewTarget,
}: {
  discovery: string;
  discoveryDetail: string;
  reviewCount: number;
  outreach: string;
  outreachDetail: string;
  workerOnline: boolean;
  workerDetail: string;
  queueCount: number;
  contactedCount: number;
  inspectedCount: number;
  inspectedLabel: string;
  currentTask: string | null;
  currentUsername: string | null;
  nextOutreachAt: string | null;
  hourlyResumesAt: string | null;
  browserState: string;
  discoveryEnabled: boolean;
  outreachEnabled: boolean;
  reviewTarget: number | "unlimited";
}) {
  const [live, setLive] = useState<DashboardStatus | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => subscribeDashboardStatus(setLive), []);

  const online = live ? live.online : workerOnline;
  const discoveryOn = live ? live.discoveryEnabled : discoveryEnabled;
  const outreachOn = live ? live.outreachEnabled : outreachEnabled;
  const review = live?.reviewCount ?? reviewCount;
  const queued = live?.queueCount ?? queueCount;
  const contacted = live?.contactedCount ?? contactedCount;
  const task = live?.currentAction ?? currentTask;
  const username = live?.username ?? currentUsername;
  const browser = live?.browser?.state ?? browserState;
  const hourlyAt = live?.hourly?.resumesAt ?? hourlyResumesAt;
  const paceAt = live?.paceAt ?? nextOutreachAt;
  const inspected = live?.hourly?.count ?? inspectedCount;
  const attention = attentionKind(task, live?.attentionReason);
  const discoveryState = live
    ? formatDiscoveryStatus({
        online,
        enabled: discoveryOn,
        stopReason: live.stopReason,
        hourly: live.hourly,
        attention,
        attentionText: live.attentionReason,
        reviewCount: review,
        reviewTarget: live.reviewTarget,
        browser: live.browser?.state ?? "connected",
        yieldingToOutreach: discoveryOn && !live.hourly && task?.startsWith("executing_") === true,
      })
    : null;
  const outreachState = live
    ? formatOutreachStatus({
        online,
        enabled: outreachOn,
        queueCount: queued,
        pacingWait: outreachOn && live.paceAt && live.paceReason ? { reason: live.paceReason, nextAt: live.paceAt } : null,
        acting: task?.startsWith("executing_") === true,
        attention,
        browser: live.browser?.state ?? "connected",
        stateSync: isStateSyncFailure(live.attentionReason) ? { username } : null,
      })
    : null;
  const discoveryLabel = discoveryState?.actual ?? discovery;
  const outreachLabel = outreachState?.actual ?? outreach;
  const action = primaryAction({ task, username, browser, discoveryOn, outreachOn, hourlyAt, paceAt });

  function pauseDiscovery() {
    startTransition(async () => {
      const result = await requestWorkerCommand("pause_discovery", {});
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Pausing Discovery.");
    });
  }

  function pauseOutreach() {
    startTransition(async () => {
      const result = await requestWorkerCommand("pause_outreach", {});
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Pausing Outreach.");
    });
  }

  return (
    <div className="space-y-5 md:hidden">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Control Center</h1>
        <p className="mt-1 text-sm text-slate-400">Monitor and manage your Instagram prospecting.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatusTile href="/discovery" label="Discovery" value={discoveryLabel} detail={discoveryState?.reason ?? discoveryDetail} tone={toneFor(discoveryLabel)} />
        <StatusTile href="/prospects" label="Review" value={`${review} waiting`} detail="For a decision" tone={review > 0 ? "waiting" : "healthy"} />
        <StatusTile href="/outreach" label="Outreach" value={outreachLabel} detail={outreachState?.reason ?? outreachDetail} tone={toneFor(outreachLabel)} />
        <StatusTile href="/worker" label="Worker" value={online ? "CONNECTED" : "OFFLINE"} detail={online ? workerDetail : "Start the Windows worker"} tone={online ? "healthy" : "alert"} />
      </div>
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-500/20 via-[#12182b] to-[#0b1020] p-4 shadow-[0_0_40px_rgba(99,102,241,0.12)]">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-indigo-200">{action.kicker}</p>
          {action.live ? <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[11px] font-medium text-emerald-300">Live</span> : null}
        </div>
        <p className="mt-3 text-[28px] font-semibold leading-tight text-slate-50">{action.title}</p>
        <p className="mt-1 text-sm text-slate-300">{action.detail}</p>
      </section>
      <div className="grid gap-3">
        {discoveryOn ? (
          <button type="button" className={cn(largeButton, "border border-white/15 bg-white/5 text-slate-100")} disabled={!online || pending} onClick={pauseDiscovery}>
            <Pause className="h-4 w-4" aria-hidden /> Pause Discovery
          </button>
        ) : (
          <StartDiscoveryButton
            disabled={!online || pending}
            reviewCount={review}
            className={cn(largeButton, "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_8px_24px_rgba(99,102,241,0.35)]")}
          />
        )}
        {outreachOn ? (
          <button type="button" className={cn(largeButton, "border border-white/15 bg-white/5 text-slate-100")} disabled={!online || pending} onClick={pauseOutreach}>
            <Pause className="h-4 w-4" aria-hidden /> Pause Outreach
          </button>
        ) : (
          <StartOutreachButton
            disabled={!online || pending}
            ready={queued}
            className={cn(largeButton, "border border-white/15 bg-white/5 text-slate-100")}
          />
        )}
      </div>
      <p className="text-center text-[11px] text-slate-500">Review target {reviewTarget === "unlimited" ? "unlimited" : reviewTarget}</p>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Queued Prospects" value={queued} icon={<Send className="h-3.5 w-3.5" />} />
        <Metric label="Contacted" value={contacted} />
        <Metric label="Review Waiting" value={review} />
        <Metric label={inspectedLabel} value={inspected} icon={<Radar className="h-3.5 w-3.5" />} />
      </div>
      <WorkerStrip online={online} browser={browser} discovery={discoveryLabel} outreach={outreachLabel} current={formatCurrentAction(task, username)} />
    </div>
  );
}

function primaryAction(input: {
  task: string | null;
  username: string | null;
  browser: string;
  discoveryOn: boolean;
  outreachOn: boolean;
  hourlyAt: string | null;
  paceAt: string | null;
}) {
  const name = input.username ? `@${input.username.replace(/^@/, "")}` : null;
  if (input.browser === "restarting" || input.browser === "closed" || input.browser === "failed") {
    return { kicker: "Current action", title: "Worker recovering browser", detail: "Automation waits until the browser is available.", live: true };
  }
  if (input.task?.startsWith("executing_send")) {
    return { kicker: "Current action", title: name ? `Sending to ${name}` : "Sending a message", detail: "Outreach is working through the queue.", live: true };
  }
  if (input.task === "inspecting_profiles" || input.task === "qualifying_profiles" || input.task === "discovering_candidates") {
    return { kicker: "Current action", title: name ? `Discovery inspecting ${name}` : "Discovery inspecting", detail: formatCurrentAction(input.task, input.username), live: true };
  }
  if (input.hourlyAt && input.discoveryOn) {
    return { kicker: "Next inspection", title: <LiveCountdown targetAt={input.hourlyAt} />, detail: "Hourly discovery pace.", live: false };
  }
  if (input.paceAt && input.outreachOn) {
    return { kicker: "Next outreach", title: <LiveCountdown targetAt={input.paceAt} />, detail: "Minimum spacing between sends.", live: false };
  }
  return {
    kicker: "Current action",
    title: "Standby",
    detail: input.discoveryOn || input.outreachOn ? "Waiting for the next eligible action." : "Discovery and Outreach are paused.",
    live: false,
  };
}

function toneFor(value: string) {
  if (value === "RUNNING" || value === "READY" || value === "CONNECTED") return "healthy" as const;
  if (value === "WAITING" || value === "PAUSED" || value === "IDLE") return "waiting" as const;
  return "alert" as const;
}

function StatusTile({ href, label, value, detail, tone }: { href: string; label: string; value: string; detail: string; tone: "healthy" | "waiting" | "alert" }) {
  const color = tone === "healthy" ? "text-emerald-300" : tone === "waiting" ? "text-amber-300" : "text-red-300";
  return (
    <a href={href} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
      <p className="text-[11px] font-medium tracking-wide text-slate-400">{label}</p>
      <p className={cn("mt-2 truncate text-[15px] font-semibold", color)}>{value}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{detail}</p>
    </a>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <p className="flex items-center gap-1 text-[11px] text-slate-400">{icon}{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-50">{value}</p>
    </div>
  );
}

export function WorkerStrip({
  online,
  browser,
  discovery,
  outreach,
  current,
}: {
  online: boolean;
  browser: string;
  discovery: string;
  outreach: string;
  current: string;
}) {
  const browserLabel = browser === "connected" ? "Connected" : browser === "restarting" ? "Recovering" : browser === "failed" ? "Failed" : "Closed";
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-[15px] font-semibold text-slate-50">{online ? "Worker Connected" : "Worker Offline"}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini label="Browser" value={browserLabel} />
        <Mini label="Discovery" value={discovery} />
        <Mini label="Outreach" value={outreach} />
      </div>
      <p className="mt-3 text-xs text-slate-400">Current: <span className="text-slate-200">{current}</span></p>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/20 px-2 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-slate-100">{value}</p>
    </div>
  );
}
