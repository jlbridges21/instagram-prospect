"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { recalculateOutreachSchedule } from "@/lib/actions/outreach";
import { Button } from "@/components/ui/button";

export function RecalculateScheduleButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await recalculateOutreachSchedule();
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(result.message ?? "Queued outreach was recalculated.");
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
        Recalculate Outreach Schedule
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="recalculate-schedule-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm text-slate-800">
            <h2 id="recalculate-schedule-title" className="text-base font-semibold">Recalculate Outreach Schedule</h2>
            <p className="mt-2 text-slate-600">Recomputes future not-yet-started outreach timing using your current pacing settings. Completed, running, failed, and uncertain actions are not modified.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50" disabled={pending} onClick={run}>Recalculate</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
