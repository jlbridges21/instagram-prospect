"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveOutreachSettings } from "@/lib/actions/outreach";
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

  function save() {
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
        <Field label="Hourly target" hint="A pacing goal. The hourly maximum is the cap.">
          <TextInput value={hourlyMin} onChange={(event) => setHourlyMin(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Hourly maximum">
          <TextInput value={hourlyMax} onChange={(event) => setHourlyMax(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Daily maximum">
          <TextInput value={dailyMax} onChange={(event) => setDailyMax(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Minimum delay between messages" hint="Seconds.">
          <TextInput value={delay} onChange={(event) => setDelay(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Scheduling spread" hint="Seconds of variation so jobs do not stack on the same minute.">
          <TextInput value={spread} onChange={(event) => setSpread(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Claim lease" hint="Seconds before an abandoned job can be claimed again.">
          <TextInput value={lease} onChange={(event) => setLease(event.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Button disabled={pending} onClick={save}>
        Save outreach settings
      </Button>
    </section>
  );
}
