"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { approveProspects, requeueProspects, skipProspects } from "@/lib/actions/prospects";
import { FIT_LABELS, FIT_LABELS_TEXT, SOURCE_LABELS, type FitLabel, type ProspectStatus } from "@/lib/constants/prospects";
import type { ProspectQuery } from "@/lib/db/prospects";
import { canApprove, canSkip } from "@/lib/prospects/status";
import type { ProspectTabId } from "@/lib/prospects/tabs";
import { prospectSearchString } from "@/lib/utils/prospect-search";
import { cn } from "@/lib/utils/cn";

export type MobileProspect = {
  id: string;
  name: string;
  username: string;
  followers: string;
  fitLabel: FitLabel | null;
  fitScore: number | null;
  status: ProspectStatus;
  reason: string;
  category: string;
  source: string;
  pictureUrl: string | null;
  profileUrl: string;
  message: string;
  canRequeue: boolean;
};

const PRIMARY_TABS: Array<{ id: ProspectTabId; label: string }> = [
  { id: "review", label: "Review" },
  { id: "approved", label: "Approved" },
  { id: "contacted", label: "Contacted" },
  { id: "excluded", label: "Excluded" },
];

export function MobileProspects({
  rows,
  query,
  counts,
  page,
  pageCount,
  empty,
  title = "Prospects",
  subtitle = "Review and approve potential prospects.",
}: {
  rows: MobileProspect[];
  query: ProspectQuery;
  counts: Partial<Record<ProspectTabId | "all", number>>;
  page: number;
  pageCount: number;
  empty: string;
  title?: string;
  subtitle?: string;
}) {
  const [filters, setFilters] = useState(false);
  const [selected, setSelected] = useState<MobileProspect | null>(null);

  return (
    <div className="md:hidden">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-50">{title}</h1>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      <div className="sticky z-20 -mx-4 mt-4 flex gap-2 overflow-x-auto bg-[#05070d]/95 px-4 py-2 backdrop-blur" role="tablist" style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}>
        {PRIMARY_TABS.map((tab) => {
          const active = query.view === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/prospects${prospectSearchString({ ...query, view: tab.id, page: 1 })}`}
              role="tab"
              aria-selected={active}
              className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium", active ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-300")}
            >
              {tab.label}
              {counts[tab.id] != null ? <span className="ml-1.5 tabular-nums opacity-80">{counts[tab.id]}</span> : null}
            </Link>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <form action="/prospects" className="min-w-0 flex-1">
          {query.view !== "review" ? <input type="hidden" name="view" value={query.view} /> : null}
          <input name="q" defaultValue={query.q} placeholder="Search prospects" className="h-12 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-slate-50 placeholder:text-slate-500" />
        </form>
        <button type="button" className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-medium text-slate-100" onClick={() => setFilters(true)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filter
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? <p className="rounded-2xl border border-white/10 px-4 py-8 text-center text-sm text-slate-400">{empty}</p> : null}
        {rows.map((row) => (
          <ProspectCard key={row.id} row={row} onOpen={() => setSelected(row)} />
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link className="inline-flex min-h-11 items-center text-indigo-300" href={`/prospects${prospectSearchString(query, page - 1)}`}>Previous</Link> : <span />}
          <span className="text-xs text-slate-500">{page} / {pageCount}</span>
          {page < pageCount ? <Link className="inline-flex min-h-11 items-center text-indigo-300" href={`/prospects${prospectSearchString(query, page + 1)}`}>Next</Link> : <span />}
        </div>
      ) : null}
      {filters ? <FilterSheet query={query} onClose={() => setFilters(false)} /> : null}
      {selected ? <DetailSheet row={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function ProspectCard({ row, onOpen }: { row: MobileProspect; onOpen: () => void }) {
  const [menu, setMenu] = useState(false);
  const fit = fitLine(row);

  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={onOpen}>
        <Avatar name={row.name} pictureUrl={row.pictureUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-50">@{row.username}</span>
          <span className="mt-0.5 block text-xs text-slate-400">{row.followers} followers</span>
        </span>
        <span className={cn("max-w-[7.5rem] shrink-0 rounded-full px-2 py-1 text-right text-[11px] font-medium leading-4", fit.className)}>{fit.badge}</span>
      </button>
      <p className="mt-3 line-clamp-3 text-sm leading-5 text-slate-300">{fit.summary}</p>
      <div className="mt-3 flex items-center gap-2">
        <CardActions row={row} />
        <button type="button" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-slate-300" aria-label={`More actions for @${row.username}`} onClick={() => setMenu(true)}>
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
      {menu ? <DetailSheet row={row} onClose={() => setMenu(false)} /> : null}
    </article>
  );
}

function CardActions({ row }: { row: MobileProspect }) {
  const [pending, startTransition] = useTransition();

  if (canApprove(row.status) || canSkip(row.status)) {
    return (
      <div className="grid flex-1 grid-cols-2 gap-2">
        {canSkip(row.status) ? (
          <button type="button" className="min-h-12 rounded-2xl border border-white/10 text-sm font-medium text-slate-100 disabled:opacity-50" disabled={pending} onClick={() => startTransition(async () => {
            const result = await skipProspects([row.id]);
            if (result.ok) toast.success("Prospect skipped");
            else toast.error(result.error);
          })}>Skip</button>
        ) : <span />}
        {canApprove(row.status) ? (
          <button type="button" className="min-h-12 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-semibold text-white disabled:opacity-50" disabled={pending} onClick={() => startTransition(async () => {
            const result = await approveProspects([row.id]);
            if (result.ok) toast.success(result.message ?? "Prospect approved");
            else toast.error(result.error);
          })}>Approve</button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-12 flex-1 items-center justify-between rounded-2xl bg-white/5 px-3 text-sm text-slate-300">
      <span className="capitalize">{row.status.replaceAll("_", " ")}</span>
      {row.canRequeue ? (
        <button type="button" className="font-medium text-indigo-300 disabled:opacity-50" disabled={pending} onClick={() => startTransition(async () => {
          const result = await requeueProspects([row.id]);
          if (result.ok) toast.success(result.message ?? "Outreach was requeued.");
          else toast.error(result.error);
        })}>Requeue</button>
      ) : null}
    </div>
  );
}

function DetailSheet({ row, onClose }: { row: MobileProspect; onClose: () => void }) {
  const fit = fitLine(row);
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close details" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b1020] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <div className="flex items-center gap-3">
          <Avatar name={row.name} pictureUrl={row.pictureUrl} />
          <div>
            <p className="text-base font-semibold text-slate-50">{row.name}</p>
            <p className="text-sm text-slate-400">@{row.username}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Fact label="Followers" value={row.followers} />
          <Fact label="Fit" value={fit.badge} />
          <Fact label="Category" value={row.category || "—"} />
          <Fact label="Source" value={row.source || "—"} />
        </dl>
        <p className="mt-4 text-sm leading-6 text-slate-300">{row.reason}</p>
        <div className="mt-4 grid gap-2">
          <a className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 text-sm font-medium text-slate-100" href={row.profileUrl} target="_blank" rel="noreferrer">Open Instagram</a>
          <button type="button" className="min-h-12 rounded-2xl border border-white/10 text-sm font-medium text-slate-100" onClick={() => {
            void navigator.clipboard.writeText(row.message);
            toast.success("Message copied");
          }}>Copy message</button>
          <Link href={`/prospects/${row.id}`} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-white/5 text-sm font-medium text-slate-100">Open full profile</Link>
        </div>
      </div>
    </div>
  );
}

function FilterSheet({ query, onClose }: { query: ProspectQuery; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close filters" onClick={onClose} />
      <form method="get" action="/prospects" className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b1020] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <p className="text-base font-semibold text-slate-50">Filter</p>
        {query.view !== "review" ? <input type="hidden" name="view" value={query.view} /> : null}
        <label className="mt-4 block text-xs text-slate-400">Search
          <input name="q" defaultValue={query.q} className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-50" />
        </label>
        <label className="mt-3 block text-xs text-slate-400">Fit
          <select name="fit" defaultValue={query.fit} className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-[#0b1020] px-3 text-sm">
            <option value="all">Any fit</option>
            {FIT_LABELS.map((label) => <option key={label} value={label}>{FIT_LABELS_TEXT[label]}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-xs text-slate-400">Source
          <select name="source" defaultValue={query.source} className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-[#0b1020] px-3 text-sm">
            <option value="">Any source</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">Min followers
            <input name="min" defaultValue={query.minFollowers} inputMode="numeric" className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm" />
          </label>
          <label className="text-xs text-slate-400">Max followers
            <input name="max" defaultValue={query.maxFollowers} inputMode="numeric" className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm" />
          </label>
        </div>
        <button type="submit" className="mt-4 min-h-12 w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-semibold text-white">Apply filters</button>
      </form>
    </div>
  );
}

function Avatar({ name, pictureUrl }: { name: string; pictureUrl: string | null }) {
  if (pictureUrl) return <img src={pictureUrl} alt="" className="h-11 w-11 rounded-full object-cover" />;
  return <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-100">{name.slice(0, 1).toUpperCase()}</span>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-100">{value}</dd>
    </div>
  );
}

function fitLine(row: MobileProspect) {
  const label = row.fitLabel ? FIT_LABELS_TEXT[row.fitLabel] : "Not analyzed";
  const score = row.fitScore == null ? "" : ` — ${row.fitScore}/100`;
  const detail = row.reason.replace(/^[^.]+\.\s*/, "") || row.reason;
  const className = row.fitLabel === "strong_fit" ? "bg-emerald-400/15 text-emerald-200" : row.fitLabel === "possible_fit" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-slate-300";
  return { badge: `${label}${score}`, summary: detail, className };
}
