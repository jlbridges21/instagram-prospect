import assert from "node:assert/strict";
import fs from "node:fs";
import { FILTER_PANEL_DEFAULT_OPEN, activeFilterCount, filterButtonLabel, toggleFilterPanel } from "../lib/prospects/filter-panel";
import {
  GLOBE_NODE_CAP,
  arcSamples,
  avatarMark,
  createFrameLoop,
  globeMotion,
  selectGlobeProspects,
  simulatedCoordinates,
} from "../lib/visual/globe";

assert.equal(FILTER_PANEL_DEFAULT_OPEN, false);
assert.equal(toggleFilterPanel(false), true);
assert.equal(toggleFilterPanel(true), false);
assert.equal(filterButtonLabel(false, 0), "Filter");
assert.equal(filterButtonLabel(false, 3), "Filter · 3");
assert.equal(filterButtonLabel(true, 3), "Hide filters");

const query = {
  q: "drone",
  status: "all",
  fit: "strong_fit",
  category: "",
  source: "manual",
  minFollowers: "",
  maxFollowers: "5000",
  sort: "newest",
};
assert.equal(activeFilterCount(query), 4);
assert.equal(activeFilterCount({ ...query, q: "  ", fit: "all", source: "", maxFollowers: "", sort: "newest" }), 0);
assert.equal(activeFilterCount({ ...query, q: "", fit: "all", source: "", maxFollowers: "", sort: "fit" }), 1);
const before = JSON.stringify(query);
toggleFilterPanel(false);
assert.equal(JSON.stringify(query), before);

const filters = fs.readFileSync(new URL("../components/prospects/prospect-filters.tsx", import.meta.url), "utf8");
assert.match(filters, /useState\(FILTER_PANEL_DEFAULT_OPEN\)/);
assert.match(filters, /method="get"/);
assert.match(filters, /Clear filters/);
assert.match(filters, /href="\/prospects"/);
assert.match(filters, /flex-col gap-2 sm:flex-row/);
assert.match(filters, /duration-200/);
assert.match(filters, /motion-reduce:transition-none/);

const first = simulatedCoordinates("perspective.tx");
const again = simulatedCoordinates("@perspective.tx");
assert.deepEqual(first, again);
assert.ok(first.lat >= -58 && first.lat <= 68);
assert.ok(first.lon >= -180 && first.lon <= 180);
const names = Array.from({ length: 40 }, (_, index) => `operator${index}`);
const points = names.map((name) => simulatedCoordinates(name));
const lats = points.map((point) => point.lat);
const lons = points.map((point) => point.lon);
assert.ok(Math.max(...lons) - Math.min(...lons) > 100);
assert.ok(Math.max(...lats) - Math.min(...lats) > 20);
assert.notDeepEqual(simulatedCoordinates("alpha"), simulatedCoordinates("beta"));

const rows = [
  { id: "new", status: "discovered", fitLabel: null, discoveredAt: "2026-10-05T00:00:00.000Z" },
  { id: "review", status: "review", fitLabel: "possible_fit", discoveredAt: "2026-01-01T00:00:00.000Z" },
  { id: "approved", status: "approved", fitLabel: null, discoveredAt: "2026-01-01T00:00:00.000Z" },
  { id: "strong", status: "discovered", fitLabel: "strong_fit", discoveredAt: "2026-02-01T00:00:00.000Z" },
  { id: "contacted", status: "contacted", fitLabel: null, discoveredAt: "2026-01-01T00:00:00.000Z" },
];
const capped = selectGlobeProspects(rows, 3);
assert.equal(capped.length, 3);
assert.deepEqual(capped.map((row) => row.id), ["review", "approved", "contacted"]);
assert.equal(selectGlobeProspects(rows, GLOBE_NODE_CAP).length, rows.length);

assert.equal(avatarMark("Ada Lovelace", "ada"), "AL");
assert.equal(avatarMark("", "sp"), "SP");
assert.equal(avatarMark("", ""), "SP");

const selected = capped.find((row) => row.id === "approved");
assert.equal(selected?.id, "approved");

const arc = arcSamples({ lat: 40, lon: -100 }, { lat: 48, lon: 10 }, 1, 32);
const mid = arc[Math.floor(arc.length / 2)];
assert.ok(mid);
assert.ok(Math.hypot(mid.x, mid.y, mid.z) > 1.05);

assert.equal(globeMotion({ reducedMotion: false, hidden: true, dragging: false, idleMs: 10_000 }).render, false);
assert.equal(globeMotion({ reducedMotion: true, hidden: false, dragging: false, idleMs: 10_000 }).autoRotate, false);
assert.equal(globeMotion({ reducedMotion: false, hidden: false, dragging: true, idleMs: 10_000 }).autoRotate, false);

let cancelled = 0;
const frames: Array<() => void> = [];
const loop = createFrameLoop(
  (callback) => {
    frames.push(callback);
    return frames.length;
  },
  () => {
    cancelled += 1;
  },
);
loop.start(() => true);
assert.equal(frames.length, 1);
frames[0]?.();
loop.stop();
assert.equal(cancelled, 1);

const globeEntry = fs.readFileSync(new URL("../components/home/global-network.tsx", import.meta.url), "utf8");
const overview = fs.readFileSync(new URL("../app/(dashboard)/page.tsx", import.meta.url), "utf8");
const fallback = fs.readFileSync(new URL("../components/home/prospect-globe.tsx", import.meta.url), "utf8");
assert.match(globeEntry, /ssr:\s*false/);
assert.doesNotMatch(overview, /from "three"/);
assert.match(fallback, /This browser cannot draw the interactive globe/);
assert.match(fs.readFileSync(new URL("../components/home/overview-stage.tsx", import.meta.url), "utf8"), /locations are not derived from user data/);

console.log("globe and filter ui tests passed");
