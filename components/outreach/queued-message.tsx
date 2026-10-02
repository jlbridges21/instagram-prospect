"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveQueuedMessage } from "@/lib/actions/outreach";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";

export function QueuedMessageEditor({
  id,
  message,
  locked,
}: {
  id: string;
  message: string;
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveQueuedMessage(id, draft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "The queued message was updated.");
      setEditing(false);
    });
  }

  return (
    <div>
      {editing ? (
        <TextArea value={draft} onChange={(event) => setDraft(event.target.value)} />
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{message}</p>
      )}
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {locked
          ? "This send has started, so the locked message stays as it was when the job began."
          : "This is the message locked for outreach. Editing the global template does not change it."}
      </p>
      {locked ? null : (
        <div className="mt-3">
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={save}>
                Save queued message
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit queued message
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
