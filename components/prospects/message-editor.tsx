"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { clearMessageOverride, updateMessageOverride } from "@/lib/actions/prospects";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";

export function MessageEditor({
  id,
  message,
  hasOverride,
}: {
  id: string;
  message: string;
  hasOverride: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateMessageOverride(id, draft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Message override saved");
      setEditing(false);
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await clearMessageOverride(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Using the default message");
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
        {hasOverride
          ? "This prospect uses a custom message. The global template is unchanged."
          : "Rendered from the current outreach template. A first name is used when one is stored. Otherwise the username is used."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <Button size="sm" disabled={pending} onClick={save}>
            Save override
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setDraft(message);
              setEditing(true);
            }}
          >
            Edit message
          </Button>
        )}
        {hasOverride ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={reset}>
            Reset to default
          </Button>
        ) : null}
      </div>
    </div>
  );
}
