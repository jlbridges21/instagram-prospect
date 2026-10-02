export const PROSPECTS_TABLE_LAYOUT_KEY = "shootportal-outreach:prospects-table-layout:v1";

export const CHECKBOX_COLUMN_WIDTH = 44;
export const AVATAR_SIZE_PX = 32;
export const DEFAULT_ROW_HEIGHT = 52;
export const MIN_ROW_HEIGHT = 40;
export const MAX_ROW_HEIGHT = 140;
export const COLUMN_RESIZE_STEP = 8;
export const ROW_RESIZE_STEP = 4;

export const COLUMN_IDS = [
  "profile",
  "username",
  "name",
  "category",
  "followers",
  "following",
  "fit",
  "reason",
  "status",
  "source",
  "discovered",
  "actions",
] as const;

export type ColumnId = (typeof COLUMN_IDS)[number];

export const COLUMN_LABELS: Record<ColumnId, string> = {
  profile: "Profile",
  username: "Username",
  name: "Name",
  category: "Category",
  followers: "Followers",
  following: "Following",
  fit: "Fit",
  reason: "Reason",
  status: "Status",
  source: "Source",
  discovered: "Discovered",
  actions: "Actions",
};

export const DEFAULT_WIDTHS: Record<ColumnId, number> = {
  profile: 52,
  username: 148,
  name: 168,
  category: 140,
  followers: 96,
  following: 104,
  fit: 128,
  reason: 260,
  status: 124,
  source: 120,
  discovered: 124,
  actions: 360,
};

export const MIN_WIDTHS: Record<ColumnId, number> = {
  profile: 44,
  username: 120,
  name: 120,
  category: 110,
  followers: 80,
  following: 88,
  fit: 75,
  reason: 180,
  status: 100,
  source: 90,
  discovered: 105,
  actions: 110,
};

export const MAX_WIDTHS: Record<ColumnId, number> = {
  profile: 80,
  username: 360,
  name: 420,
  category: 280,
  followers: 160,
  following: 140,
  fit: 220,
  reason: 640,
  status: 200,
  source: 240,
  discovered: 220,
  actions: 520,
};

export const DEFAULT_ORDER: ColumnId[] = [...COLUMN_IDS];

export const ROW_PRESETS = [
  { id: "compact", label: "Compact", height: 44 },
  { id: "normal", label: "Normal", height: 52 },
  { id: "comfortable", label: "Comfortable", height: 64 },
] as const;

export const TRUNCATE_CLASS = "block min-w-0 truncate whitespace-nowrap";

export type TableLayout = {
  order: ColumnId[];
  widths: Record<ColumnId, number>;
  rowHeight: number;
};

export type LayoutStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const COLUMN_ID_SET = new Set<string>(COLUMN_IDS);

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && COLUMN_ID_SET.has(value);
}

export function isReorderableColumn(id: ColumnId) {
  return id !== "actions";
}

export function defaultTableLayout(): TableLayout {
  return {
    order: [...DEFAULT_ORDER],
    widths: { ...DEFAULT_WIDTHS },
    rowHeight: DEFAULT_ROW_HEIGHT,
  };
}

export function clampColumnWidth(id: ColumnId, width: number) {
  if (!Number.isFinite(width)) return DEFAULT_WIDTHS[id];
  return Math.min(MAX_WIDTHS[id], Math.max(MIN_WIDTHS[id], Math.round(width)));
}

export function clampRowHeight(height: number) {
  if (!Number.isFinite(height)) return DEFAULT_ROW_HEIGHT;
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.round(height)));
}

export function setColumnWidth(widths: Record<ColumnId, number>, id: ColumnId, width: number) {
  return { ...widths, [id]: clampColumnWidth(id, width) };
}

export function adjustColumnWidth(widths: Record<ColumnId, number>, id: ColumnId, delta: number) {
  return setColumnWidth(widths, id, widths[id] + delta);
}

export function setRowHeight(height: number) {
  return clampRowHeight(height);
}

function pinActions(order: ColumnId[]) {
  return [...order.filter((id) => id !== "actions"), "actions" as const];
}

export function mergeColumnOrder(saved: unknown): ColumnId[] {
  const known = Array.isArray(saved) ? saved.filter(isColumnId) : [];
  const unique: ColumnId[] = [];
  for (const id of known) {
    if (!unique.includes(id)) unique.push(id);
  }
  for (const id of DEFAULT_ORDER) {
    if (id === "actions" || unique.includes(id)) continue;
    let insertAt = 0;
    for (let index = DEFAULT_ORDER.indexOf(id) - 1; index >= 0; index -= 1) {
      const previous = unique.indexOf(DEFAULT_ORDER[index]);
      if (previous !== -1) {
        insertAt = previous + 1;
        break;
      }
    }
    unique.splice(insertAt, 0, id);
  }
  return pinActions(unique);
}

export function normalizeTableLayout(input: unknown): TableLayout {
  const defaults = defaultTableLayout();
  if (!input || typeof input !== "object") return defaults;
  const raw = input as { order?: unknown; widths?: unknown; rowHeight?: unknown };
  const order = mergeColumnOrder(raw.order);
  const widths = { ...defaults.widths };
  if (raw.widths && typeof raw.widths === "object") {
    for (const id of COLUMN_IDS) {
      const value = (raw.widths as Record<string, unknown>)[id];
      if (typeof value === "number") widths[id] = clampColumnWidth(id, value);
    }
  }
  return {
    order,
    widths,
    rowHeight: typeof raw.rowHeight === "number" ? clampRowHeight(raw.rowHeight) : defaults.rowHeight,
  };
}

export function reorderColumn(order: ColumnId[], id: ColumnId, targetIndex: number) {
  if (!isReorderableColumn(id)) return pinActions(order);
  const from = order.indexOf(id);
  if (from < 0) return pinActions(order);
  const without = order.filter((column) => column !== id && column !== "actions");
  const index = Math.max(0, Math.min(targetIndex > from ? targetIndex - 1 : targetIndex, without.length));
  without.splice(index, 0, id);
  return pinActions(without);
}

export function nudgeColumn(order: ColumnId[], id: ColumnId, direction: -1 | 1) {
  const from = order.indexOf(id);
  if (from < 0) return pinActions(order);
  const target = from + direction;
  if (target < 0 || target >= order.length || order[target] === "actions") return pinActions(order);
  return reorderColumn(order, id, target);
}

export function placeColumnBefore(order: ColumnId[], id: ColumnId, beforeId: ColumnId) {
  return reorderColumn(order, id, order.indexOf(beforeId));
}

export type ColumnRect = { id: ColumnId; left: number; right: number };

export function dropIndexForPointer(clientX: number, order: ColumnId[], rects: ColumnRect[]) {
  const movable = rects.filter((rect) => rect.id !== "actions");
  for (const rect of movable) {
    const midpoint = (rect.left + rect.right) / 2;
    if (clientX < midpoint) return order.indexOf(rect.id);
  }
  const actionsIndex = order.indexOf("actions");
  return actionsIndex === -1 ? order.length : actionsIndex;
}

export function resolveColumnWidth(layout: TableLayout, id: ColumnId) {
  return layout.widths[id];
}

export function tablePixelWidth(layout: TableLayout) {
  return CHECKBOX_COLUMN_WIDTH + layout.order.reduce((sum, id) => sum + layout.widths[id], 0);
}

export function columnsForRender(layout: TableLayout) {
  return layout.order;
}

export function resetColumnWidths(layout: TableLayout): TableLayout {
  return { ...layout, widths: { ...DEFAULT_WIDTHS } };
}

export function resetColumnOrder(layout: TableLayout): TableLayout {
  return { ...layout, order: [...DEFAULT_ORDER] };
}

export function resetTableLayout() {
  return defaultTableLayout();
}

export function loadTableLayout(storage: LayoutStorage | null) {
  if (!storage) return defaultTableLayout();
  try {
    const raw = storage.getItem(PROSPECTS_TABLE_LAYOUT_KEY);
    if (!raw) return defaultTableLayout();
    return normalizeTableLayout(JSON.parse(raw));
  } catch {
    return defaultTableLayout();
  }
}

export function saveTableLayout(storage: LayoutStorage, layout: TableLayout) {
  storage.setItem(PROSPECTS_TABLE_LAYOUT_KEY, JSON.stringify(normalizeTableLayout(layout)));
}
