"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { recalculateOutreachSchedule, saveOutreachSettings } from "@/lib/actions/outreach";
import type { OutreachSettings } from "@/lib/outreach/types";
import { Button } from "@/components/ui/button";
import { Field, TextInput, Toggle } from "@/components/ui/field";

export function OutreachSettingsForm({ outreach }: { outreach: OutreachSettings }) {
  const [enabled, setEnabled] = useState(outreach.automationEnabled);
  const [hourlyMin, setHourlyMin] = useState(String(outreach.hourlyMinimum));
  const [hourlyMax, setHourlyMax] = useState(String(outreach.hourlyMaximum));
  const [dailyMax, setDailyMax] = useState(String(outreach.dailyMaximum));
  const [delay, setDelay] = useState(String(outreach.minimumActionDelaySeconds));
  const [spread, setSpread] = useState(String(outreach.schedulingSpreadSeconds));
  const [lease, setLease] = useState(String(outreach.claimLeaseSeconds));
  const [pending, startTransition] = useTransition();
  const [applyPace, setApplyPace] = useState(false);

  function save() {
    const paceChanged =
      Number.parseInt(hourlyMax, 10) !== outreach.hourlyMaximum ||
      Number.parseInt(dailyMax, 10) !== outreach.dailyMaximum ||
      Number.parseInt(delay, 10) !== outreach.minimumActionDelaySeconds;
    startTransition(async () => {
      const result = await saveOutreachSettings({
        automationEnabled: enabled,
        hourlyMinimum: Number.parseInt(hourlyMin, 10),
        hourlyMaximum: Number.parseInt(hourlyMax, 10),
        dailyMaximum: Number.parseInt(dailyMax, 10),
        minimumActionDelaySeconds: Number.parseInt(delay, 10),
        schedulingSpreadSeconds: Number.parseInt(spread, 10),
        claimLeaseSeconds: Number.parseInt(lease, 10),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Outreach settings saved");
      if (paceChanged) setApplyPace(true);
    });
  }

  function recalculate() {
    startTransition(async () => {
      const result = await recalculateOutreachSchedule();
      setApplyPace(false);
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Queued outreach was recalculated.");
    });
  }

  return (
    <section className="max-w-3xl space-y-5">
      <p className="text-sm leading-6 text-slate-600">
        Outreach can run at any time while it is enabled. Hourly, daily, and spacing limits still apply. This page does not send Instagram messages.
      </p>
      <Toggle
        checked={enabled}
        onChange={setEnabled}
        label="Outreach running"
        description="This starts and stops follow and message jobs. Discovery stays on its own switch on the Worker page."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Completed outreaches per hour" hint="Rolling 60-minute cap. This does not remove the daily maximum.">
          <TextInput value={hourlyMax} onChange={(event) => setHourlyMax(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Minimum spacing between prospects" hint="Seconds between completed outreaches. 360 seconds is 6 minutes. Verify, follow, and send for the same prospect stay in order and do not each wait this long.">
          <TextInput value={delay} onChange={(event) => setDelay(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Daily outreach maximum">
          <TextInput value={dailyMax} onChange={(event) => setDailyMax(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Hourly target" hint="Stored for reference. The hourly cap above is what the worker enforces.">
          <TextInput value={hourlyMin} onChange={(event) => setHourlyMin(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Scheduling spread" hint="Kept for older rows. The gap between prospects is the minimum spacing above.">
          <TextInput value={spread} onChange={(event) => setSpread(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Claim lease" hint="Seconds before an abandoned job can be claimed again.">
          <TextInput value={lease} onChange={(event) => setLease(event.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Button disabled={pending} onClick={save}>
        Save outreach settings
      </Button>
      {applyPace ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="apply-pace-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm text-slate-800">
            <h2 id="apply-pace-title" className="text-base font-semibold">Apply new pacing to queued outreach?</h2>
            <p className="mt-2 text-slate-600">This recomputes future not-yet-started outreach timing. Completed, running, failed, and uncertain actions stay as they are.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2" onClick={() => setApplyPace(false)}>Keep existing schedule</button>
              <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50" disabled={pending} onClick={recalculate}>Recalculate queued outreach</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
