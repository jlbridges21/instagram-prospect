"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveOutreachSettings } from "@/lib/actions/outreach";
import { WEEKDAYS, WEEKDAY_LABELS, type OutreachSettings } from "@/lib/outreach/types";
import { Button } from "@/components/ui/button";
import { Field, TextInput, Toggle } from "@/components/ui/field";

export function OutreachSettingsForm({ outreach }: { outreach: OutreachSettings }) {
  const [enabled, setEnabled] = useState(outreach.automationEnabled);
  const [days, setDays] = useState(outreach.activeDays);
  const [start, setStart] = useState(outreach.activeStart);
  const [end, setEnd] = useState(outreach.activeEnd);
  const [hourlyMin, setHourlyMin] = useState(String(outreach.hourlyMinimum));
  const [hourlyMax, setHourlyMax] = useState(String(outreach.hourlyMaximum));
  const [dailyMax, setDailyMax] = useState(String(outreach.dailyMaximum));
  const [delay, setDelay] = useState(String(outreach.minimumActionDelaySeconds));
  const [spread, setSpread] = useState(String(outreach.schedulingSpreadSeconds));
  const [lease, setLease] = useState(String(outreach.claimLeaseSeconds));
  const [pending, startTransition] = useTransition();

  function toggleDay(day: (typeof WEEKDAYS)[number]) {
    setDays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
    );
  }

  function save() {
    startTransition(async () => {
      const result = await saveOutreachSettings({
        automationEnabled: enabled,
        activeDays: days,
        activeStart: start,
        activeEnd: end,
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
        Automation starts paused. These limits decide when queued messages may run. The app does not send Instagram messages from this page.
      </p>
      <Toggle
        checked={enabled}
        onChange={setEnabled}
        label="Outreach running"
        description="This starts and stops follow and message jobs. Discovery stays on its own switch on the Worker page."
      />
      <fieldset>
        <legend className="text-sm font-medium text-slate-800">Active days</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const selected = days.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleDay(day)}
                className={
                  selected
                    ? "rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700"
                    : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
                }
              >
                {WEEKDAY_LABELS[day]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Active start" hint="24-hour time in the application timezone.">
          <TextInput value={start} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label="Active end">
          <TextInput value={end} onChange={(event) => setEnd(event.target.value)} />
        </Field>
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
