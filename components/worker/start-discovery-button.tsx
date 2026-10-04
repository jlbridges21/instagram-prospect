"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";

export function StartDiscoveryButton({ disabled, reviewCount }: { disabled?: boolean; reviewCount: number }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"review_target" | "duration" | "inspection_count" | "continuous">("review_target");
  const [target, setTarget] = useState("20");
  const [minutes, setMinutes] = useState("30");
  const [count, setCount] = useState("100");
  const [hourly, setHourly] = useState("30");
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const result = await requestWorkerCommand("start_discovery", {
        mode,
        reviewTarget: Number.parseInt(target, 10),
        durationMinutes: Number.parseInt(minutes, 10),
        inspectionCount: Number.parseInt(count, 10),
        hourlyPace: Number.parseInt(hourly, 10),
        suggestedAccounts: true,
        homeFeed: true,
      });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(result.message ?? "Starting Discovery.");
        setOpen(false);
      }
    });
  }

  const selectedTarget = Number.parseInt(target, 10);
  const remaining = Number.isFinite(selectedTarget) ? Math.max(0, selectedTarget - reviewCount) : 0;

  return (
    <>
      <button type="button" className="rounded-lg bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50" disabled={disabled} onClick={() => setOpen(true)}>
        Start Discovery
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="start-discovery-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm text-slate-800">
            <h2 id="start-discovery-title" className="text-base font-semibold">Start Discovery</h2>
            <p className="mt-1 text-slate-500">What do you want Discovery to do?</p>
            <p className="mt-2 text-xs text-slate-500">Current Review count: {reviewCount}</p>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "review_target"} onChange={() => setMode("review_target")} /> Fill Review queue to</label>
              {mode === "review_target" ? (
                <div className="flex gap-2">
                  {["20", "50", "100"].map((value) => (
                    <button key={value} type="button" className="rounded-lg border border-slate-200 px-2 py-1" onClick={() => setTarget(value)}>{value}</button>
                  ))}
                  <input aria-label="Custom review target" className="w-20 rounded-lg border border-slate-200 px-2" value={target} onChange={(event) => setTarget(event.target.value)} />
                </div>
              ) : null}
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "continuous"} onChange={() => setMode("continuous")} /> Run continuously until I stop it</label>
              <details className="text-xs text-slate-600">
                <summary>More ways to run</summary>
                <label className="mt-2 flex items-center gap-2"><input type="radio" checked={mode === "duration"} onChange={() => setMode("duration")} /> Run for minutes</label>
                {mode === "duration" ? <input aria-label="Discovery minutes" className="mt-1 w-24 rounded-lg border border-slate-200 px-2" value={minutes} onChange={(event) => setMinutes(event.target.value)} /> : null}
                <label className="mt-2 flex items-center gap-2"><input type="radio" checked={mode === "inspection_count"} onChange={() => setMode("inspection_count")} /> Inspect a set number of profiles</label>
                {mode === "inspection_count" ? <input aria-label="Profiles to inspect" className="mt-1 w-24 rounded-lg border border-slate-200 px-2" value={count} onChange={(event) => setCount(event.target.value)} /> : null}
              </details>
            </div>
            <label className="mt-3 block text-xs text-slate-500">
              Hourly profile inspection pace
              <input aria-label="Hourly inspection pace" className="mt-1 w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm" value={hourly} onChange={(event) => setHourly(event.target.value)} />
            </label>
            <p className="mt-2 text-xs text-slate-500">Suggested Accounts and Home Feed stay on. This pace controls inspections only, not Follow or DM pacing.</p>
            {mode === "review_target" ? <p className="mt-1 text-xs text-slate-600">Discovery will look for approximately {remaining} more qualified prospects.</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50" disabled={pending} onClick={start}>Start Discovery</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
