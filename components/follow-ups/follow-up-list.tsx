"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { markFollowUpCancelled, markFollowUpComplete } from "@/lib/actions/follow-ups";
import { EditFollowUp } from "@/components/follow-ups/follow-up-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FOLLOW_UP_STATUS_LABELS, type FollowUpStatus } from "@/lib/constants/prospects";

export type FollowUpCard = {
  id: string;
  prospectId: string;
  name: string;
  username: string;
  dueLabel: string;
  dueAt: string;
  status: FollowUpStatus;
  notes: string;
  contactedLabel: string;
};

function isOverdue(row: FollowUpCard) {
  if (row.status !== "pending" || !row.dueAt) return false;
  return new Date(row.dueAt).getTime() < Date.now();
}

export function FollowUpList({ rows }: { rows: FollowUpCard[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <EmptyState
          icon={CalendarClock}
          title="No follow-ups"
          description="Schedule one from a prospect when you want a reminder to check back."
        />
      </div>
    );
  }

  function complete(row: FollowUpCard) {
    startTransition(async () => {
      const result = await markFollowUpComplete(row.id, row.prospectId);
      if (result.ok) toast.success("Follow-up completed");
      else toast.error(result.error);
    });
  }

  function cancel(row: FollowUpCard) {
    startTransition(async () => {
      const result = await markFollowUpCancelled(row.id, row.prospectId);
      if (result.ok) toast.success("Follow-up cancelled");
      else toast.error(result.error);
    });
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link href={`/prospects/${row.prospectId}`} className="font-medium text-slate-900 hover:text-indigo-700">
                {row.name}
              </Link>
              <p className="text-sm text-slate-600">@{row.username}</p>
              <p className="mt-2 text-sm text-slate-700">
                Due {row.dueLabel}
                {isOverdue(row) ? (
                  <Badge className="ml-2 bg-amber-50 text-amber-800 ring-amber-200">Overdue</Badge>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-slate-500">Original contact {row.contactedLabel}</p>
              {row.notes ? <p className="mt-3 text-sm leading-6 text-slate-700">{row.notes}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge className="bg-slate-50 text-slate-700 ring-slate-200">
                {FOLLOW_UP_STATUS_LABELS[row.status]}
              </Badge>
              {row.status === "pending" ? (
                <>
                  <Button size="sm" disabled={pending} onClick={() => complete(row)}>
                    Complete
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(row.id)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => cancel(row)}>
                    Cancel
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          {editing === row.id ? (
            <EditFollowUp
              id={row.id}
              prospectId={row.prospectId}
              dueAt={row.dueAt}
              notes={row.notes}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
