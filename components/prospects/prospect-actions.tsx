"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { approveProspects, requeueProspects, saveProspectNotes, skipProspects } from "@/lib/actions/prospects";
import { canApprove, canSkip } from "@/lib/prospects/status";
import type { ProspectStatus } from "@/lib/constants/prospects";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { TextArea } from "@/components/ui/field";

export function ProspectActions({
  id,
  status,
  profileUrl,
  message,
  canRequeue = false,
  requeueOnly = false,
}: {
  id: string;
  status: ProspectStatus;
  profileUrl: string;
  message: string;
  canRequeue?: boolean;
  requeueOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmSkip, setConfirmSkip] = useState(false);

  function approve() {
    startTransition(async () => {
      const result = await approveProspects([id]);
      if (result.ok) toast.success(result.message ?? "Prospect approved");
      else toast.error(result.error);
    });
  }

  function requeue() {
    startTransition(async () => {
      const result = await requeueProspects([id]);
      if (result.ok) toast.success(result.message ?? "Outreach was requeued.");
      else toast.error(result.error);
    });
  }

  function skip() {
    startTransition(async () => {
      const result = await skipProspects([id]);
      if (result.ok) {
        toast.success("Prospect skipped");
        setConfirmSkip(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  if (requeueOnly) {
    if (!canRequeue) return null;
    return (
      <Button onClick={requeue} disabled={pending}>
        Requeue outreach
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={approve} disabled={pending || !canApprove(status)}>
        Approve
      </Button>
      {canRequeue ? (
        <Button onClick={requeue} disabled={pending}>
          Requeue outreach
        </Button>
      ) : null}
      <Button variant="secondary" onClick={() => setConfirmSkip(true)} disabled={pending || !canSkip(status)}>
        Skip
      </Button>
      <a
        href={profileUrl}
        target="_blank"
        rel="noreferrer"
        className={buttonClasses("secondary", "md")}
      >
        Open Instagram
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <CopyButton value={message} label="Copy message" />
      <ConfirmDialog
        open={confirmSkip}
        title="Skip this prospect?"
        description="The status will change to skipped. Instagram is not contacted."
        confirmLabel="Skip"
        tone="danger"
        pending={pending}
        onClose={() => setConfirmSkip(false)}
        onConfirm={skip}
      />
    </div>
  );
}

export function NotesEditor({ id, notes }: { id: string; notes: string }) {
  const [value, setValue] = useState(notes);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveProspectNotes(id, value);
      if (result.ok) toast.success("Notes saved");
      else toast.error(result.error);
    });
  }

  return (
    <div>
      <TextArea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Notes"
        placeholder="Add a note for yourself"
      />
      <div className="mt-3">
        <Button variant="secondary" onClick={save} disabled={pending}>
          {pending ? "Saving..." : "Save notes"}
        </Button>
      </div>
    </div>
  );
}
