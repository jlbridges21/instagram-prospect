"use client";

import Link from "next/link";
import { useState } from "react";
import { LiveCountdown } from "@/components/ui/live-countdown";
import { AutomationControls } from "@/components/outreach/automation-controls";
import { WorkerStrip } from "@/components/mobile/mobile-overview";
import { formatCurrentAction } from "@/lib/status/operations";

export type MobileQueueItem = {
  id: string;
  username: string;
  pictureUrl: string | null;
  state: string;
  when: string | null;
};

export function MobileOutreach({
  running,
  queued,
  contacted,
  nextAt,
  currentTask,
  currentUsername,
  remaining,
  fresh,
  retrying,
  failed,
  spacingSeconds,
  upcoming,
  workerOnline,
  browser,
  discovery,
}: {
  running: boolean;
  queued: number;
  contacted: number;
  nextAt: string | null;
  currentTask: string | null;
  currentUsername: string | null;
  remaining: number;
  fresh: number;
  retrying: number;
  failed: number;
  spacingSeconds: number;
  upcoming: MobileQueueItem[];
  workerOnline: boolean;
  browser: string;
  discovery: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? upcoming : upcoming.slice(0, 4);
  const sending = currentTask?.startsWith("executing_") === true;
  const who = currentUsername ? `@${currentUsername.replace(/^@/, "")}` : null;

  return (
    <div className="space-y-5 md:hidden">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Outreach</h1>
        <p className="mt-1 text-sm text-slate-400">Manage your outreach queue and monitor activity.</p>
      </div>
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
        <p className="text-xs font-medium tracking-wide text-slate-400">Outreach</p>
        <p className={running ? "mt-1 text-xl font-semibold text-emerald-300" : "mt-1 text-xl font-semibold text-amber-300"}>{running ? "RUNNING" : "PAUSED"}</p>
        <p className="mt-1 text-sm text-slate-400">{queued} queued · {contacted} contacted</p>
        <div className="mt-4">
          <AutomationControls enabled={running} prominent />
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-500/20 via-[#12182b] to-[#0b1020] p-4">
        <p className="text-xs font-medium tracking-wide text-indigo-200">{sending ? "Current action" : "Next outreach"}</p>
        <p className="mt-3 text-[28px] font-semibold leading-tight text-slate-50">
          {sending ? (who ? `Sending to ${who}` : "Sending") : nextAt ? <LiveCountdown targetAt={nextAt} /> : "Waiting"}
        </p>
        <p className="mt-1 text-sm text-slate-300">{sending ? formatCurrentAction(currentTask, currentUsername) : `Minimum spacing ${spacingSeconds}s`}</p>
      </section>
      <div className="grid grid-cols-4 gap-2">
        <Count label="Remaining" value={remaining} />
        <Count label="Fresh" value={fresh} />
        <Count label="Retrying" value={retrying} tone="text-amber-300" />
        <Count label="Failed" value={failed} tone="text-red-300" />
      </div>
      <section>
        <h2 className="text-[17px] font-semibold text-slate-50">Upcoming</h2>
        <div className="mt-3 space-y-2">
          {visible.length === 0 ? <p className="rounded-2xl border border-white/10 px-4 py-6 text-sm text-slate-400">Nothing is queued.</p> : null}
          {visible.map((item, index) => (
            <Link key={item.id} href={`/prospects/${item.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              {item.pictureUrl ? <img src={item.pictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/20 text-sm text-indigo-100">{item.username.slice(0, 1).toUpperCase()}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-50">@{item.username}</span>
                <span className="block truncate text-xs text-slate-400">{item.state}</span>
              </span>
              <span className="text-[11px] font-medium text-indigo-200">{index === 0 ? "Next" : item.when ?? `#${index + 1}`}</span>
            </Link>
          ))}
        </div>
        {upcoming.length > 4 && !showAll ? (
          <button type="button" className="mt-3 min-h-11 text-sm font-medium text-indigo-300" onClick={() => setShowAll(true)}>View all</button>
        ) : null}
      </section>
      <WorkerStrip online={workerOnline} browser={browser} discovery={discovery} outreach={running ? "RUNNING" : "PAUSED"} current={formatCurrentAction(currentTask, currentUsername)} />
    </div>
  );
}

function Count({ label, value, tone = "text-slate-50" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-1 py-2 text-center">
      <p className={`text-base font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-slate-500">{label}</p>
    </div>
  );
}
