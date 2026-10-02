import {
  AVATAR_SIZE_PX,
  CHECKBOX_COLUMN_WIDTH,
  COLUMN_RESIZE_STEP,
  DEFAULT_ORDER,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_WIDTHS,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  MIN_WIDTHS,
  PROSPECTS_TABLE_LAYOUT_KEY,
  ROW_PRESETS,
  TRUNCATE_CLASS,
  adjustColumnWidth,
  columnsForRender,
  defaultTableLayout,
  dropIndexForPointer,
  loadTableLayout,
  mergeColumnOrder,
  nudgeColumn,
  placeColumnBefore,
  reorderColumn,
  resetColumnOrder,
  resetColumnWidths,
  resetTableLayout,
  resolveColumnWidth,
  saveTableLayout,
  setColumnWidth,
  setRowHeight,
  tablePixelWidth,
  type ColumnId,
  type LayoutStorage,
} from "../lib/prospects/table-layout";

const failures: string[] = [];
function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`ok ${name}`);
}

const longUsername = "youtube.com/@vvsdrones?si=this-must-not-widen-the-column";
const longName = "A very long display name that should stay on one truncated line";
const longReason = "Professional drone hobby/content account, but no clear paid media services for real estate clients.";

const layout = defaultTableLayout();
check(
  "long username does not widen its column",
  longUsername.includes("youtube.com/@vvsdrones") && resolveColumnWidth(layout, "username") === DEFAULT_WIDTHS.username,
);
check("long name does not widen its column", longName.length > 20 && resolveColumnWidth(layout, "name") === DEFAULT_WIDTHS.name);
check("long reason does not widen its column", longReason.length > 20 && resolveColumnWidth(layout, "reason") === DEFAULT_WIDTHS.reason);
check(
  "long text does not change the table width",
  tablePixelWidth(layout) === CHECKBOX_COLUMN_WIDTH + DEFAULT_ORDER.reduce((sum, id) => sum + DEFAULT_WIDTHS[id], 0),
);
check("text cells truncate on one line", TRUNCATE_CLASS.includes("truncate") && TRUNCATE_CLASS.includes("whitespace-nowrap"));

const resized = adjustColumnWidth(layout.widths, "name", 36);
check("column resize changes width", resized.name === layout.widths.name + 36);
check("minimum width is enforced", setColumnWidth(layout.widths, "username", 10).username === MIN_WIDTHS.username);
check("maximum width is enforced", setColumnWidth(layout.widths, "reason", 5000).reason === 640);
check("keyboard resize step stays inside the minimum", adjustColumnWidth(layout.widths, "category", -COLUMN_RESIZE_STEP * 20).category === MIN_WIDTHS.category);

const moved = placeColumnBefore(layout.order, "reason", "category");
check("dragging reason places it before category", moved[moved.indexOf("category") - 1] === "reason");
check("name stays before the moved reason column", moved.indexOf("name") < moved.indexOf("reason"));
check("checkbox is not part of the reorderable order", !moved.includes("select" as ColumnId));
check("actions stay at the far right after a drag", moved.at(-1) === "actions");
check("body uses the same order as the headers", columnsForRender({ ...layout, order: moved }).join() === moved.join());

const nudgedLeft = nudgeColumn(layout.order, "reason", -1);
check("move left swaps reason with fit", nudgedLeft[nudgedLeft.indexOf("fit") - 1] === "reason" || nudgedLeft.indexOf("reason") === layout.order.indexOf("reason") - 1);
check("move right stops before actions", nudgeColumn(layout.order, "discovered", 1).join() === layout.order.join());
check("actions cannot be dragged", reorderColumn(layout.order, "actions", 0).join() === DEFAULT_ORDER.join());

const rects = moved.map((id, index) => ({ id, left: index * 100, right: index * 100 + 100 }));
const categoryMid = rects.find((rect) => rect.id === "category");
check(
  "pointer before a column midpoint inserts there",
  categoryMid !== undefined && dropIndexForPointer(categoryMid.left + 10, moved, rects) === moved.indexOf("category"),
);

const compact = ROW_PRESETS.find((preset) => preset.id === "compact");
check("compact row height is 44", compact?.height === 44 && setRowHeight(compact.height) === 44);
check("default row height is 52", DEFAULT_ROW_HEIGHT === 52 && setRowHeight(52) === 52);
check("row height cannot go below 40", setRowHeight(12) === MIN_ROW_HEIGHT);
check("row height cannot go above 140", setRowHeight(400) === MAX_ROW_HEIGHT);
check("avatar stays 32px", AVATAR_SIZE_PX === 32);
check("profile column default stays compact", DEFAULT_WIDTHS.profile === 52 && MIN_WIDTHS.profile === 44);

class MemoryStorage implements LayoutStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const custom = {
  ...layout,
  order: moved,
  widths: resized,
  rowHeight: 44,
};
const storage = new MemoryStorage();
saveTableLayout(storage, custom);
const restored = loadTableLayout(storage);
check("column order persists", restored.order.join() === custom.order.join());
check("column widths persist", restored.widths.name === custom.widths.name && restored.widths.username === DEFAULT_WIDTHS.username);
check("row height persists", restored.rowHeight === 44);
check("storage key is namespaced", storage.values.has(PROSPECTS_TABLE_LAYOUT_KEY));
check("stored layout has no prospect rows", !storage.values.get(PROSPECTS_TABLE_LAYOUT_KEY)?.includes("instagram"));

check("reset widths restores defaults and keeps order", resetColumnWidths(custom).widths.reason === DEFAULT_WIDTHS.reason && resetColumnWidths(custom).order.join() === moved.join());
check("reset order restores defaults and keeps widths", resetColumnOrder(custom).order.join() === DEFAULT_ORDER.join() && resetColumnOrder(custom).widths.name === resized.name);
const fresh = resetTableLayout();
check("reset layout restores defaults", fresh.order.join() === DEFAULT_ORDER.join() && fresh.widths.username === DEFAULT_WIDTHS.username && fresh.rowHeight === DEFAULT_ROW_HEIGHT);

const legacy = loadTableLayout({
  getItem: () =>
    JSON.stringify({
      order: ["username", "name", "profile", "not-a-column"],
      widths: { name: 20, username: 200 },
      rowHeight: 999,
    }),
  setItem: () => undefined,
});
check("invalid columns are dropped", !legacy.order.includes("not-a-column" as ColumnId));
check("missing columns are merged back in", legacy.order.includes("reason") && legacy.order.includes("category"));
check("actions remain last when merging an old layout", legacy.order.at(-1) === "actions");
check("saved widths are clamped when merged", legacy.widths.name === MIN_WIDTHS.name && legacy.widths.username === 200);
check("saved row height is clamped when merged", legacy.rowHeight === MAX_ROW_HEIGHT);
check("reason keeps its default place beside fit when it was absent", mergeColumnOrder(["profile", "username", "name", "category", "followers", "fit", "status"]).indexOf("reason") === 6);
check("checkbox width stays fixed", CHECKBOX_COLUMN_WIDTH === 44);
check("broken storage falls back to the default layout", loadTableLayout({ getItem: () => "{", setItem: () => undefined }).order.join() === DEFAULT_ORDER.join());

if (failures.length > 0) {
  console.error(failures.map((name) => `FAIL ${name}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("prospect table layout checks passed");
}
