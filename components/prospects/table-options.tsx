"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import {
  COLUMN_LABELS,
  ROW_PRESETS,
  isReorderableColumn,
  nudgeColumn,
  resetColumnOrder,
  resetColumnWidths,
  resetTableLayout,
  setRowHeight,
  type ColumnId,
  type TableLayout,
} from "@/lib/prospects/table-layout";
import { cn } from "@/lib/utils/cn";

export function TableOptions({
  layout,
  onChange,
}: {
  layout: TableLayout;
  onChange: (layout: TableLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState<ColumnId>("reason");
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const movable = layout.order.filter(isReorderableColumn);
  const selected = movable.find((id) => id === column) ?? movable[0];
  const selectedIndex = selected ? layout.order.indexOf(selected) : -1;
  const canMoveLeft = selectedIndex > 0;
  const canMoveRight = selectedIndex >= 0 && layout.order[selectedIndex + 1] !== "actions";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className={buttonClasses("secondary", "sm")}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Table options
      </button>
      {open ? (
        <div
          id={menuId}
          role="dialog"
          aria-label="Table options"
          className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Row height</p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {ROW_PRESETS.map((preset) => {
              const active = layout.rowHeight === preset.height;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ ...layout, rowHeight: setRowHeight(preset.height) })}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-xs font-medium",
                    active
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Move column</p>
          <div className="mt-2 flex gap-1">
            <label className="sr-only" htmlFor={`${menuId}-column`}>
              Column to move
            </label>
            <select
              id={`${menuId}-column`}
              value={selected}
              onChange={(event) => setColumn(event.target.value as ColumnId)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800"
            >
              {movable.map((id) => (
                <option key={id} value={id}>
                  {COLUMN_LABELS[id]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              disabled={!canMoveLeft || !selected}
              onClick={() => selected && onChange({ ...layout, order: nudgeColumn(layout.order, selected, -1) })}
            >
              Left
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              disabled={!canMoveRight || !selected}
              onClick={() => selected && onChange({ ...layout, order: nudgeColumn(layout.order, selected, 1) })}
            >
              Right
            </button>
          </div>
          <div className="mt-3 space-y-1 border-t border-slate-100 pt-2">
            <MenuButton onClick={() => onChange(resetColumnWidths(layout))}>Reset column widths</MenuButton>
            <MenuButton onClick={() => onChange(resetColumnOrder(layout))}>Reset column order</MenuButton>
            <MenuButton onClick={() => onChange(resetTableLayout())}>Reset table layout</MenuButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}
