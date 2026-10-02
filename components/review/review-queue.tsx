"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ExternalLink, Inbox } from "lucide-react";
import { toast } from "sonner";
import { approveProspects, approveVisibleQueue, skipProspects } from "@/lib/actions/prospects";
import type { FitLabel } from "@/lib/constants/prospects";
import { Avatar } from "@/components/ui/avatar";
import { FitBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";

export type ReviewItem = {
  id: string;
  name: string;
  username: string;
  followers: string;
  category: string;
  location: string;
  fitScore: number | null;
  fitLabel: FitLabel | null;
  reason: string;
  message: string;
  profileUrl: string;
  postUrl: string | null;
  thumbnailUrl: string | null;
  pictureUrl: string | null;
};

type PendingAction =
  | { type: "approve"; ids: string[] }
  | { type: "skip"; ids: string[] }
  | { type: "approve-all" };

export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <EmptyState
          icon={Inbox}
          title="Review queue is clear"
          description="Qualified prospects waiting for a decision will appear here. Approving or skipping updates their status. Nothing is sent to Instagram."
        />
      </div>
    );
  }

  const allSelected = items.every((item) => selected.includes(item.id));

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function run(action: PendingAction) {
    startTransition(async () => {
      const result =
        action.type === "approve-all"
          ? await approveVisibleQueue(items.map((item) => item.id))
          : action.type === "approve"
            ? await approveProspects(action.ids)
            : await skipProspects(action.ids);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const count = action.type === "approve-all" ? items.length : action.ids.length;
      toast.success(
        result.message ??
          (action.type === "skip"
            ? `Skipped ${count} prospect${count === 1 ? "" : "s"}`
            : `Approved ${count} prospect${count === 1 ? "" : "s"}`),
      );
      setSelected([]);
      setPendingAction(null);
    });
  }

  const dialogCopy = pendingAction
      ? pendingAction.type === "skip"
        ? {
            title: `Skip ${pendingAction.ids.length} prospect${pendingAction.ids.length === 1 ? "" : "s"}?`,
            description: "Their status will change to skipped. Instagram is not contacted.",
            confirm: "Skip",
            tone: "danger" as const,
          }
        : pendingAction.type === "approve-all"
          ? {
              title: `Approve ${items.length} prospect${items.length === 1 ? "" : "s"}?`,
              description:
                "This applies only to the prospects currently in this queue. Approval means they are ready for outreach. Messages are not sent.",
              confirm: "Approve all",
              tone: "primary" as const,
            }
          : {
              title: `Approve ${pendingAction.ids.length} prospect${pendingAction.ids.length === 1 ? "" : "s"}?`,
              description: "Approved means ready for outreach. Messages are not sent.",
              confirm: "Approve",
              tone: "primary" as const,
            }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? [] : items.map((item) => item.id))}
          />
          Select all visible
          <span className="text-slate-500">{selected.length} selected</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={selected.length === 0 || pending}
            onClick={() => setSelected([])}
          >
            Clear selection
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={selected.length === 0 || pending}
            onClick={() => setPendingAction({ type: "approve", ids: selected })}
          >
            Approve selected
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={selected.length === 0 || pending}
            onClick={() => setPendingAction({ type: "skip", ids: selected })}
          >
            Skip selected
          </Button>
          <Button size="sm" disabled={pending} onClick={() => setPendingAction({ type: "approve-all" })}>
            Approve all
          </Button>
        </div>
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`Select @${item.username}`}
                  />
                  <Avatar name={item.name} src={item.pictureUrl} />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <Link href={`/prospects/${item.id}`} className="text-sm text-slate-600 hover:text-indigo-700">
                      @{item.username}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.followers} followers · {item.category}
                      {item.location ? ` · ${item.location}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <FitBadge label={item.fitLabel} />
                  <span className="text-sm tabular-nums text-slate-700">
                    Fit score {item.fitScore ?? "not scored"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{item.reason}</p>
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-800 whitespace-pre-wrap">
                  {item.message}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-3 lg:w-44">
                {item.thumbnailUrl ? (
                  <a href={item.postUrl ?? item.profileUrl} target="_blank" rel="noreferrer">
                    {/* Stored source images are not known at build time. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbnailUrl}
                      alt="Source post"
                      className="h-28 w-full rounded-lg object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
                    No source post
                  </div>
                )}
                <Button size="sm" disabled={pending} onClick={() => setPendingAction({ type: "approve", ids: [item.id] })}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setPendingAction({ type: "skip", ids: [item.id] })}
                >
                  Skip
                </Button>
                <a
                  href={item.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open Instagram
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <CopyButton value={item.message} label="Copy message" />
                <Link
                  href={`/prospects/${item.id}`}
                  className="inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  View details
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {dialogCopy ? (
        <ConfirmDialog
          open
          title={dialogCopy.title}
          description={dialogCopy.description}
          confirmLabel={dialogCopy.confirm}
          tone={dialogCopy.tone}
          pending={pending}
          onClose={() => setPendingAction(null)}
          onConfirm={() => {
            if (pendingAction) run(pendingAction);
          }}
        />
      ) : null}
    </div>
  );
}
