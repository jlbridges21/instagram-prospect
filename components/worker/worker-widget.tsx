"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { saveDiscoveryPreferences } from "@/lib/actions/discovery";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";
import { livePollDelay } from "@/lib/discovery/policy";
import { formatResumeClock } from "@/lib/discovery/pacing";
import {
  attentionKind,
  formatCurrentAction,
  formatDiscoveryStatus,
  formatOutreachStatus,
  recommendedDiagnostic,
  statusDotClass,
  versionGate,
  widgetHeadline,
} from "@/lib/status/operations";
import { StartDiscoveryButton } from "@/components/worker/start-discovery-button";
import { StartOutreachButton } from "@/components/worker/start-outreach-button";

type Status = {
  online: boolean;
  machineName: string | null;
  lastHeartbeatAt: string | null;
  discoveryEnabled: boolean;
  outreachEnabled: boolean;
  username: string | null;
  currentAction: string | null;
  reviewCount: number;
  reviewTarget: number | "unlimited";
  hourlyLimit: number;
  hourly: { count: number; limit: number; resumesAt: string } | null;
  stopReason: string | null;
  queueCount: number;
  nextEligibleAt?: string | null;
  hourlyMaximum?: number;
  dailyMaximum?: number;
  minimumSpacingSeconds?: number;
  attentionReason: string | null;
  browser?: { state: "connected" | "restarting" | "closed" | "failed"; reason: string | null } | null;
  reportedVersion: string | null;
  requiredVersion: string;
  command?: { error_code?: string | null; error_message?: string | null; status?: string } | null;
};

const STORAGE_KEY = "shootportal-worker-widget";
const WIDGET_EVENT = "shootportal-worker-widget";

function subscribeWidget(onChange: () => void) {
  window.addEventListener(WIDGET_EVENT, onChange);
  return () => window.removeEventListener(WIDGET_EVENT, onChange);
}

export function widgetIsCollapsed(stored: string | null) {
  return stored === "collapsed";
}

function widgetCollapsed() {
  return widgetIsCollapsed(window.localStorage.getItem(STORAGE_KEY));
}

export function WorkerWidget({ timeZone }: { timeZone: string }) {
  const collapsed = useSyncExternalStore(subscribeWidget, widgetCollapsed, () => false);
  const open = !collapsed;
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState("20");
  const [pace, setPace] = useState("30");
  const seeded = useRef(false);

  useEffect(() => {
    let previous = "";
    let timer = 0;
    let stopped = false;
    async function tick() {
      if (stopped) return;
      const visible = document.visibilityState === "visible";
      try {
        if (visible) {
          const response = await fetch("/api/dashboard/worker-status", { cache: "no-store" });
          if (response.ok) {
            const body = (await response.json()) as Status;
            setStatus(body);
            if (!seeded.current) {
              seeded.current = true;
              setTarget(String(body.reviewTarget === "unlimited" ? 20 : body.reviewTarget));
              setPace(String(body.hourlyLimit || 30));
            }
            const key = `${body.online}|${body.discoveryEnabled}|${body.outreachEnabled}|${body.attentionReason ?? ""}|${body.currentAction ?? ""}`;
            if (previous && previous !== key) toast(body.attentionReason || "Worker status changed");
            previous = key;
          }
        }
      } catch {
        // The next poll retries.
      }
      timer = window.setTimeout(tick, livePollDelay(visible));
    }
    timer = window.setTimeout(tick, 1000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  function collapse(next: boolean) {
    window.localStorage.setItem(STORAGE_KEY, next ? "open" : "collapsed");
    window.dispatchEvent(new Event(WIDGET_EVENT));
  }

  const attention = attentionKind(status?.currentAction, status?.attentionReason);
  const versions = versionGate({ reported: status?.reportedVersion ?? null, required: status?.requiredVersion ?? "6" });
  const enabled = Boolean(status?.online) && !versions.mismatch;
  const discovery = formatDiscoveryStatus({
    online: Boolean(status?.online),
    enabled: Boolean(status?.discoveryEnabled),
    stopReason: status?.stopReason ?? null,
    hourly: status?.hourly ?? null,
    attention,
    attentionText: status?.attentionReason,
    reviewCount: status?.reviewCount ?? 0,
    reviewTarget: status?.reviewTarget ?? "unlimited",
    browser: status?.browser?.state ?? "connected",
  });
  const outreach = formatOutreachStatus({
    online: Boolean(status?.online),
    enabled: Boolean(status?.outreachEnabled),
    queueCount: status?.queueCount ?? 0,
    pacingWait:
      status?.outreachEnabled && status.nextEligibleAt
        ? { reason: "Waiting for the next scheduled action", nextAt: status.nextEligibleAt }
        : null,
    acting: status?.currentAction?.startsWith("executing_") === true,
    attention,
    browser: status?.browser?.state ?? "connected",
  });
  const action = formatCurrentAction(status?.currentAction, status?.username, Boolean(status?.hourly) && Boolean(status?.discoveryEnabled));
  const headline = widgetHeadline({ online: Boolean(status?.online), attention, action, discoveryActual: discovery.actual });
  const recommendation = recommendedDiagnostic(status?.command?.error_code || status?.command?.error_message);
  const zone = timeZone || "UTC";

  async function send(type: "pause_discovery" | "stop_discovery" | "pause_outreach") {
    setPending(true);
    const result = await requestWorkerCommand(type, {});
    setPending(false);
    if (!result.ok) toast.error(result.error);
    else toast.success(result.message ?? "Sent.");
  }

  async function savePace() {
    setPending(true);
    const result = await saveDiscoveryPreferences({
      reviewTarget: Number.parseInt(target, 10),
      hourlyPace: Number.parseInt(pace, 10),
    });
    setPending(false);
    if (!result.ok) toast.error(result.error);
    else toast.success(result.message ?? "Saved.");
  }

  return (
    <>
      {attention || versions.mismatch ? (
        <div className="fixed inset-x-0 top-14 z-30 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900 lg:left-64" role="status">
          <p className="font-semibold">{versions.mismatch ? "Worker update required" : "Instagram needs attention"}</p>
          <p>{versions.mismatch ? versions.message : discovery.reason}</p>
          <p>{versions.mismatch ? "Worker actions stay disabled until the Windows worker is updated." : discovery.detail}</p>
        </div>
      ) : null}
      <section className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-1.5rem))]" aria-label="Worker control">
        {open ? (
          <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-lg">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-900">Worker</p>
              <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status?.online ? (attention ? "blocked" : "running") : "offline")}`} aria-hidden />
            </div>
            <p className="mt-1 text-slate-800">{status?.online ? "Connected" : "OFFLINE"}</p>
            <p className="text-xs text-slate-600">Browser {status?.browser?.state === "closed" ? "CLOSED" : status?.browser?.state === "failed" ? "FAILED" : status?.browser?.state === "restarting" ? "RESTARTING" : "Connected"}</p>
            <p className="mt-1 text-xs text-slate-500">{status?.machineName ?? "Windows worker"} · {heartbeatLabel(status?.lastHeartbeatAt ?? null)}</p>
            {!status?.online ? <p className="mt-2 text-xs text-slate-600">Start the Windows worker to use this action.</p> : null}
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-500">Discovery</p>
                <p className="font-medium text-slate-900">{discovery.actual}</p>
                <p className="text-slate-600">Desired: {discovery.desired}</p>
                <p>{discovery.reason}</p>
              </div>
              <div>
                <p className="text-slate-500">Outreach</p>
                <p className="font-medium text-slate-900">{outreach.actual}</p>
                <p className="text-slate-600">Desired: {outreach.desired}</p>
                <p>{outreach.reason}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">Current action</p>
            <p>{action}</p>
            {discovery.resumesAt ? <p className="text-xs text-slate-600">Resumes {formatResumeClock(discovery.resumesAt, zone)}</p> : null}
            {outreach.resumesAt ? <p className="text-xs text-slate-600">Next eligible action {formatResumeClock(outreach.resumesAt, zone)}</p> : null}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <label>Review target
                <input aria-label="Review target" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1" value={target} onChange={(event) => setTarget(event.target.value)} />
              </label>
              <label>Hourly inspection pace
                <input aria-label="Hourly inspection pace" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1" value={pace} onChange={(event) => setPace(event.target.value)} />
              </label>
            </div>
            <button type="button" className="mt-2 text-xs text-indigo-700" disabled={pending} onClick={savePace}>Save pace and target</button>
            <div className="mt-3 flex flex-wrap gap-2">
              {status?.discoveryEnabled ? (
                <>
                  <button type="button" title="Temporarily pauses this Discovery run. Progress stays available to resume." className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50" disabled={!enabled || pending} onClick={() => send("pause_discovery")}>Pause Discovery</button>
                  <button type="button" title="Ends the current Discovery run. Starting again creates a new run." className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50" disabled={!enabled || pending} onClick={() => send("stop_discovery")}>Stop Discovery</button>
                </>
              ) : (
                <StartDiscoveryButton disabled={!enabled || pending} reviewCount={status?.reviewCount ?? 0} />
              )}
              {status?.outreachEnabled ? (
                <button type="button" title="Stops new outreach claims and keeps the queue." className="rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:opacity-50" disabled={!enabled || pending} onClick={() => send("pause_outreach")}>Pause Outreach</button>
              ) : (
                <StartOutreachButton
                  disabled={!enabled || pending}
                  ready={status?.queueCount ?? 0}
                  hourlyMaximum={status?.hourlyMaximum}
                  dailyMaximum={status?.dailyMaximum}
                  minimumSpacingSeconds={status?.minimumSpacingSeconds}
                />
              )}
            </div>
            {status?.online && (status.browser?.state === "closed" || status.browser?.state === "failed") ? (
              <RestartBrowserButton disabled={pending || status.browser.reason === "outreach_recovery_required"} reason={status.browser.reason} />
            ) : null}
            {!enabled ? <p className="mt-2 text-xs text-slate-500">Start the Windows worker to use this action.</p> : null}
            {recommendation ? <Link href={recommendation.href} className="mt-2 block text-xs text-indigo-700">Recommended: {recommendation.label}</Link> : null}
            <div className="mt-3 flex gap-2">
              <Link href="/worker" className="rounded-lg bg-indigo-600 px-2 py-1 text-xs text-white">Open Worker Center</Link>
              <button type="button" className="rounded-lg px-2 py-1 text-xs text-slate-600" onClick={() => collapse(false)} aria-expanded={open}>Collapse</button>
            </div>
          </div>
        ) : (
          <button type="button" className="flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600" onClick={() => collapse(true)} aria-expanded={open}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(status?.online ? (attention ? "blocked" : discovery.tone) : "offline")}`} aria-hidden />
            <span className="truncate">{status ? headline : "Worker"}</span>
          </button>
        )}
      </section>
    </>
  );
}

function RestartBrowserButton({ disabled, reason }: { disabled?: boolean; reason?: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button type="button" className="mt-3 rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:opacity-50" disabled={disabled || pending} onClick={() => setOpen(true)}>
        Restart Automation Browser
      </button>
      {disabled && reason === "outreach_recovery_required" ? <p className="mt-1 text-xs text-red-700">A Follow or DM may be unfinished. Use Recover Interrupted Outreach.</p> : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="restart-browser-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm">
            <h2 id="restart-browser-title" className="font-semibold">Restart Automation Browser?</h2>
            <p className="mt-2 text-slate-600">This will relaunch the dedicated Instagram browser using the existing saved profile. No Follow or DM will be performed.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2" onClick={() => setOpen(false)}>Cancel</button>
              <button
                type="button"
                className="rounded-lg bg-indigo-600 px-3 py-2 text-white"
                onClick={() => {
                  setPending(true);
                  void requestWorkerCommand("restart_browser_session_if_safe", {}).then((result) => {
                    setPending(false);
                    setOpen(false);
                    if (!result.ok) toast.error(result.error);
                    else toast.success(result.message ?? "Restarting the browser.");
                  });
                }}
              >
                Restart Browser
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function heartbeatLabel(value: string | null) {
  if (!value) return "No heartbeat yet";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Last seen ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `Last seen ${minutes}m ${remain}s ago`;
}
