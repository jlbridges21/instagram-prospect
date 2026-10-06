"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { pauseAutomation, pendingOutreachCount, resumeAutomation } from "@/lib/actions/outreach";
import { Button } from "@/components/ui/button";

export function AutomationControls({ enabled, prominent = false }: { enabled: boolean; prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
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
      setConfirmCancel(false);
    });
  }

  function askToCancel() {
    setConfirmCancel(true);
    setPendingCount(null);
    startTransition(async () => {
      const result = await pendingOutreachCount();
      if (result.ok) setPendingCount(result.prospects);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {prominent ? null : (
        <span
          className={
            enabled
              ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
              : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          }
        >
          {enabled ? "Running" : "Paused"}
        </span>
      )}
      {enabled ? (
        <Button size={prominent ? "md" : "sm"} className={prominent ? "min-h-12 w-full text-base" : undefined} variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
          {prominent ? "Pause Outreach" : "Stop outreach"}
        </Button>
      ) : (
        <Button size={prominent ? "md" : "sm"} className={prominent ? "min-h-12 w-full text-base" : undefined} disabled={pending} onClick={resume}>
          {prominent ? "Resume Outreach" : "Resume automation"}
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
            {confirmCancel ? (
              <>
                <h2 id="stop-outreach-title" className="text-base font-semibold text-slate-900">
                  {pendingCount === null
                    ? "Cancel pending outreach?"
                    : `Cancel ${pendingCount} pending prospect outreach sequence${pendingCount === 1 ? "" : "s"}?`}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Approved prospects stay approved. You can requeue them later. Jobs that already started are left alone.
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="secondary" disabled={pending} onClick={() => setConfirmCancel(false)}>
                    Go back
                  </Button>
                  <Button variant="danger" disabled={pending} onClick={() => pause(true)}>
                    Yes, cancel pending outreach
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 id="stop-outreach-title" className="text-base font-semibold text-slate-900">
                  Stop outreach
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Pause keeps every queued job and does not change approved prospects or locked messages.
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                    Keep running
                  </Button>
                  <Button disabled={pending} onClick={() => pause(false)}>
                    Pause outreach
                  </Button>
                </div>
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <p className="text-sm font-medium text-slate-900">Cancel pending outreach</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    This permanently cancels queued jobs that have not started. Approved prospects can be requeued later.
                  </p>
                  <Button className="mt-3" size="sm" variant="danger" disabled={pending} onClick={askToCancel}>
                    Cancel pending outreach
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
