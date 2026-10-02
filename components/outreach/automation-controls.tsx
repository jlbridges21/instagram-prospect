"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { pauseAutomation, resumeAutomation } from "@/lib/actions/outreach";
import { Button } from "@/components/ui/button";

export function AutomationControls({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function resume() {
    startTransition(async () => {
      const result = await resumeAutomation();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Outreach automation is running.");
    });
  }

  function pause(cancelPending: boolean) {
    startTransition(async () => {
      const result = await pauseAutomation(cancelPending);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Outreach automation paused.");
      setOpen(false);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={
          enabled
            ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
            : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
        }
      >
        {enabled ? "Running" : "Paused"}
      </span>
      {enabled ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
          Stop outreach
        </Button>
      ) : (
        <Button size="sm" disabled={pending} onClick={resume}>
          Resume automation
        </Button>
      )}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stop-outreach-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
          >
            <h2 id="stop-outreach-title" className="text-base font-semibold text-slate-900">
              Stop outreach
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Pausing keeps every queued job. Cancelling pending outreach removes jobs that have not started. Completed history stays.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                Keep running
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => pause(false)}>
                Pause only
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => pause(true)}>
                Pause and cancel pending
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
