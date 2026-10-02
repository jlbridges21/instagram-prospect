"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { editFollowUp, scheduleFollowUp } from "@/lib/actions/follow-ups";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";

export function ScheduleFollowUp({ prospectId }: { prospectId: string }) {
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await scheduleFollowUp({ prospectId, dueAt, notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Follow-up scheduled");
      setDueAt("");
      setNotes("");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Due">
        <TextInput
          type="datetime-local"
          required
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />
      </Field>
      <Field label="Notes">
        <TextArea
          className="min-h-24"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Schedule follow-up
      </Button>
    </form>
  );
}

function toDatetimeLocal(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EditFollowUp({
  id,
  prospectId,
  dueAt,
  notes,
  onDone,
}: {
  id: string;
  prospectId: string;
  dueAt: string;
  notes: string;
  onDone: () => void;
}) {
  const [due, setDue] = useState(() => toDatetimeLocal(dueAt));
  const [note, setNote] = useState(notes);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await editFollowUp({ id, prospectId, dueAt: due, notes: note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Follow-up updated");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <Field label="Due">
        <TextInput type="datetime-local" required value={due} onChange={(event) => setDue(event.target.value)} />
      </Field>
      <Field label="Notes">
        <TextArea className="min-h-24" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
