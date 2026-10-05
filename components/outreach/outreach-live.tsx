"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { liveClockNow, serverClockNow, subscribeLiveClock } from "@/components/ui/live-clock";
import { LiveCountdown } from "@/components/ui/live-countdown";
import { subscribeDashboardStatus, type DashboardStatus } from "@/components/worker/status-poll";
import { formatCurrentAction, statusDotClass, type OperationTone } from "@/lib/status/operations";

export function OutreachLive({
  actual,
  tone,
  desired,
  reason,
  detail,
  username,
  paceAt,
  paceReason,
  remaining,
  fresh,
  retrying,
  failed,
  queued,
  scheduledToday,
  sentToday,
  currentTask,
  currentUsername,
}: {
  actual: string;
  tone: OperationTone;
  desired: string;
  reason: string;
  detail: string | null;
  username: string | null;
  paceAt: string | null;
  paceReason: string | null;
  remaining: number;
  fresh: number;
  retrying: number;
  failed: number;
  queued: number;
  scheduledToday: number;
  sentToday: number;
  currentTask: string | null;
  currentUsername: string | null;
}) {
  const [live, setLive] = useState<DashboardStatus | null>(null);
  const now = useSyncExternalStore(subscribeLiveClock, liveClockNow, serverClockNow);

  useEffect(() => subscribeDashboardStatus(setLive), []);

  const task = live?.currentAction ?? currentTask;
  const acting = isActing(task);
  const who = live ? live.paceUsername ?? null : username;
  const target = live ? live.paceAt ?? null : paceAt;
  const why = live ? live.paceReason ?? null : paceReason;
  const counts = {
    remaining: live?.remaining ?? remaining,
    fresh: live?.fresh ?? fresh,
    retrying: live?.retrying ?? retrying,
    failed: live?.failedCount ?? failed,
    queued: live?.queueCount ?? queued,
    scheduledToday: live?.scheduledToday ?? scheduledToday,
    sentToday: live?.sentToday ?? sentToday,
  };
  const action = acting
    ? formatCurrentAction(task, live?.username ?? currentUsername)
    : "Waiting for the next Outreach action";
  const updated = live?.polledAt ? Math.max(0, Math.floor((now - live.polledAt) / 1000)) : null;

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(tone)}`} aria-hidden />
          <h2 className="font-semibold">Outreach {actual}</h2>
        </div>
        <p className="text-xs text-slate-500">{updated === null ? "● Live" : `● Updated ${updated}s ago`}</p>
      </div>
      <p className="mt-2">Desired: {desired}</p>
      <p className="mt-1">{reason}</p>
      {detail ? <p className="mt-1 text-slate-600">{detail}</p> : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Next outreach</p>
          <p className="mt-1 text-base font-semibold text-slate-900">{who ? `@${who.replace(/^@/, "")}` : "None queued"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{acting ? "Current step" : why ?? "Eligible"}</p>
          <p className="mt-1 text-base font-semibold text-slate-900">
            {acting ? action : target ? <LiveCountdown targetAt={target} /> : "None queued"}
          </p>
        </div>
      </div>

      <p className="mt-4">
        {counts.remaining} remaining · {counts.fresh} fresh · {counts.retrying} retrying · {counts.failed} failed or needs attention
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Queued prospects" value={String(counts.queued)} />
        <Stat label="Scheduled today" value={String(counts.scheduledToday)} />
        <Stat label="Sent today" value={String(counts.sentToday)} />
      </dl>
      <p className="mt-4 text-xs uppercase tracking-wide text-slate-500">Current worker action</p>
      <p className="mt-1">{action}</p>
      <p className="mt-3 text-xs text-slate-500">Pause stops new claims and keeps the queue. Stop ends this run the same way and does not cancel pending outreach. Cancel Pending Outreach stays a separate confirmed action in the control above.</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function isActing(task: string | null | undefined) {
  return task === "executing_verify_profile" || task === "executing_follow_profile" || task === "executing_send_message" || task === "outreach_state_sync";
}
