"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelOutreach, rescheduleOutreachJob, retryOutreachJob } from "@/lib/actions/outreach";
import type { FitLabel } from "@/lib/constants/prospects";
import type { Json, OutreachJobRow } from "@/lib/db/types";
import { queueFollowStatusLabel } from "@/lib/outreach/follow-confirm";
import {
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  OUTREACH_JOB_TYPES,
  type OutreachJobStatus,
} from "@/lib/outreach/types";

type QueueProspect = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  instagram_username: string;
  fit_score: number | null;
  fit_label: FitLabel | null;
  profile_url: string | null;
  status: string;
  queued_message_text: string | null;
  outreach_cancelled_at: string | null;
  already_following: boolean;
};
import { FitBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, instagramProfileUrl } from "@/lib/utils/format";
import type { DateFormat } from "@/lib/constants/settings";
import { Inbox } from "lucide-react";

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "progress", label: "In progress" },
  { id: "failed", label: "Failed" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Row = {
  prospect: QueueProspect;
  job: OutreachJobRow;
  jobs: OutreachJobRow[];
};

export function QueueBoard({
  jobs,
  prospects,
  timeZone,
  dateFormat,
}: {
  jobs: OutreachJobRow[];
  prospects: QueueProspect[];
  timeZone: string;
  dateFormat: DateFormat;
}) {
  const [tab, setTab] = useState<TabId>("upcoming");
  const [query, setQuery] = useState("");
  const [jobType, setJobType] = useState("all");
  const [worker, setWorker] = useState("all");
  const [day, setDay] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [when, setWhen] = useState("");
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => buildRows(jobs, prospects), [jobs, prospects]);
  const workers = [...new Set(rows.map((row) => row.job.claimed_by_worker_id).filter(Boolean))] as string[];

  const visible = rows.filter((row) => {
    if (!matchesTab(row.job.status, tab)) return false;
    if (jobType !== "all" && row.job.job_type !== jobType) return false;
    if (worker !== "all" && row.job.claimed_by_worker_id !== worker) return false;
    if (day && localDay(row.job.scheduled_for, timeZone) !== day) return false;
    const haystack = `${row.prospect.instagram_username} ${row.prospect.display_name ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "That action failed.");
        return;
      }
      toast.success(result.message ?? "Updated");
      setSelected(null);
    });
  }

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={
              tab === item.id
                ? "whitespace-nowrap border-b-2 border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-700"
                : "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search username"
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          aria-label="Search prospects"
        />
        <select
          value={jobType}
          onChange={(event) => setJobType(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          aria-label="Job type"
        >
          <option value="all">All steps</option>
          {OUTREACH_JOB_TYPES.map((type) => (
            <option key={type} value={type}>
              {JOB_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <select
          value={worker}
          onChange={(event) => setWorker(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          aria-label="Worker"
        >
          <option value="all">All workers</option>
          {workers.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          aria-label="Scheduled date"
        />
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={Inbox}
            title={tab === "upcoming" ? "No outreach is currently queued." : "Nothing in this view"}
            description={
              tab === "upcoming" && rows.some((row) => row.job.status === "cancelled" || row.jobs.some((job) => job.status === "cancelled"))
                ? "Some approved prospects have cancelled outreach and can be requeued from the Approved prospects view."
                : "Approved prospects appear here after their outreach jobs are created. Nothing is sent until a worker completes a send job."
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3 md:hidden">
            {visible.map((row) => (
              <article key={row.job.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <RowBody
                  row={row}
                  timeZone={timeZone}
                  dateFormat={dateFormat}
                  pending={pending}
                  onDetails={() => setSelected(row)}
                  onRetry={() => run(() => retryOutreachJob(row.job.id))}
                  onCancel={() => run(() => cancelOutreach(row.prospect.id))}
                />
              </article>
            ))}
          </div>
          <div className="mt-4 hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Prospect</th>
                  <th className="px-4 py-3 font-medium">Next step</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Attempts</th>
                  <th className="px-4 py-3 font-medium">Worker</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.job.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/prospects/${row.prospect.id}`} className="font-medium text-slate-900 hover:text-indigo-700">
                        {nameOf(row.prospect)}
                      </Link>
                      <p className="text-xs text-slate-500">@{row.prospect.instagram_username}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{JOB_TYPE_LABELS[row.job.job_type]}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <FitBadge label={row.prospect.fit_label} />
                        {row.prospect.fit_score !== null ? (
                          <span className="text-xs tabular-nums text-slate-500">{row.prospect.fit_score}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{scheduleLabel(row.job, timeZone, dateFormat)}</td>
                    <td className="px-4 py-3">{stepStatus(row.job)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {row.job.attempt_count}/{row.job.max_attempts}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.job.claimed_by_worker_id ?? "—"}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        row={row}
                        pending={pending}
                        onDetails={() => setSelected(row)}
                        onRetry={() => run(() => retryOutreachJob(row.job.id))}
                        onCancel={() => run(() => cancelOutreach(row.prospect.id))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Job details</h2>
                <p className="mt-1 text-sm text-slate-500">@{selected.prospect.instagram_username}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <Detail label="Step" value={JOB_TYPE_LABELS[selected.job.job_type]} />
              <Detail label="Status" value={stepStatus(selected.job)} />
              <Detail label="Created" value={formatDateTime(selected.job.created_at, timeZone, dateFormat)} />
              <Detail label="Scheduled" value={formatDateTime(selected.job.scheduled_for, timeZone, dateFormat)} />
              <Detail label="Available" value={formatDateTime(selected.job.available_at, timeZone, dateFormat)} />
              <Detail label="Claimed" value={formatDateTime(selected.job.claimed_at, timeZone, dateFormat)} />
              <Detail label="Worker" value={selected.job.claimed_by_worker_id ?? "—"} />
              <Detail label="Started" value={formatDateTime(selected.job.started_at, timeZone, dateFormat)} />
              <Detail label="Completed" value={formatDateTime(selected.job.completed_at, timeZone, dateFormat)} />
              <Detail label="Attempts" value={`${selected.job.attempt_count} of ${selected.job.max_attempts}`} />
              <Detail label="Error" value={selected.job.last_error ?? "—"} />
              <Detail label="Result" value={resultText(selected.job.result)} />
            </dl>
            {selected.job.status === "pending" || selected.job.status === "retry_wait" ? (
              <form
                className="mt-4 flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(() => rescheduleOutreachJob(selected.job.id, when));
                }}
              >
                <label className="text-sm text-slate-700">
                  Reschedule
                  <input
                    type="datetime-local"
                    required
                    value={when}
                    onChange={(event) => setWhen(event.target.value)}
                    className="mt-1 block h-10 rounded-lg border border-slate-200 px-3"
                  />
                </label>
                <Button type="submit" size="sm" disabled={pending}>
                  Save time
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RowBody({
  row,
  timeZone,
  dateFormat,
  pending,
  onDetails,
  onRetry,
  onCancel,
}: {
  row: Row;
  timeZone: string;
  dateFormat: DateFormat;
  pending: boolean;
  onDetails: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <Link href={`/prospects/${row.prospect.id}`} className="font-medium text-slate-900">
        {nameOf(row.prospect)}
      </Link>
      <p className="text-xs text-slate-500">@{row.prospect.instagram_username}</p>
      <p className="mt-2 text-sm text-slate-700">
        {JOB_TYPE_LABELS[row.job.job_type]} · {stepStatus(row.job)}
      </p>
      <p className="text-xs text-slate-500">{scheduleLabel(row.job, timeZone, dateFormat)}</p>
      <div className="mt-3">
        <RowActions row={row} pending={pending} onDetails={onDetails} onRetry={onRetry} onCancel={onCancel} />
      </div>
    </div>
  );
}

function RowActions({
  row,
  pending,
  onDetails,
  onRetry,
  onCancel,
}: {
  row: Row;
  pending: boolean;
  onDetails: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const profile = row.prospect.profile_url || instagramProfileUrl(row.prospect.instagram_username);
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/prospects/${row.prospect.id}`} className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-800">
        View prospect
      </Link>
      <a href={profile} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-800">
        Open Instagram
      </a>
      <Button size="sm" variant="secondary" onClick={onDetails}>
        View job details
      </Button>
      {row.job.status === "failed" ? (
        <Button size="sm" disabled={pending} onClick={onRetry}>
          Retry
        </Button>
      ) : null}
      {row.job.status === "pending" || row.job.status === "retry_wait" || row.job.status === "claimed" ? (
        <Button size="sm" variant="danger" disabled={pending} onClick={onCancel}>
          Cancel job
        </Button>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

function buildRows(jobs: OutreachJobRow[], prospects: QueueProspect[]): Row[] {
  const byProspect = new Map<string, OutreachJobRow[]>();
  for (const job of jobs) {
    const list = byProspect.get(job.prospect_id) ?? [];
    list.push(job);
    byProspect.set(job.prospect_id, list);
  }
  const people = new Map(prospects.map((prospect) => [prospect.id, prospect]));
  const rows: Row[] = [];
  for (const [prospectId, list] of byProspect) {
    const prospect = people.get(prospectId);
    if (!prospect) continue;
    const ordered = [...list].sort((left, right) => left.sequence_order - right.sequence_order);
    const current =
      ordered.find((job) => job.status !== "completed" && job.status !== "cancelled") ??
      ordered[ordered.length - 1];
    if (!current) continue;
    rows.push({ prospect, job: current, jobs: ordered });
    for (const job of ordered) {
      if (job.status === "cancelled" && job.id !== current.id) {
        rows.push({ prospect, job, jobs: ordered });
      }
    }
  }
  return rows.sort((left, right) => left.job.scheduled_for.localeCompare(right.job.scheduled_for));
}

function matchesTab(status: OutreachJobStatus, tab: TabId) {
  if (tab === "all") return true;
  if (tab === "upcoming") return status === "pending" || status === "retry_wait";
  if (tab === "progress") return status === "claimed" || status === "running";
  if (tab === "failed") return status === "failed";
  if (tab === "cancelled") return status === "cancelled";
  return status === "completed";
}

function stepStatus(job: OutreachJobRow) {
  return queueFollowStatusLabel(job) ?? JOB_STATUS_LABELS[job.status];
}

function scheduleLabel(job: OutreachJobRow, timeZone: string, dateFormat: DateFormat) {
  if (job.status === "running" || job.status === "claimed") return "In progress";
  return formatDateTime(job.scheduled_for, timeZone, dateFormat);
}

function nameOf(prospect: QueueProspect) {
  return prospect.display_name || prospect.first_name || prospect.instagram_username;
}

function localDay(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return parts;
}

function resultText(result: Json | null) {
  if (!result) return "—";
  try {
    return JSON.stringify(result);
  } catch {
    return "—";
  }
}

