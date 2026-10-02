"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, Inbox } from "lucide-react";
import { toast } from "sonner";
import { approveProspects, skipProspects } from "@/lib/actions/prospects";
import { AnalyzeSelectedButton } from "@/components/prospects/qualify-controls";
import { canApprove, canSkip } from "@/lib/prospects/status";
import type { FitLabel, ProspectStatus } from "@/lib/constants/prospects";
import { Avatar } from "@/components/ui/avatar";
import { FitBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";

export type ProspectTableRow = {
  id: string;
  name: string;
  username: string;
  category: string;
  followers: string;
  fitLabel: FitLabel | null;
  fitScore: number | null;
  status: ProspectStatus;
  source: string;
  discovered: string;
  profileUrl: string;
  pictureUrl: string | null;
  reason: string;
  message: string;
};

export function ProspectsTable({
  rows,
  filtered,
}: {
  rows: ProspectTableRow[];
  filtered: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmSkip, setConfirmSkip] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <EmptyState
          icon={Inbox}
          title={filtered ? "No prospects match" : "No prospects yet"}
          description={
            filtered
              ? "Try a wider status, fit, or follower range."
              : "When the worker discovers profiles, they will be listed here. You can also load sample records to preview the table."
          }
        />
      </div>
    );
  }

  const allSelected = rows.every((row) => selected.includes(row.id));

  function toggleAll() {
    setSelected(allSelected ? [] : rows.map((row) => row.id));
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function skip(ids: string[]) {
    startTransition(async () => {
      const result = await skipProspects(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(ids.length === 1 ? "Prospect skipped" : "Selected prospects skipped");
      setSelected([]);
      setConfirmSkip(null);
    });
  }

  return (
    <div>
      {selected.length > 0 ? (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm text-slate-700">{selected.length} selected</p>
          <div className="flex flex-wrap gap-2">
            <AnalyzeSelectedButton
              rows={rows
                .filter((row) => selected.includes(row.id))
                .map((row) => ({ id: row.id, status: row.status }))}
            />
            <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirmSkip(selected)}
          >
            Skip selected
          </Button>
          </div>
        </div>
      ) : null}

      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all prospects on this page"
                  />
                </th>
                <th className="px-3 py-3 font-medium">Profile</th>
                <th className="px-3 py-3 font-medium">Username</th>
                <th className="px-3 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Category</th>
                <th className="px-3 py-3 font-medium">Followers</th>
                <th className="px-3 py-3 font-medium">Fit</th>
                <th className="px-3 py-3 font-medium">Reason</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Discovered</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest("a, button, input, label")) return;
                    router.push(`/prospects/${row.id}`);
                  }}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select @${row.username}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Avatar name={row.name} src={row.pictureUrl} size="sm" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
                    <Link href={`/prospects/${row.id}`} className="hover:text-indigo-700">
                      @{row.username}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{row.name}</td>
                  <td className="max-w-40 truncate px-3 py-2 text-slate-600" title={row.category}>{row.category}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{row.followers}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="mr-2 tabular-nums font-medium text-slate-900">{row.fitScore ?? "—"}</span>
                    <FitBadge label={row.fitLabel} />
                  </td>
                  <td className="max-w-64 px-3 py-2 text-slate-600">
                    <p className="truncate" title={row.reason}>{row.reason}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{row.source}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{row.discovered}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <RowActions row={row} onSkip={() => setConfirmSkip([row.id])} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(row.id)}
                onChange={() => toggle(row.id)}
                aria-label={`Select @${row.username}`}
              />
              <Avatar name={row.name} src={row.pictureUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={`/prospects/${row.id}`} className="font-medium text-slate-900">
                  @{row.username}
                </Link>
                <p className="text-sm text-slate-600">{row.name}</p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Meta label="Category" value={row.category} />
              <Meta label="Followers" value={row.followers} />
              <Meta label="Source" value={row.source} />
              <Meta label="Discovered" value={row.discovered} />
              <div className="col-span-2">
                <Meta label="Reason" value={row.reason} />
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FitBadge label={row.fitLabel} />
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-3">
              <RowActions row={row} onSkip={() => setConfirmSkip([row.id])} />
            </div>
          </article>
        ))}
      </div>

      <ConfirmDialog
        open={confirmSkip !== null}
        title="Skip prospects?"
        description="Skipped prospects leave the review queue. This does not contact Instagram."
        confirmLabel="Skip"
        tone="danger"
        pending={pending}
        onClose={() => setConfirmSkip(null)}
        onConfirm={() => {
          if (confirmSkip) skip(confirmSkip);
        }}
      />
    </div>
  );
}

function RowActions({ row, onSkip }: { row: ProspectTableRow; onSkip: () => void }) {
  const [pending, startTransition] = useTransition();

  function approve() {
    startTransition(async () => {
      const result = await approveProspects([row.id]);
      if (result.ok) toast.success(result.message ?? "Prospect approved");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-1">
      <Link href={`/prospects/${row.id}`} className="rounded-lg px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
        View
      </Link>
      {canApprove(row.status) ? (
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="rounded-lg px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
        >
          Approve
        </button>
      ) : null}
      <a
        href={row.profileUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
        aria-label={`Open @${row.username} on Instagram`}
      >
        Instagram
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
      <CopyButton value={row.message} label="Copy message" />
      <button
        type="button"
        onClick={onSkip}
        disabled={!canSkip(row.status)}
        className="rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
      >
        Skip
      </button>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
