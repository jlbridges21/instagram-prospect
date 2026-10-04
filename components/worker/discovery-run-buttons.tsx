"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";

export function DiscoveryRunButtons({ online, running }: { online: boolean; running: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirmStop, setConfirmStop] = useState(false);
  const disabled = !online || pending;

  function send(type: "pause_discovery" | "stop_discovery") {
    startTransition(async () => {
      const result = await requestWorkerCommand(type, {});
      setConfirmStop(false);
      if (!result.ok) toast.error(result.error);
      else toast.success(type === "pause_discovery" ? "Pausing Discovery." : "Stopping Discovery.");
    });
  }

  if (!running) return <p className="text-sm text-slate-500">{online ? "Discovery is not running." : "Start the Windows worker to use this action."}</p>;

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" title="Temporarily pauses this Discovery run. Progress and session remain available to resume." className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50" disabled={disabled} onClick={() => send("pause_discovery")}>
        Pause Discovery
      </button>
      <button type="button" title="Ends the current Discovery run. Starting again creates a new run." className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50" disabled={disabled} onClick={() => setConfirmStop(true)}>
        Stop Discovery
      </button>
      {confirmStop ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="stop-discovery-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h2 id="stop-discovery-title" className="font-semibold">Stop Discovery?</h2>
            <p className="mt-2 text-sm text-slate-600">This ends the current run. Progress stays in history. Starting again creates a new run. Pause keeps this run available to resume.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-sm" onClick={() => setConfirmStop(false)}>Cancel</button>
              <button type="button" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => send("stop_discovery")}>Stop Discovery</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
