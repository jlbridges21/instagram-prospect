"use client";

import { useMemo, useState, useTransition } from "react";
import {
  deleteSeeds,
  promoteExistingQualified,
  resetDiscoveryKeywords,
  saveDiscoveryOptimization,
  saveSeed,
  saveSeedsBulk,
  setSeedsActive,
} from "@/lib/actions/seeds";
import { DEFAULT_POSITIVE_KEYWORDS } from "@/lib/discovery/defaults";
import { approvalYield, reviewYield } from "@/lib/discovery/seeds";
import type { DiscoveryOptimization } from "@/lib/db/models";
import type { DiscoverySeedRow } from "@/lib/db/types";

export function DiscoverySeedsPanel({
  seeds,
  optimization,
  migrationNeeded,
}: {
  seeds: DiscoverySeedRow[];
  optimization: DiscoveryOptimization;
  migrationNeeded: boolean;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"yield" | "inspected" | "review">("review");
  const [positive, setPositive] = useState(optimization.positiveKeywords.join("\n"));
  const [negative, setNegative] = useState(optimization.negativeKeywords.join("\n"));
  const [form, setForm] = useState(optimization);

  const visible = useMemo(() => {
    const filtered = seeds.filter((seed) => {
      const haystack = `${seed.instagram_username} ${seed.category ?? ""} ${seed.notes ?? ""}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });
    return filtered.sort((a, b) => {
      if (sort === "inspected") return b.profiles_inspected - a.profiles_inspected;
      if (sort === "yield") return reviewYield(b.profiles_inspected, b.profiles_reaching_review) - reviewYield(a.profiles_inspected, a.profiles_reaching_review);
      return b.profiles_reaching_review - a.profiles_reaching_review;
    });
  }, [seeds, query, sort]);
  const open = seeds.find((seed) => seed.id === openId) ?? null;

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError("");
    setMessage("");
    start(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Could not save.");
      else setMessage(result.message ?? "Saved.");
    });
  }

  return (
    <div className="mt-8 space-y-6">
      {migrationNeeded ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Discovery Seeds need the new database migration before they can be saved.
        </p>
      ) : null}
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Discovery Seeds</h2>
        <p className="mt-1 text-sm text-slate-600">Accounts that represent the customers you want Discovery to find more of.</p>
        <SeedForm disabled={pending || migrationNeeded} onSave={(input) => run(() => saveSeed(input))} />
        <label className="mt-4 block text-sm">
          <span className="font-medium text-slate-800">Bulk import</span>
          <textarea id="seed-bulk" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" rows={4} placeholder={"@goodaccount1\n@goodaccount2"} />
        </label>
        <button
          type="button"
          className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          disabled={pending || migrationNeeded}
          onClick={() => {
            const value = (document.getElementById("seed-bulk") as HTMLTextAreaElement | null)?.value ?? "";
            run(() => saveSeedsBulk(value));
          }}
        >
          Import usernames
        </button>
        <div className="mt-4 flex flex-wrap gap-2">
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Filter" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="review">Most Review</option>
            <option value="yield">Highest yield</option>
            <option value="inspected">Most inspected</option>
          </select>
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" disabled={pending || selected.length === 0} onClick={() => run(() => setSeedsActive(selected, true))}>Enable</button>
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" disabled={pending || selected.length === 0} onClick={() => run(() => setSeedsActive(selected, false))}>Disable</button>
          <button type="button" className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700" disabled={pending || selected.length === 0} onClick={() => run(() => deleteSeeds(selected))}>Remove</button>
        </div>
        <ul className="mt-4 divide-y divide-slate-100">
          {visible.map((seed) => (
            <li key={seed.id} className="flex items-center gap-3 py-3 text-sm">
              <input type="checkbox" checked={selected.includes(seed.id)} onChange={() => setSelected((current) => current.includes(seed.id) ? current.filter((id) => id !== seed.id) : [...current, seed.id])} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(seed.id)}>
                <span className="font-medium text-slate-900">@{seed.instagram_username}</span>
                <span className="ml-2 text-slate-500">{seed.category || "Uncategorized"} · {labelSource(seed.source_type)} · {seed.is_active ? "Active" : "Disabled"}</span>
                <span className="mt-1 block text-slate-600">
                  {seed.profiles_inspected} inspected · {seed.profiles_reaching_review} Review · {percent(reviewYield(seed.profiles_inspected, seed.profiles_reaching_review))} yield
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 ? <li className="py-3 text-sm text-slate-500">No seeds yet.</li> : null}
        </ul>
        {open ? <SeedDetail seed={open} onClose={() => setOpenId(null)} onSave={(input) => run(() => saveSeed(input))} disabled={pending} /> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Discovery Optimization</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Toggle label="Automatically promote qualified prospects" checked={form.autoPromote} onChange={(autoPromote) => setForm({ ...form, autoPromote })} />
          <NumberField label="Auto-promote when Fit Score is at least" value={form.autoPromoteMinScore} onChange={(autoPromoteMinScore) => setForm({ ...form, autoPromoteMinScore })} />
          <Toggle label="Promote Strong Fit" checked={form.promoteStrong} onChange={(promoteStrong) => setForm({ ...form, promoteStrong })} />
          <Toggle label="Promote Possible Fit" checked={form.promotePossible} onChange={(promotePossible) => setForm({ ...form, promotePossible })} />
          <SelectField label="Promote only after" value={form.promoteRequires} options={[["review", "Reaches Review"], ["approved", "Manually approved"]]} onChange={(promoteRequires) => setForm({ ...form, promoteRequires })} />
          <NumberField label="Minimum inspections before yield affects ranking" value={form.minSeedSample} onChange={(minSeedSample) => setForm({ ...form, minSeedSample })} />
          <Toggle label="Favor high-yield seeds" checked={form.favorYield} onChange={(favorYield) => setForm({ ...form, favorYield })} />
          <SelectField label="Yield strength" value={form.yieldStrength} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} onChange={(yieldStrength) => setForm({ ...form, yieldStrength })} />
          <SelectField label="Home Feed usage" value={form.homeFeedUsage} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} onChange={(homeFeedUsage) => setForm({ ...form, homeFeedUsage })} />
          <SelectField label="Discovery strategy" value={form.strategy} options={[["conservative", "Conservative"], ["balanced", "Balanced"], ["exploratory", "Exploratory"]]} onChange={(strategy) => setForm({ ...form, strategy })} />
          <NumberField label="Seed reuse cooldown (consecutive cycles)" value={form.seedCooldownCycles} onChange={(seedCooldownCycles) => setForm({ ...form, seedCooldownCycles })} />
        </div>
        <button
          type="button"
          className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={pending || migrationNeeded}
          onClick={() => run(() => saveDiscoveryOptimization({ ...form, positiveKeywords: lines(positive), negativeKeywords: lines(negative) }))}
        >
          Save optimization
        </button>
        <button type="button" className="ml-2 mt-4 rounded-lg border border-slate-200 px-3 py-2 text-sm" disabled={pending} onClick={() => {
          if (window.confirm("Promote existing Strong Fit prospects that are in Review or Approved? Existing seeds stay unchanged.")) run(() => promoteExistingQualified());
        }}>
          Promote existing qualified prospects
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Candidate Prioritization</h2>
        <p className="mt-1 text-sm text-slate-600">These signals affect which candidates are inspected first. They do not automatically disqualify a prospect.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-medium">Positive signals</span>
            <textarea className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" rows={8} value={positive} onChange={(event) => setPositive(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Negative signals</span>
            <textarea className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" rows={8} value={negative} onChange={(event) => setNegative(event.target.value)} />
          </label>
        </div>
        <button type="button" className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm" disabled={pending} onClick={() => run(async () => {
          const result = await resetDiscoveryKeywords();
          if (result.ok) {
            setPositive(DEFAULT_POSITIVE_KEYWORDS.join("\n"));
            setNegative("");
          }
          return result;
        })}>
          Reset keywords to defaults
        </button>
      </section>
    </div>
  );
}

function SeedForm({ disabled, onSave }: { disabled: boolean; onSave: (input: { username: string; category: string; notes: string; priority: "low" | "normal" | "high" }) => void }) {
  const [username, setUsername] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  return (
    <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      onSave({ username, category, notes, priority });
      setUsername("");
    }}>
      <input required className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Instagram username or URL" value={username} onChange={(event) => setUsername(event.target.value)} />
      <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Category" value={category} onChange={(event) => setCategory(event.target.value)} />
      <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Note" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
        <option value="low">Low priority</option>
        <option value="normal">Normal priority</option>
        <option value="high">High priority</option>
      </select>
      <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={disabled}>Add Seed</button>
    </form>
  );
}

function SeedDetail({ seed, disabled, onClose, onSave }: { seed: DiscoverySeedRow; disabled: boolean; onClose: () => void; onSave: (input: { id: string; username: string; category: string; notes: string; priority: "low" | "normal" | "high"; active: boolean }) => void }) {
  const [category, setCategory] = useState(seed.category ?? "");
  const [notes, setNotes] = useState(seed.notes ?? "");
  const [priority, setPriority] = useState(seed.priority);
  const [active, setActive] = useState(seed.is_active);
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium">@{seed.instagram_username}</p>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <p className="mt-1 text-slate-600">{labelSource(seed.source_type)} · created {seed.created_at.slice(0, 10)} · last used {seed.last_used_at?.slice(0, 10) ?? "never"}</p>
      <p className="mt-2">Discovered {seed.profiles_discovered} · Inspected {seed.profiles_inspected} · Review {seed.profiles_reaching_review} · Approved {seed.profiles_approved} · Contacted {seed.profiles_contacted}</p>
      <p>Review yield {percent(reviewYield(seed.profiles_inspected, seed.profiles_reaching_review))} · Approval yield {percent(approvalYield(seed.profiles_inspected, seed.profiles_approved))}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input className="rounded-lg border border-slate-200 px-3 py-2" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" />
        <input className="rounded-lg border border-slate-200 px-3 py-2" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Note" />
        <select className="rounded-lg border border-slate-200 px-3 py-2" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
        <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active</label>
      </div>
      <button type="button" className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-white" disabled={disabled} onClick={() => onSave({ id: seed.id, username: seed.instagram_username, category, notes, priority, active })}>Save seed</button>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}</label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label>{label}<input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <label>
      {label}
      <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </label>
  );
}

function lines(value: string) {
  return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function labelSource(value: string) {
  if (value === "auto_promoted") return "Auto-promoted";
  if (value === "system_imported") return "Imported";
  return "Manual";
}
