"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HomeActions } from "@/components/home/home-actions";
import { Avatar } from "@/components/ui/avatar";
import { DroneMark } from "@/components/visual/drone-mark";
import { FIT_LABELS_TEXT, STATUS_LABELS, type FitLabel, type ProspectStatus } from "@/lib/constants/prospects";
import { formatCurrentAction } from "@/lib/status/operations";

export type OverviewPin = {
  id: string;
  username: string;
  name: string;
  pictureUrl: string | null;
  followers: number | null;
  fitLabel: FitLabel | null;
  fitScore: number | null;
  status: ProspectStatus;
  place: string;
  category: string | null;
  x: number;
  y: number;
};

export type OverviewProspect = {
  id: string;
  username: string;
  name: string;
  pictureUrl: string | null;
  followers: number | null;
  fitLabel: FitLabel | null;
  fitScore: number | null;
  status: ProspectStatus;
  location: string | null;
  category: string | null;
  source: string | null;
  relationship: string | null;
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "analyze", label: "Analyze" },
  { id: "map", label: "Map" },
  { id: "pipeline", label: "Pipeline" },
  { id: "queue", label: "Queue" },
] as const;

const PIN_COLOR: Record<string, string> = {
  discovered: "#3B82F6",
  qualified: "#3B82F6",
  review: "#F59E0B",
  approved: "#A78BFA",
  contacted: "#22D3EE",
  replied: "#22D3EE",
  follow_up: "#22D3EE",
  demo_booked: "#22D3EE",
  converted: "#22C55E",
  skipped: "#94A3B8",
  disqualified: "#EF4444",
};

export function OverviewStage({
  actions,
  current,
  worker,
  pins,
  pipeline,
  queue,
}: {
  actions: React.ComponentProps<typeof HomeActions>;
  current: OverviewProspect | null;
  worker: {
    task: string | null;
    username: string | null;
    browser: string;
    authenticated: boolean;
    connected: boolean;
    action: string;
  };
  pins: OverviewPin[];
  pipeline: { label: string; count: number }[];
  queue: OverviewProspect[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [queueOpen, setQueueOpen] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [section, setSection] = useState("overview");

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const queueNode = queueRef.current;
    function onScroll() {
      const story = root.current;
      if (!story) return;
      const rect = story.getBoundingClientRect();
      const total = Math.max(1, story.offsetHeight - window.innerHeight);
      setProgress(Math.min(1, Math.max(0, -rect.top / total)));
      const marker = window.innerHeight * 0.35;
      let currentSection: (typeof SECTIONS)[number] = SECTIONS[0];
      for (const item of SECTIONS) {
        const element = document.getElementById(item.id);
        if (element && element.getBoundingClientRect().top <= marker) currentSection = item;
      }
      if (currentSection) setSection(currentSection.id);
      if (queueNode) {
        const box = queueNode.getBoundingClientRect();
        const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
        setQueueOpen(Math.min(1, Math.max(0, visible / Math.min(window.innerHeight, box.height || 1))));
      }
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const droneScale = reduced ? 1 : 1 - progress * 0.55;
  const droneShift = reduced ? 0 : progress * 120;

  return (
    <div id="overview-story" ref={root} className="relative">
      <nav className="fixed right-3 top-1/2 z-20 hidden -translate-y-1/2 xl:block" aria-label="Overview sections">
        <ol className="space-y-2">
          {SECTIONS.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={`flex items-center justify-end gap-2 text-[11px] ${section === item.id ? "text-sky-300" : "text-slate-500"}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(item.id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
                }}
              >
                <span>{item.label}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${section === item.id ? "bg-sky-400 shadow-[0_0_8px_#22d3ee]" : "bg-slate-600"}`} />
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section id="overview" className="grid items-center gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-sky-300/80">SHOOTPORTAL</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-50">Outreach, in flight.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
            Discovery finds prospects. Review is waiting on you. Outreach sends only when you have approved the queue.
          </p>
          <div className="mt-6">
            <HomeActions {...actions} />
          </div>
        </div>
        <div className="relative flex min-h-64 items-center justify-center" aria-hidden>
          <div
            className="pointer-events-none"
            style={{
              transform: `translate3d(${droneShift}px, ${reduced ? 0 : progress * -40}px, 0) scale(${droneScale})`,
            }}
          >
            <DroneMark className="h-64 w-64 drop-shadow-[0_30px_40px_rgba(15,23,42,0.65)]" />
          </div>
        </div>
      </section>

      <section id="analyze" className="mt-16 grid gap-4 lg:grid-cols-2">
        <Glass title="Live Prospect Analysis" detail={worker.username ? `Current profile @${worker.username.replace(/^@/, "")}` : "No profile is open"}>
          {current ? (
            <div className="flex gap-4">
              <Avatar name={current.name} src={current.pictureUrl} size="lg" />
              <div>
                <p className="text-lg font-semibold text-slate-50">@{current.username}</p>
                <p className="text-sm text-slate-300">{current.name}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {current.followers != null ? `${current.followers.toLocaleString()} followers` : "Followers not recorded"}
                  {current.location ? ` · ${current.location}` : ""}
                  {current.category ? ` · ${current.category}` : ""}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">The worker is not inspecting a saved prospect right now.</p>
          )}
          <ol className="mt-4 space-y-2 text-sm">
            {stepsFor(worker.task).map((step) => (
              <li key={step.label} className="flex items-center gap-2">
                <span className={step.state === "current" ? "text-cyan-300" : "text-slate-500"} aria-hidden>
                  {step.state === "current" ? "●" : "○"}
                </span>
                <span className={step.state === "current" ? "text-slate-100" : "text-slate-400"}>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-slate-200">
            Fit {current?.fitScore != null ? `${current.fitScore}` : "not scored"}
            {current?.fitLabel ? ` · ${FIT_LABELS_TEXT[current.fitLabel]}` : ""}
            {current?.relationship ? ` · ${current.relationship}` : ""}
          </p>
        </Glass>
        <Glass title="Automation View" detail="Windows worker">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Browser" value={worker.browser} />
            <Fact label="Instagram" value={worker.authenticated ? "Authenticated" : "Not confirmed"} />
            <Fact label="Worker" value={worker.connected ? "Connected" : "Offline"} />
            <Fact label="Profile" value={worker.username ? `@${worker.username.replace(/^@/, "")}` : "None"} />
          </dl>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs text-slate-500">Instagram</p>
            <p className="mt-1 font-medium text-slate-100">{worker.action}</p>
            <ol className="mt-3 space-y-1 text-sm text-slate-300">
              {stepsFor(worker.task).map((step) => (
                <li key={step.label}>{step.state === "current" ? "●" : "○"} {step.label}</li>
              ))}
            </ol>
          </div>
        </Glass>
      </section>

      <section id="map" className="mt-16">
        <Glass title="United States" detail="Pins use a confirmed city and state. Vague locations stay off the map.">
          <ProspectMap pins={pins} active={activePin} onActive={setActivePin} />
        </Glass>
      </section>

      <section id="pipeline" className="mt-16">
        <Glass title="Pipeline" detail="Counts from the current prospect records.">
          <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {pipeline.map((stage, index) => (
              <li key={stage.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-2xl font-semibold tabular-nums text-slate-50">{stage.count.toLocaleString()}</p>
                <p className="mt-1 text-xs text-slate-400">{stage.label}</p>
                {index < pipeline.length - 1 ? <span className="sr-only">Next stage follows</span> : null}
              </li>
            ))}
          </ol>
        </Glass>
      </section>

      <section id="queue" ref={queueRef} className="mt-16 pb-8" style={{ minHeight: reduced ? undefined : `${28 + queueOpen * 24}rem` }}>
        <div className="rounded-2xl border border-white/10 bg-[#080b12]/90 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.35)]" style={{ transform: reduced ? undefined : `scale(${0.98 + queueOpen * 0.02})` }}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-50">Prospects</h2>
              <p className="text-sm text-slate-400">This preview expands as you arrive. The full workspace keeps filters, columns, and bulk actions.</p>
            </div>
            <Link href="/prospects" className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white">Open Prospects</Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  {["Profile", "Username", "Location", "Followers", "Fit", "Status"].map((column) => (
                    <th key={column} className="px-2 py-2 font-medium">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={row.id} className="border-t border-white/5 hover:bg-white/[0.04]">
                    <td className="px-2 py-2"><Avatar name={row.name} src={row.pictureUrl} size="sm" /></td>
                    <td className="px-2 py-2"><Link href={`/prospects/${row.id}`} className="text-slate-100">@{row.username}</Link></td>
                    <td className="px-2 py-2 text-slate-400">{row.location || "Unknown"}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-300">{row.followers?.toLocaleString() ?? "—"}</td>
                    <td className="px-2 py-2 text-slate-300">{row.fitLabel ? FIT_LABELS_TEXT[row.fitLabel] : "Not analyzed"}</td>
                    <td className="px-2 py-2 text-slate-300">{STATUS_LABELS[row.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {queue.length === 0 ? <p className="py-8 text-sm text-slate-400">No prospects yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function stepsFor(task: string | null) {
  const action = formatCurrentAction(task, null);
  if (task?.startsWith("executing_verify")) return mark("Verify profile", ["Verify profile", "Follow", "Open Direct", "Send message"]);
  if (task?.startsWith("executing_follow")) return mark("Follow", ["Verify profile", "Follow", "Open Direct", "Send message"]);
  if (task?.startsWith("executing_send") || task === "opening_direct") return mark("Send message", ["Verify profile", "Follow", "Open Direct", "Send message"]);
  if (task === "inspecting_profiles") return mark("Reading this profile", ["Reading this profile", "Fit evaluation"]);
  if (task?.includes("qualif")) return mark("Fit evaluation", ["Reading this profile", "Fit evaluation"]);
  return [{ label: action, state: "current" as const }];
}

function mark(current: string, labels: string[]) {
  const index = labels.indexOf(current);
  return labels.map((label, item) => ({
    label,
    state: item === index ? "current" as const : "wait" as const,
  }));
}

function Glass({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
      <h2 className="text-base font-semibold text-slate-50">{title}</h2>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-100">{value}</dd>
    </div>
  );
}

function clusterPins(pins: OverviewPin[]) {
  const groups: OverviewPin[][] = [];
  for (const pin of pins) {
    const group = groups.find((items) => {
      const first = items[0];
      return first != null && Math.abs(first.x - pin.x) < 3 && Math.abs(first.y - pin.y) < 3;
    });
    if (group) group.push(pin);
    else groups.push([pin]);
  }
  return groups;
}

function ProspectMap({
  pins,
  active,
  onActive,
}: {
  pins: OverviewPin[];
  active: string | null;
  onActive: (id: string | null) => void;
}) {
  const groups = clusterPins(pins);
  const selected = pins.find((pin) => pin.id === active) ?? null;
  return (
    <div className="relative mt-2 h-[420px] overflow-hidden rounded-xl bg-[#05070d]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
        <path
          d="M5 8 L4 16 L5 32 L8 46 L12 58 L14 66 L22 68 L32 71 L40 80 L47 93 L55 86 L60 78 L66 76 L72 86 L76 94 L78 80 L84 62 L86 48 L87 36 L92 28 L98 18 L90 16 L78 14 L70 22 L62 18 L56 10 L40 12 L24 10 Z"
          fill="rgba(59,130,246,0.08)"
          stroke="rgba(148,163,184,0.45)"
          strokeWidth="0.35"
        />
      </svg>
      {groups.map((group) => {
        const pin = group[0];
        if (!pin) return null;
        return (
          <button
            key={pin.id}
            type="button"
            className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border border-white/40 text-[10px] font-semibold text-white"
            style={{ left: `${pin.x}%`, top: `${pin.y}%`, boxShadow: `0 0 0 2px ${PIN_COLOR[pin.status] ?? "#94A3B8"}` }}
            aria-label={group.length > 1 ? `${group.length} prospects in ${pin.place}` : `${pin.username}, ${pin.place}, ${STATUS_LABELS[pin.status]}`}
            onMouseEnter={() => onActive(pin.id)}
            onFocus={() => onActive(pin.id)}
            onMouseLeave={() => onActive(null)}
            onBlur={() => onActive(null)}
          >
            {group.length > 1 ? group.length : pin.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pin.pictureUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full bg-slate-800" />
            )}
          </button>
        );
      })}
      {selected ? (
        <div className="absolute bottom-3 left-3 max-w-xs rounded-xl border border-white/10 bg-[#0b1020]/95 p-3 text-sm">
          <p className="font-medium text-slate-50">@{selected.username}</p>
          <p className="text-xs text-slate-400">{selected.place} · {STATUS_LABELS[selected.status]}</p>
          <p className="text-xs text-slate-400">{selected.followers != null ? `${selected.followers.toLocaleString()} followers` : "Followers unknown"}{selected.fitLabel ? ` · ${FIT_LABELS_TEXT[selected.fitLabel]}` : ""}</p>
          <Link href={`/prospects/${selected.id}`} className="mt-2 inline-block text-xs text-sky-300">Open prospect</Link>
        </div>
      ) : null}
      {pins.length === 0 ? <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-400">No prospects have a confirmed US city and state yet.</p> : null}
    </div>
  );
}
