"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ExternalLink, Inbox } from "lucide-react";
import { toast } from "sonner";
import { approveProspects, requeueProspects, skipProspects } from "@/lib/actions/prospects";
import { bulkProspectActions } from "@/lib/outreach/requeue";
import { AnalyzeSelectedButton } from "@/components/prospects/qualify-controls";
import { TableOptions } from "@/components/prospects/table-options";
import { canApprove, canSkip } from "@/lib/prospects/status";
import type { FitLabel, ProspectStatus } from "@/lib/constants/prospects";
import { FIT_LABELS_TEXT, STATUS_LABELS } from "@/lib/constants/prospects";
import { Avatar } from "@/components/ui/avatar";
import { FitBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AVATAR_SIZE_PX,
  CHECKBOX_COLUMN_WIDTH,
  COLUMN_LABELS,
  COLUMN_RESIZE_STEP,
  MAX_ROW_HEIGHT,
  MAX_WIDTHS,
  MIN_ROW_HEIGHT,
  MIN_WIDTHS,
  ROW_RESIZE_STEP,
  TRUNCATE_CLASS,
  adjustColumnWidth,
  columnsForRender,
  defaultTableLayout,
  dropIndexForPointer,
  isReorderableColumn,
  loadTableLayout,
  reorderColumn,
  resolveColumnWidth,
  saveTableLayout,
  setColumnWidth,
  setRowHeight,
  tablePixelWidth,
  PROSPECTS_TABLE_LAYOUT_KEY,
  type ColumnId,
  type TableLayout,
} from "@/lib/prospects/table-layout";
import { cn } from "@/lib/utils/cn";

const SERVER_LAYOUT = defaultTableLayout();
const LAYOUT_EVENT = "shootportal-outreach:prospects-table-layout";
let snapshotRaw: string | null | undefined;
let snapshotLayout = SERVER_LAYOUT;

function layoutSnapshot() {
  const raw = window.localStorage.getItem(PROSPECTS_TABLE_LAYOUT_KEY);
  if (raw === snapshotRaw) return snapshotLayout;
  snapshotRaw = raw;
  snapshotLayout = loadTableLayout(window.localStorage);
  return snapshotLayout;
}

function subscribeLayout(onChange: () => void) {
  window.addEventListener(LAYOUT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LAYOUT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function commitLayout(recipe: (current: TableLayout) => TableLayout) {
  saveTableLayout(window.localStorage, recipe(layoutSnapshot()));
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

export type ProspectTableRow = {
  id: string;
  name: string;
  username: string;
  category: string;
  followers: string;
  following: "Yes" | "No" | "Requested" | "Unknown";
  fitLabel: FitLabel | null;
  fitScore: number | null;
  status: ProspectStatus;
  source: string;
  discovered: string;
  profileUrl: string;
  pictureUrl: string | null;
  reason: string;
  message: string;
  canRequeue?: boolean;
  nextScheduled?: string | null;
};

export function ProspectsTable({
  rows,
  filtered,
  view = "active",
}: {
  rows: ProspectTableRow[];
  filtered: boolean;
  view?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmSkip, setConfirmSkip] = useState<string[] | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<string[] | null>(null);
  const [confirmRequeue, setConfirmRequeue] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const layout = useSyncExternalStore(subscribeLayout, layoutSnapshot, () => SERVER_LAYOUT);
  const [dragging, setDragging] = useState<ColumnId | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const headerRefs = useRef<Partial<Record<ColumnId, HTMLTableCellElement>>>({});
  const dropIndexRef = useRef<number | null>(null);
  const ignoreRowClick = useRef(false);

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
  const columns = columnsForRender(layout);
  const tableWidth = tablePixelWidth(layout);

  function toggleAll() {
    setSelected(allSelected ? [] : rows.map((row) => row.id));
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function runBulk(
    ids: string[],
    action: (ids: string[]) => Promise<{ ok: boolean; error?: string; message?: string }>,
    close: () => void,
  ) {
    startTransition(async () => {
      const result = await action(ids);
      if (!result.ok) {
        toast.error(result.error ?? "That action failed.");
        return;
      }
      toast.success(result.message ?? "Updated");
      setSelected([]);
      close();
      router.refresh();
    });
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

  function beginColumnResize(event: React.PointerEvent<HTMLElement>, id: ColumnId) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = layoutSnapshot().widths[id];
    handle.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      commitLayout((current) => ({
        ...current,
        widths: setColumnWidth(current.widths, id, startWidth + pointer.clientX - startX),
      }));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function resizeColumnFromKeyboard(event: React.KeyboardEvent<HTMLElement>, id: ColumnId) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? COLUMN_RESIZE_STEP : -COLUMN_RESIZE_STEP;
    commitLayout((current) => ({ ...current, widths: adjustColumnWidth(current.widths, id, delta) }));
  }

  function beginRowResize(event: React.PointerEvent<HTMLElement>, fromBody = false) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startY = event.clientY;
    const startHeight = layoutSnapshot().rowHeight;
    handle.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      commitLayout((current) => ({ ...current, rowHeight: setRowHeight(startHeight + pointer.clientY - startY) }));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (!fromBody) return;
      ignoreRowClick.current = true;
      window.setTimeout(() => {
        ignoreRowClick.current = false;
      }, 0);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function resizeRowFromKeyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? ROW_RESIZE_STEP : -ROW_RESIZE_STEP;
    commitLayout((current) => ({ ...current, rowHeight: setRowHeight(current.rowHeight + delta) }));
  }

  function beginColumnDrag(event: React.PointerEvent<HTMLElement>, id: ColumnId) {
    if (!isReorderableColumn(id)) return;
    if ((event.target as HTMLElement).closest("[data-resize]")) return;
    const startX = event.clientX;
    let active = false;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      if (!active && Math.abs(pointer.clientX - startX) < 4) return;
      active = true;
      const current = layoutSnapshot();
      const rects = columnsForRender(current).flatMap((columnId) => {
        const cell = headerRefs.current[columnId];
        if (!cell) return [];
        const rect = cell.getBoundingClientRect();
        return [{ id: columnId, left: rect.left, right: rect.right }];
      });
      const index = dropIndexForPointer(pointer.clientX, current.order, rects);
      dropIndexRef.current = index;
      setDragging(id);
      setDropIndex(index);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (active && dropIndexRef.current !== null) {
        const index = dropIndexRef.current;
        commitLayout((current) => ({ ...current, order: reorderColumn(current.order, id, index) }));
      }
      dropIndexRef.current = null;
      setDragging(null);
      setDropIndex(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  const chosen = rows.filter((row) => selected.includes(row.id));
  const bulk = bulkProspectActions(
    chosen.map((row) => ({
      id: row.id,
      status: row.status,
      canRequeue: Boolean(row.canRequeue),
      canSkip: canSkip(row.status),
      canApprove: canApprove(row.status),
    })),
  );
  const visibleReviewIds = rows.filter((row) => canApprove(row.status)).map((row) => row.id);

  return (
    <div>
      {view === "review" && visibleReviewIds.length > 0 ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" disabled={pending} onClick={() => setConfirmApprove(visibleReviewIds)}>
            Approve all visible
          </Button>
        </div>
      ) : null}
      {selected.length > 0 ? (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm text-slate-700">{selected.length} selected</p>
          <div className="flex flex-wrap gap-2">
            <AnalyzeSelectedButton
              rows={chosen.map((row) => ({ id: row.id, status: row.status }))}
            />
            {bulk.approveIds.length > 0 ? (
              <Button size="sm" disabled={pending} onClick={() => setConfirmApprove(bulk.approveIds)}>
                Approve selected
              </Button>
            ) : null}
            {bulk.requeueIds.length > 0 ? (
              <Button size="sm" disabled={pending} onClick={() => setConfirmRequeue(bulk.requeueIds)}>
                Requeue selected
              </Button>
            ) : null}
            {bulk.skipIds.length > 0 ? (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirmSkip(bulk.skipIds)}>
                Skip selected
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mb-2 hidden justify-end md:flex">
        <TableOptions layout={layout} onChange={(next) => commitLayout(() => next)} />
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table
          className="border-separate border-spacing-0 text-left text-sm"
          style={{ width: tableWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: CHECKBOX_COLUMN_WIDTH }} />
            {columns.map((id) => (
              <col key={id} style={{ width: resolveColumnWidth(layout, id) }} />
            ))}
          </colgroup>
          <thead className="text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th
                className="sticky left-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-3"
                style={{ width: CHECKBOX_COLUMN_WIDTH, height: layout.rowHeight }}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all prospects on this page"
                />
              </th>
              {columns.map((id, index) => (
                <th
                  key={id}
                  ref={(node) => {
                    if (node) headerRefs.current[id] = node;
                    else delete headerRefs.current[id];
                  }}
                  scope="col"
                  aria-grabbed={dragging === id}
                  className={cn(
                    "border-b border-slate-200 bg-slate-50 p-0 font-medium",
                    id === "actions" ? "sticky right-0 z-30 border-l border-slate-200" : "relative",
                    dragging === id && "bg-indigo-50 text-indigo-700",
                    dropIndex === index && dragging && dragging !== id && "shadow-[inset_2px_0_0_0_#4F46E5]",
                  )}
                  style={{ width: layout.widths[id], height: layout.rowHeight }}
                >
                  <div
                    className={cn(
                      "flex h-full min-w-0 select-none items-center px-2",
                      isReorderableColumn(id) ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default",
                    )}
                    onPointerDown={(event) => beginColumnDrag(event, id)}
                  >
                    <span className={TRUNCATE_CLASS}>{COLUMN_LABELS[id]}</span>
                  </div>
                  <div
                    data-resize="column"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${COLUMN_LABELS[id]} column`}
                    aria-valuemin={MIN_WIDTHS[id]}
                    aria-valuemax={MAX_WIDTHS[id]}
                    aria-valuenow={layout.widths[id]}
                    tabIndex={0}
                    className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none hover:bg-indigo-500 focus:bg-indigo-500"
                    onPointerDown={(event) => beginColumnResize(event, id)}
                    onKeyDown={(event) => resizeColumnFromKeyboard(event, id)}
                  />
                  <div
                    data-resize="row"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize row height"
                    aria-valuemin={MIN_ROW_HEIGHT}
                    aria-valuemax={MAX_ROW_HEIGHT}
                    aria-valuenow={layout.rowHeight}
                    tabIndex={index === 0 ? 0 : -1}
                    className="absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-row-resize touch-none hover:bg-indigo-500 focus:bg-indigo-500"
                    onPointerDown={beginRowResize}
                    onKeyDown={index === 0 ? resizeRowFromKeyboard : undefined}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="group cursor-pointer"
                onClick={(event) => {
                  if (ignoreRowClick.current) {
                    ignoreRowClick.current = false;
                    return;
                  }
                  const target = event.target as HTMLElement;
                  if (target.closest("a, button, input, label, [data-resize]")) return;
                  router.push(`/prospects/${row.id}`);
                }}
              >
                <td
                  className="sticky left-0 z-20 border-b border-r border-slate-100 bg-white p-0 group-hover:bg-slate-50"
                  style={{ height: layout.rowHeight }}
                >
                  <div className="flex w-full items-center overflow-hidden px-3" style={{ height: layout.rowHeight }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select @${row.username}`}
                    />
                  </div>
                  <div
                    data-resize="row"
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 z-0 h-1.5 cursor-row-resize"
                    onPointerDown={(event) => beginRowResize(event, true)}
                  />
                </td>
                {columns.map((id) => (
                  <td
                    key={id}
                    className={cn(
                      "border-b border-slate-100 bg-white p-0 group-hover:bg-slate-50",
                      id === "actions" ? "sticky right-0 z-20 border-l border-slate-100" : "relative",
                    )}
                    style={{ height: layout.rowHeight, width: layout.widths[id] }}
                  >
                    <div className="flex w-full min-w-0 items-center overflow-hidden px-2" style={{ height: layout.rowHeight }}>
                      <ColumnCell row={row} column={id} onSkip={() => setConfirmSkip([row.id])} />
                    </div>
                    <div
                      data-resize="row"
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 z-0 h-1.5 cursor-row-resize"
                      onPointerDown={(event) => beginRowResize(event, true)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
              <Meta label="Following" value={row.following} />
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
        description="Skipped prospects leave the review queue. This does not contact Instagram. Prospects that cannot be skipped are left unchanged."
        confirmLabel="Skip"
        tone="danger"
        pending={pending}
        onClose={() => setConfirmSkip(null)}
        onConfirm={() => {
          if (confirmSkip) skip(confirmSkip);
        }}
      />
      <ConfirmDialog
        open={confirmApprove !== null}
        title={confirmApprove && confirmApprove.length === visibleReviewIds.length && view === "review" && selected.length === 0
          ? `Approve ${confirmApprove.length} visible prospects?`
          : `Approve ${confirmApprove?.length ?? 0} eligible prospects?`}
        description="This uses the same approval as Review Queue. Each eligible prospect is approved, the message is locked, and outreach is scheduled. Prospects that are not in review are left unchanged."
        confirmLabel="Approve"
        pending={pending}
        onClose={() => setConfirmApprove(null)}
        onConfirm={() => {
          if (confirmApprove) runBulk(confirmApprove, approveProspects, () => setConfirmApprove(null));
        }}
      />
      <ConfirmDialog
        open={confirmRequeue !== null}
        title={`Requeue outreach for ${confirmRequeue?.length ?? 0} prospects?`}
        description="A new outreach sequence is created from the locked message. Cancelled history stays. Prospects that are already queued are left unchanged."
        confirmLabel="Requeue"
        pending={pending}
        onClose={() => setConfirmRequeue(null)}
        onConfirm={() => {
          if (confirmRequeue) runBulk(confirmRequeue, requeueProspects, () => setConfirmRequeue(null));
        }}
      />
    </div>
  );
}

function ColumnCell({
  row,
  column,
  onSkip,
}: {
  row: ProspectTableRow;
  column: ColumnId;
  onSkip: () => void;
}) {
  if (column === "profile") {
    return (
      <span className="inline-flex shrink-0" style={{ width: AVATAR_SIZE_PX, height: AVATAR_SIZE_PX }}>
        <Avatar name={row.name} src={row.pictureUrl} size="sm" />
      </span>
    );
  }
  if (column === "username") {
    return (
      <Link href={`/prospects/${row.id}`} title={`@${row.username}`} className={cn(TRUNCATE_CLASS, "font-medium text-slate-900 hover:text-indigo-700")}>
        @{row.username}
      </Link>
    );
  }
  if (column === "name") return <span title={row.name} className={cn(TRUNCATE_CLASS, "text-slate-700")}>{row.name}</span>;
  if (column === "category") return <span title={row.category} className={cn(TRUNCATE_CLASS, "text-slate-600")}>{row.category}</span>;
  if (column === "followers") {
    return <span title={row.followers} className={cn(TRUNCATE_CLASS, "tabular-nums text-slate-700")}>{row.followers}</span>;
  }
  if (column === "following") return <FollowingBadge value={row.following} />;
  if (column === "fit") {
    const label = row.fitLabel ? FIT_LABELS_TEXT[row.fitLabel] : "Unscored";
    return (
      <span title={`${row.fitScore ?? "—"} ${label}`} className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="shrink-0 tabular-nums font-medium text-slate-900">{row.fitScore ?? "—"}</span>
        <span className="min-w-0 truncate">
          <FitBadge label={row.fitLabel} />
        </span>
      </span>
    );
  }
  if (column === "reason") return <span title={row.reason} className={cn(TRUNCATE_CLASS, "text-slate-600")}>{row.reason}</span>;
  if (column === "status") {
    return (
      <span title={row.nextScheduled ? `Scheduled outreach: ${row.nextScheduled}` : STATUS_LABELS[row.status]} className="block min-w-0">
        <span className="block truncate">
          <StatusBadge status={row.status} />
        </span>
        {row.nextScheduled ? (
          <span className="mt-1 block truncate text-xs text-slate-500">Scheduled {row.nextScheduled}</span>
        ) : null}
      </span>
    );
  }
  if (column === "source") return <span title={row.source} className={cn(TRUNCATE_CLASS, "text-slate-600")}>{row.source}</span>;
  if (column === "discovered") return <span title={row.discovered} className={cn(TRUNCATE_CLASS, "text-slate-600")}>{row.discovered}</span>;
  return <RowActions row={row} onSkip={onSkip} compact />;
}

function RowActions({
  row,
  onSkip,
  compact = false,
}: {
  row: ProspectTableRow;
  onSkip: () => void;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function approve() {
    startTransition(async () => {
      const result = await approveProspects([row.id]);
      if (result.ok) toast.success(result.message ?? "Prospect approved");
      else toast.error(result.error);
    });
  }

  return (
    <div className={cn("flex items-center gap-1", compact ? "max-w-full flex-nowrap overflow-hidden" : "flex-wrap")}>
      <Link href={`/prospects/${row.id}`} className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
        View
      </Link>
      {canApprove(row.status) ? (
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
        >
          Approve
        </button>
      ) : null}
      {row.canRequeue ? (
        <button
          type="button"
          onClick={() => {
            startTransition(async () => {
              const result = await requeueProspects([row.id]);
              if (result.ok) toast.success(result.message ?? "Outreach was requeued.");
              else toast.error(result.error);
            });
          }}
          disabled={pending}
          className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
        >
          Requeue
        </button>
      ) : null}
      <a
        href={row.profileUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
        aria-label={`Open @${row.username} on Instagram`}
      >
        Instagram
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
      <span className="shrink-0">
        <CopyButton value={row.message} label="Copy message" />
      </span>
      <button
        type="button"
        onClick={onSkip}
        disabled={!canSkip(row.status)}
        className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
      >
        Skip
      </button>
    </div>
  );
}

function FollowingBadge({ value }: { value: ProspectTableRow["following"] }) {
  const tone = {
    Yes: "bg-slate-100 text-slate-700 ring-slate-200",
    No: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    Requested: "bg-amber-50 text-amber-800 ring-amber-200",
    Unknown: "bg-slate-50 text-slate-500 ring-slate-200",
  }[value];
  return <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", tone)}>{value}</span>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
