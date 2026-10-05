export const GLOBE_NODE_CAP = 72;
export const GLOBE_NODE_CAP_NARROW = 42;
export const GLOBE_ARC_CAP = 28;
export const GLOBE_ARC_CAP_NARROW = 16;
export const GLOBE_RESUME_IDLE_MS = 3_500;

export const GLOBE_ARC_HUES = [222, 205, 186, 262, 312] as const;

export type GlobeProspect = {
  id: string;
  username: string;
  name: string;
  pictureUrl: string | null;
  fitLabel: string | null;
  fitScore: number | null;
  status: string;
  source: string | null;
  discoveredAt: string | null;
};

const CONTACTED = new Set(["contacted", "replied", "follow_up", "demo_booked", "converted"]);

export function hashUsername(username: string) {
  const key = username.replace(/^@/, "").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unit(hash: number) {
  return (hash % 10_000) / 9_999;
}

export function clampLatitude(value: number) {
  return Math.max(-58, Math.min(68, value));
}

export function wrapLongitude(value: number) {
  let lon = value;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

export function simulatedCoordinates(username: string) {
  const key = username.replace(/^@/, "").trim().toLowerCase();
  const latitudeHash = hashUsername(key);
  const longitudeHash = hashUsername(`${key}:lon`);
  const nudgeHash = hashUsername(`${key}:nudge`);
  const centered = unit(latitudeHash) * 2 - 1;
  const nudge = ((nudgeHash % 13) - 6) * 0.35;
  const lat = clampLatitude(16 + Math.sign(centered) * centered * centered * 52 + nudge);
  const lon = wrapLongitude(-180 + unit(longitudeHash) * 360 + ((nudgeHash >>> 4) % 9) * 0.08);
  return { lat, lon };
}

export function spreadCoordinates<T extends { lat: number; lon: number }>(points: T[]) {
  const seen = new Map<string, number>();
  return points.map((point) => {
    const key = `${point.lat.toFixed(1)}:${point.lon.toFixed(1)}`;
    const bump = seen.get(key) ?? 0;
    seen.set(key, bump + 1);
    if (bump === 0) return point;
    const angle = bump * 2.399963;
    return {
      ...point,
      lat: clampLatitude(point.lat + Math.sin(angle) * 1.6 * bump),
      lon: wrapLongitude(point.lon + Math.cos(angle) * 1.6 * bump),
    };
  });
}

export function placeProspects(usernames: string[]) {
  return spreadCoordinates(usernames.map((username) => ({ username, ...simulatedCoordinates(username) })));
}

function priority(row: { status: string; fitLabel: string | null }) {
  if (row.status === "review" || row.status === "qualified") return 0;
  if (row.status === "approved") return 1;
  if (CONTACTED.has(row.status)) return 2;
  if (row.fitLabel === "strong_fit") return 3;
  return 4;
}

export function selectGlobeProspects<T extends { id: string; status: string; fitLabel: string | null; discoveredAt?: string | null }>(
  rows: T[],
  cap = GLOBE_NODE_CAP,
) {
  const ranked = rows.map((row, index) => ({
    row,
    rank: priority(row),
    time: row.discoveredAt ? Date.parse(row.discoveredAt) || 0 : 0,
    index,
  }));
  ranked.sort((a, b) => a.rank - b.rank || b.time - a.time || a.index - b.index);
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const item of ranked) {
    if (seen.has(item.row.id)) continue;
    seen.add(item.row.id);
    selected.push(item.row);
    if (selected.length >= cap) break;
  }
  return selected;
}

export function globeNodeCap(width: number) {
  return width < 720 ? GLOBE_NODE_CAP_NARROW : GLOBE_NODE_CAP;
}

export function globeArcCap(width: number) {
  return width < 720 ? GLOBE_ARC_CAP_NARROW : GLOBE_ARC_CAP;
}

function angularSeparation(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 180) / Math.PI;
}

export function globeArcs(
  nodes: { id: string; username: string; lat: number; lon: number }[],
  max = GLOBE_ARC_CAP,
) {
  const arcs: { from: string; to: string; hue: number }[] = [];
  const used = new Set<string>();
  for (let index = 0; index < nodes.length && arcs.length < max; index += 1) {
    const origin = nodes[index];
    if (!origin) continue;
    const hash = hashUsername(origin.username);
    let chosen: (typeof nodes)[number] | null = null;
    for (let step = 0; step < nodes.length; step += 1) {
      const candidate = nodes[(hash + step) % nodes.length];
      if (!candidate || candidate.id === origin.id) continue;
      const key = [origin.id, candidate.id].sort().join(":");
      if (used.has(key)) continue;
      if (angularSeparation(origin, candidate) < 28 && step < 6) continue;
      chosen = candidate;
      used.add(key);
      break;
    }
    if (!chosen) continue;
    arcs.push({ from: origin.id, to: chosen.id, hue: GLOBE_ARC_HUES[hash % GLOBE_ARC_HUES.length] ?? GLOBE_ARC_HUES[0] });
  }
  return arcs;
}

export function surfaceVector(lat: number, lon: number, radius = 1) {
  const theta = ((90 - lat) * Math.PI) / 180;
  const phi = ((lon + 90) * Math.PI) / 180;
  const ring = Math.sin(theta) * radius;
  return {
    x: -ring * Math.cos(phi),
    y: Math.cos(theta) * radius,
    z: ring * Math.sin(phi),
  };
}

export function arcSamples(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  radius = 1,
  segments = 48,
) {
  const start = surfaceVector(from.lat, from.lon, 1);
  const end = surfaceVector(to.lat, to.lon, 1);
  const dot = Math.max(-1, Math.min(1, start.x * end.x + start.y * end.y + start.z * end.z));
  const omega = Math.acos(dot);
  const points: { x: number; y: number; z: number }[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const sinOmega = Math.sin(omega) || 1;
    const weightStart = Math.sin((1 - t) * omega) / sinOmega;
    const weightEnd = Math.sin(t * omega) / sinOmega;
    const x = start.x * weightStart + end.x * weightEnd;
    const y = start.y * weightStart + end.y * weightEnd;
    const z = start.z * weightStart + end.z * weightEnd;
    const length = Math.hypot(x, y, z) || 1;
    const lift = Math.sin(Math.PI * t) * (0.08 + Math.min(omega, 1.4) * 0.16);
    const scaled = radius + lift;
    points.push({ x: (x / length) * scaled, y: (y / length) * scaled, z: (z / length) * scaled });
  }
  return points;
}

export function sampleArc(points: { x: number; y: number; z: number }[], progress: number) {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  const wrapped = ((progress % 1) + 1) % 1;
  const cursor = wrapped * (points.length - 1);
  const index = Math.floor(cursor);
  const next = Math.min(points.length - 1, index + 1);
  const mix = cursor - index;
  const a = points[index] ?? points[0];
  const b = points[next] ?? a;
  if (!a || !b) return { x: 0, y: 0, z: 0 };
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix, z: a.z + (b.z - a.z) * mix };
}

export function globeMotion(input: { reducedMotion: boolean; hidden: boolean; dragging: boolean; idleMs: number }) {
  const visible = !input.hidden;
  return {
    render: visible,
    autoRotate: visible && !input.reducedMotion && !input.dragging && input.idleMs >= GLOBE_RESUME_IDLE_MS,
    pulses: visible && !input.reducedMotion,
  };
}

export function avatarMark(name: string, username: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  const single = (words[0] || username || "SP").replace(/^@/, "");
  const letters = single.slice(0, 2).toUpperCase();
  return letters || "SP";
}

export function createFrameLoop(
  request: (callback: () => void) => number,
  cancel: (id: number) => void,
) {
  let id = 0;
  let alive = true;
  let running = false;
  return {
    start(tick: () => boolean) {
      if (running) return;
      alive = true;
      running = true;
      const step = () => {
        if (!alive) {
          running = false;
          return;
        }
        const keep = tick();
        if (!alive || !keep) {
          running = false;
          return;
        }
        id = request(step);
      };
      id = request(step);
    },
    stop() {
      alive = false;
      running = false;
      cancel(id);
      id = 0;
    },
  };
}

export const EARTH_LAND_RINGS: [number, number][][] = [
  [
    [72, -165], [68, -138], [60, -140], [55, -132], [48, -125], [38, -123], [32, -117], [26, -112], [23, -106], [21, -97], [26, -97], [29, -95], [29, -89], [28, -83], [25, -81], [30, -84], [35, -76], [40, -74], [42, -70], [45, -67], [47, -60], [52, -56], [58, -64], [63, -78], [68, -85], [71, -100], [74, -90], [76, -80], [73, -70], [70, -88],
  ],
  [
    [12, -72], [10, -62], [8, -60], [5, -52], [0, -50], [-8, -35], [-15, -39], [-23, -42], [-34, -52], [-42, -64], [-52, -70], [-55, -68], [-46, -74], [-30, -72], [-18, -70], [-5, -80], [2, -78], [8, -77],
  ],
  [
    [71, -10], [70, 25], [64, 30], [60, 28], [56, 22], [54, 12], [51, 4], [48, 2], [46, -1], [43, -8], [37, -9], [36, -5], [36, 3], [38, 12], [41, 19], [45, 14], [48, 16], [55, 12], [59, 6], [62, 5], [65, 14],
  ],
  [
    [37, -6], [35, 10], [32, 25], [30, 33], [22, 37], [12, 44], [11, 51], [2, 42], [-6, 39], [-15, 35], [-26, 33], [-34, 26], [-35, 18], [-22, 14], [-8, 12], [4, 8], [5, -4], [12, -17], [20, -17], [32, -10], [35, -2],
  ],
  [
    [70, 40], [72, 80], [76, 100], [72, 140], [66, 170], [60, 163], [50, 142], [38, 128], [31, 122], [22, 114], [10, 107], [2, 104], [8, 98], [16, 95], [22, 88], [25, 68], [21, 58], [26, 57], [28, 48], [40, 44], [50, 50], [60, 60], [66, 50],
  ],
  [
    [-11, 131], [-12, 136], [-15, 145], [-25, 153], [-32, 152], [-38, 147], [-35, 136], [-31, 115], [-22, 114], [-16, 123],
  ],
  [
    [83, -45], [80, -20], [75, -18], [70, -22], [68, -40], [72, -58], [78, -68], [82, -55],
  ],
];

export function pointInRing(lat: number, lon: number, ring: [number, number][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const prior = ring[previous];
    if (!current || !prior) continue;
    const intersects = current[0] > lat !== prior[0] > lat && lon < ((prior[1] - current[1]) * (lat - current[0])) / (prior[0] - current[0] || 1e-9) + current[1];
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isEarthLand(lat: number, lon: number) {
  return EARTH_LAND_RINGS.some((ring) => pointInRing(lat, lon, ring));
}

export const DECORATIVE_SURFACE_LIGHTS: { lat: number; lon: number }[] = [
  { lat: 40.7, lon: -74 },
  { lat: 34.05, lon: -118.2 },
  { lat: 41.9, lon: -87.6 },
  { lat: 19.4, lon: -99.1 },
  { lat: -23.5, lon: -46.6 },
  { lat: -34.6, lon: -58.4 },
  { lat: 51.5, lon: -0.1 },
  { lat: 48.9, lon: 2.3 },
  { lat: 52.5, lon: 13.4 },
  { lat: 41.9, lon: 12.5 },
  { lat: 55.8, lon: 37.6 },
  { lat: 30.0, lon: 31.2 },
  { lat: 6.5, lon: 3.4 },
  { lat: -26.2, lon: 28.0 },
  { lat: 25.2, lon: 55.3 },
  { lat: 19.1, lon: 72.9 },
  { lat: 28.6, lon: 77.2 },
  { lat: 13.8, lon: 100.5 },
  { lat: 1.3, lon: 103.8 },
  { lat: 35.7, lon: 139.7 },
  { lat: 37.6, lon: 127 },
  { lat: 31.2, lon: 121.5 },
  { lat: 39.9, lon: 116.4 },
  { lat: -33.9, lon: 151.2 },
  { lat: -37.8, lon: 145 },
];
