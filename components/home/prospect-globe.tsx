"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FIT_LABELS_TEXT, SOURCE_LABELS, STATUS_LABELS, isProspectSource, type FitLabel, type ProspectStatus } from "@/lib/constants/prospects";
import { GLOBE_NODE_CAP, GLOBE_NODE_CAP_NARROW, type GlobeProspect } from "@/lib/visual/globe";
import { Avatar } from "@/components/ui/avatar";

export function ProspectGlobe({
  prospects,
  total,
  review,
  contacted,
}: {
  prospects: GlobeProspect[];
  total: number;
  review: number;
  contacted: number;
}) {
  const [webgl, setWebgl] = useState(webglSupported);
  const narrow = useSyncExternalStore(subscribeNarrow, narrowSnapshot, () => false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [override, setOverride] = useState<{ base: GlobeProspect[]; rows: GlobeProspect[] } | null>(null);
  const sample = override?.base === prospects ? override.rows : prospects;
  const root = useRef<HTMLDivElement>(null);
  const markers = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onChange() {
      void fetch("/api/dashboard/network", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as {
            prospects?: Array<{
              id: string;
              username: string;
              display_name: string;
              profile_image_url: string | null;
              fit_label: string | null;
              fit_score: number | null;
              status: string;
              source: string | null;
            }>;
          };
          if (!Array.isArray(body.prospects)) return;
          setOverride({
            base: prospects,
            rows: body.prospects.map((prospect) => ({
            id: prospect.id,
            username: prospect.username,
            name: prospect.display_name,
            pictureUrl: prospect.profile_image_url,
            fitLabel: prospect.fit_label,
            fitScore: prospect.fit_score,
            status: prospect.status,
            source: prospect.source,
            discoveredAt: null,
          })),
          });
        })
        .catch(() => undefined);
    }
    window.addEventListener("shootportal-prospects-changed", onChange);
    return () => window.removeEventListener("shootportal-prospects-changed", onChange);
  }, [prospects]);

  const visible = useMemo(
    () => sample.slice(0, narrow ? GLOBE_NODE_CAP_NARROW : GLOBE_NODE_CAP),
    [sample, narrow],
  );
  const selected = visible.find((prospect) => prospect.id === selectedId) ?? null;

  useEffect(() => {
    if (!webgl || !root.current || !markers.current) return;
    let cleanup = () => {};
    let cancelled = false;
    const host = root.current;
    const layer = markers.current;
    void import("./globe-scene").then((mod) => {
      if (cancelled || !host.isConnected) return;
      cleanup = mod.mountGlobe(host, layer, visible, setSelectedId);
    }).catch(() => {
      if (!cancelled) setWebgl(false);
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [webgl, visible]);

  return (
    <div className="relative h-[420px] overflow-hidden rounded-xl bg-[#05070d] sm:h-[520px] lg:h-[620px]">
      <div className="pointer-events-none absolute left-3 top-3 z-10 space-y-1 text-[11px] text-slate-300">
        <p><span className="tabular-nums text-slate-50">{total.toLocaleString()}</span> Prospects</p>
        <p><span className="tabular-nums text-slate-50">{contacted.toLocaleString()}</span> Contacted</p>
        <p><span className="tabular-nums text-slate-50">{review.toLocaleString()}</span> Review</p>
      </div>
      {webgl === false ? (
        <GlobeFallback prospects={visible} onSelect={setSelectedId} />
      ) : (
        <div ref={root} className="absolute inset-0 touch-none" role="img" aria-label="Simulated global prospect network">
          <div ref={markers} className="pointer-events-none absolute inset-0" />
        </div>
      )}
      {selected ? <ProspectCard prospect={selected} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

function webglSupported() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function subscribeNarrow(onChange: () => void) {
  const media = window.matchMedia("(max-width: 719px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function narrowSnapshot() {
  return window.matchMedia("(max-width: 719px)").matches;
}

function GlobeFallback({
  prospects,
  onSelect,
}: {
  prospects: GlobeProspect[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
      <div className="relative h-48 w-48 rounded-full border border-sky-400/30 bg-[radial-gradient(circle_at_35%_30%,rgba(125,166,220,0.28),#070b16_62%)] shadow-[0_0_40px_rgba(59,130,246,0.18)]" aria-hidden />
      <p className="max-w-sm text-center text-sm text-slate-400">This browser cannot draw the interactive globe. The prospect sample is still available below.</p>
      <ul className="flex max-w-full flex-wrap justify-center gap-2">
        {prospects.slice(0, 8).map((prospect) => (
          <li key={prospect.id}>
            <button type="button" className="rounded-full border border-white/15 px-2 py-1 text-xs text-slate-200" onClick={() => onSelect(prospect.id)}>
              @{prospect.username}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProspectCard({ prospect, onClose }: { prospect: GlobeProspect; onClose: () => void }) {
  const fit = prospect.fitLabel && prospect.fitLabel in FIT_LABELS_TEXT ? FIT_LABELS_TEXT[prospect.fitLabel as FitLabel] : "Not scored";
  const status = prospect.status in STATUS_LABELS ? STATUS_LABELS[prospect.status as ProspectStatus] : prospect.status;
  const source = prospect.source && isProspectSource(prospect.source) ? SOURCE_LABELS[prospect.source] : prospect.source || "Not recorded";
  return (
    <div className="absolute bottom-3 left-3 z-20 w-[min(100%-1.5rem,18rem)] rounded-xl border border-white/10 bg-[#0b1020]/95 p-3 text-sm shadow-xl">
      <div className="flex gap-3">
        <Avatar name={prospect.name} src={prospect.pictureUrl} />
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-50">{prospect.name}</p>
          <p className="truncate text-xs text-slate-400">@{prospect.username}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-1 text-xs text-slate-300">
        <div className="flex justify-between gap-3"><dt>Fit</dt><dd>{fit}{prospect.fitScore != null ? ` ${prospect.fitScore}` : ""}</dd></div>
        <div className="flex justify-between gap-3"><dt>Status</dt><dd>{status}</dd></div>
        <div className="flex justify-between gap-3"><dt>Source</dt><dd className="truncate">{source}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between">
        <Link href={`/prospects/${prospect.id}`} className="text-xs text-sky-300">View prospect</Link>
        <button type="button" className="text-xs text-slate-500" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
