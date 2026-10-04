"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";

export function StartOutreachButton({ disabled, ready = 0 }: { disabled?: boolean; ready?: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const result = await requestWorkerCommand("start_outreach", {});
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(result.message ?? "Starting Outreach.");
        setOpen(false);
      }
    });
  }

  return (
    <>
      <button type="button" className="rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:opacity-50" disabled={disabled} onClick={() => setOpen(true)}>
        Start Outreach
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="start-outreach-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm text-slate-800">
            <h2 id="start-outreach-title" className="text-base font-semibold">Start Outreach</h2>
            <p className="mt-2">Approved prospects ready: {ready}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-slate-600">
              <li>Verify each profile</li>
              <li>Follow eligible prospects</li>
              <li>Respect pacing</li>
              <li>Open Direct</li>
              <li>Confirm the recipient</li>
              <li>Confirm there is no prior conversation</li>
              <li>Verify the exact locked message</li>
              <li>Send once</li>
              <li>Continue through the queue</li>
            </ol>
            <p className="mt-3 text-xs text-slate-500">Active hours, hourly maximum, and daily maximum stay on the saved outreach settings. <Link href="/settings" className="text-indigo-700">Edit Outreach Settings</Link></p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50" disabled={pending} onClick={start}>Start Outreach</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
