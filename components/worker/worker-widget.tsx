"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";
import { livePollDelay } from "@/lib/discovery/policy";
import { formatResumeClock } from "@/lib/discovery/pacing";
import { StartDiscoveryButton } from "@/components/worker/start-discovery-button";
import { StartOutreachButton } from "@/components/worker/start-outreach-button";

type Status = {
  online: boolean;
  title: string;
  tone: "offline" | "attention" | "running" | "waiting" | "ready";
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
  attentionReason: string | null;
};

const STORAGE_KEY = "shootportal-worker-widget";
const WIDGET_EVENT = "shootportal-worker-widget";

function subscribeWidget(onChange: () => void) {
  window.addEventListener(WIDGET_EVENT, onChange);
  return () => window.removeEventListener(WIDGET_EVENT, onChange);
}

function widgetCollapsed() {
  return window.localStorage.getItem(STORAGE_KEY) === "collapsed";
}

export function WorkerWidget({ timeZone }: { timeZone: string }) {
  const collapsed = useSyncExternalStore(subscribeWidget, widgetCollapsed, () => false);
  const open = !collapsed;
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState(false);

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
            const body = (await response.json()) as Status & { state?: string };
            setStatus(body);
            const key = `${body.tone}|${body.title}|${body.attentionReason ?? ""}`;
            if (previous && previous !== key) toast(body.attentionReason || body.title);
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

  const tone = status?.tone ?? "offline";
  const dot = tone === "attention" || tone === "offline" ? "bg-red-500" : tone === "waiting" ? "bg-amber-500" : "bg-emerald-500";

  async function send(type: "pause_discovery" | "pause_outreach" | "stop_discovery") {
    setPending(true);
    const result = await requestWorkerCommand(type, {});
    setPending(false);
    if (!result.ok) toast.error(result.error);
    else toast.success(result.message ?? "Sent.");
  }

  return (
    <section className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))]" aria-label="Worker control">
      {open ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-lg">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-900">Worker</p>
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          </div>
          <p className="mt-1 text-slate-700">{status?.title ?? "Checking the worker"}</p>
          <p className="mt-2 text-xs text-slate-500">{status?.machineName ?? "Windows worker"} · {heartbeatLabel(status?.lastHeartbeatAt ?? null)}</p>
          {status?.attentionReason ? <p className="mt-2 text-sm text-red-700">{status.attentionReason}</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <p>Discovery<br />{status?.hourly ? "WAITING" : status?.discoveryEnabled ? "RUNNING" : "PAUSED"}</p>
            <p>Outreach<br />{status?.outreachEnabled ? "RUNNING" : "PAUSED"}</p>
          </div>
          <p className="mt-2 text-xs text-slate-600">{actionLabel(status)}</p>
          <p className="text-xs text-slate-600">Review {status?.reviewCount ?? 0} / {status?.reviewTarget ?? "Unlimited"}</p>
          <p className="text-xs text-slate-600">
            This hour {status?.hourly ? `${status.hourly.count} / ${status.hourly.limit}` : `— / ${status?.hourlyLimit ?? 30}`}
            {status?.hourly ? ` · resumes ${formatResumeClock(status.hourly.resumesAt, timeZone)}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {status?.discoveryEnabled ? (
              <button type="button" className="rounded-lg border border-slate-200 px-2 py-1 text-xs" disabled={!status.online || pending} onClick={() => send("pause_discovery")}>Pause Discovery</button>
            ) : (
              <StartDiscoveryButton disabled={!status?.online || pending} reviewCount={status?.reviewCount ?? 0} />
            )}
            {status?.outreachEnabled ? (
              <button type="button" className="rounded-lg border border-slate-200 px-2 py-1 text-xs" disabled={!status.online || pending} onClick={() => send("pause_outreach")}>Pause Outreach</button>
            ) : (
              <StartOutreachButton disabled={!status?.online || pending} />
            )}
            <Link href="/worker" className="rounded-lg bg-indigo-600 px-2 py-1 text-xs text-white">Open Worker Center</Link>
            <button type="button" className="rounded-lg px-2 py-1 text-xs text-slate-600" onClick={() => collapse(false)} aria-expanded={open}>Collapse</button>
          </div>
          {!status?.online ? <p className="mt-2 text-xs text-slate-500">Discovery and Outreach cannot run until the Windows worker reconnects.</p> : null}
        </div>
      ) : (
        <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg" onClick={() => collapse(true)} aria-expanded={open}>
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          {status?.title ?? "Worker"}
        </button>
      )}
    </section>
  );
}

function heartbeatLabel(value: string | null) {
  if (!value) return "No heartbeat yet";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Last heartbeat ${seconds}s ago`;
  return `Last heartbeat ${Math.round(seconds / 60)}m ago`;
}

function actionLabel(status: Status | null) {
  if (!status?.currentAction || status.currentAction === "standby" || status.currentAction === "idle") return "Waiting for the next action";
  if (status.username) return `Inspecting @${status.username}`;
  return status.currentAction.replaceAll("_", " ");
}
