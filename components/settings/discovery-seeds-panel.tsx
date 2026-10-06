"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  acceptSuggestedKeyword,
  deleteSeeds,
  ignoreSuggestedKeyword,
  promoteExistingQualified,
  resetDiscoveryKeywords,
  saveDiscoveryOptimization,
  saveSeed,
  saveSeedsBulk,
  setSeedsActive,
} from "@/lib/actions/seeds";
import { DEFAULT_DISCOVERY_TUNING, DEFAULT_NEGATIVE_KEYWORDS, DEFAULT_POSITIVE_KEYWORDS, candidateExplorationPercent, explorationPercent, homeFeedPercent, seedSharePercent, type DiscoveryTuning } from "@/lib/discovery/defaults";
import { approvalYield, reviewYield } from "@/lib/discovery/seeds";
import { livePollDelay } from "@/lib/discovery/policy";
import type { DiscoveryOptimization } from "@/lib/db/models";
import type { DiscoverySeedRow } from "@/lib/db/types";

function matureRate(inspected: number, hits: number, yieldOf: (inspected: number, hits: number) => number) {
  if (inspected < 10) return -1;
  return yieldOf(inspected, hits);
}

export function DiscoverySeedsPanel({
  seeds,
  optimization,
  migrationNeeded,
  suggestions = [],
}: {
  seeds: DiscoverySeedRow[];
  optimization: DiscoveryOptimization;
  migrationNeeded: boolean;
  suggestions?: string[];
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"yield" | "approval" | "inspected" | "review">("review");
  const [positive, setPositive] = useState(optimization.positiveKeywords.join("\n"));
  const [negative, setNegative] = useState(optimization.negativeKeywords.join("\n"));
  const [form, setForm] = useState(optimization);
  const [counts, setCounts] = useState<Record<string, { inspected: number; review: number; approved: number; contacted: number }>>({});

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    async function tick() {
      if (stopped) return;
      const visibleTab = document.visibilityState === "visible";
      if (visibleTab) {
        try {
          const response = await fetch("/api/dashboard/discovery-seeds", { cache: "no-store" });
          if (response.ok) {
            const body = (await response.json()) as { seeds?: Array<{ id: string; inspected: number; review: number; approved: number; contacted: number }> };
            if (!stopped && Array.isArray(body.seeds)) {
              setCounts(Object.fromEntries(body.seeds.map((seed) => [seed.id, seed])));
            }
          }
        } catch {
          // The next poll retries.
        }
      }
      timer = window.setTimeout(tick, livePollDelay(visibleTab));
    }
    timer = window.setTimeout(tick, livePollDelay(true));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  const rows = useMemo(() => seeds.map((seed) => {
    const live = counts[seed.id];
    if (!live) return seed;
    return {
      ...seed,
      profiles_inspected: live.inspected,
      profiles_reaching_review: live.review,
      profiles_approved: live.approved,
      profiles_contacted: live.contacted,
    };
  }), [seeds, counts]);

  const visible = useMemo(() => {
    const filtered = rows.filter((seed) => {
      const haystack = `${seed.instagram_username} ${seed.category ?? ""} ${seed.notes ?? ""}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });
    return filtered.sort((a, b) => {
      if (sort === "inspected") return b.profiles_inspected - a.profiles_inspected;
      if (sort === "yield") return matureRate(b.profiles_inspected, b.profiles_reaching_review, reviewYield) - matureRate(a.profiles_inspected, a.profiles_reaching_review, reviewYield);
      if (sort === "approval") return matureRate(b.profiles_inspected, b.profiles_approved, approvalYield) - matureRate(a.profiles_inspected, a.profiles_approved, approvalYield);
      return b.profiles_reaching_review - a.profiles_reaching_review;
    });
  }, [rows, query, sort]);
  const open = rows.find((seed) => seed.id === openId) ?? null;
  function setTuning(key: keyof DiscoveryTuning, value: number) {
    setForm({ ...form, tuning: { ...form.tuning, [key]: value } });
  }

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
            <option value="yield">Review yield</option>
            <option value="approval">Approval yield</option>
            <option value="inspected">Volume</option>
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
                  {seed.profiles_inspected === 0 && seed.profiles_reaching_review === 0 && seed.profiles_approved === 0 && seed.profiles_contacted === 0
                    ? "No seed-sourced prospects yet"
                    : `${seed.profiles_inspected} inspected · ${seed.profiles_reaching_review} Review · ${percent(reviewYield(seed.profiles_inspected, seed.profiles_reaching_review))} yield`}
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
          <Toggle label="Seed network fallback" checked={form.seedNetworkEnabled} onChange={(seedNetworkEnabled) => setForm({ ...form, seedNetworkEnabled })} />
          <NumberField label="Accounts to sample per seed" value={form.seedNetworkSample} onChange={(seedNetworkSample) => setForm({ ...form, seedNetworkSample })} />
          <NumberField label="Minimum candidate pre-score" value={form.minCandidatePreScore} onChange={(minCandidatePreScore) => setForm({ ...form, minCandidatePreScore })} />
          <NumberField label="Exploration floor" value={form.tuning.explorationFloor} onChange={(value) => setTuning("explorationFloor", value)} />
          <NumberField label="Candidate pool target" value={form.tuning.poolTarget} onChange={(value) => setTuning("poolTarget", value)} />
          <p className="text-sm text-slate-600 sm:col-span-2">When a seed profile has no related accounts, Discovery samples that account&apos;s Following list. Suggested accounts are still used when both are empty.</p>
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-900">Suggested positive keywords</p>
            <p className="mt-1 text-sm text-slate-600">These terms appear disproportionately often in Approved and Contacted prospects. They do not affect scoring until you accept one.</p>
            <ul className="mt-3 space-y-2">
              {suggestions.map((term) => (
                <li key={term} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-slate-900">{term}</span>
                  <button type="button" className="rounded-lg bg-slate-900 px-2 py-1 text-white disabled:opacity-50" disabled={pending} onClick={() => run(() => acceptSuggestedKeyword(term))}>Accept</button>
                  <button type="button" className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-50" disabled={pending} onClick={() => run(() => ignoreSuggestedKeyword(term))}>Ignore</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <button
          type="button"
          className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={pending || migrationNeeded}
          onClick={() => run(() => saveDiscoveryOptimization({ ...form, positiveKeywords: lines(positive), negativeKeywords: lines(negative) }))}
        >
          Save optimization
        </button>
        <details className="mt-4 rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">Advanced Discovery Tuning</summary>
          <p className="mt-2 text-sm text-slate-600">Most users should leave these at the recommended defaults.</p>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p>{labelStrategy(form.strategy)}: under-tested seed exploration {explorationPercent(form.strategy, form.tuning)}%. Candidate inspection exploration {candidateExplorationPercent(form.strategy, form.tuning)}%. Seed-based collection preference {seedSharePercent(form.strategy, form.tuning)}%.</p>
            <p className="mt-1">Home Feed {form.homeFeedUsage}: {homeFeedPercent(form.homeFeedUsage, form.tuning)}%.</p>
          </div>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <NumberField label="Positive keyword bonus" value={form.tuning.positiveKeywordBonus} onChange={(value) => setTuning("positiveKeywordBonus", value)} />
            <NumberField label="Negative keyword penalty" value={form.tuning.negativeKeywordPenalty} onChange={(value) => setTuning("negativeKeywordPenalty", value)} />
            <NumberField label="Manual seed priority, Low" value={form.tuning.manualPriorityLow} onChange={(value) => setTuning("manualPriorityLow", value)} />
            <NumberField label="Manual seed priority, Normal" value={form.tuning.manualPriorityNormal} onChange={(value) => setTuning("manualPriorityNormal", value)} />
            <NumberField label="Manual seed priority, High" value={form.tuning.manualPriorityHigh} onChange={(value) => setTuning("manualPriorityHigh", value)} />
            <NumberField label="Recent-use penalty" value={form.tuning.recentUsePenalty} onChange={(value) => setTuning("recentUsePenalty", value)} />
            <NumberField label="Under-tested seed exploration, Conservative %" value={form.tuning.explorationConservative} onChange={(value) => setTuning("explorationConservative", value)} />
            <NumberField label="Under-tested seed exploration, Balanced %" value={form.tuning.explorationBalanced} onChange={(value) => setTuning("explorationBalanced", value)} />
            <NumberField label="Under-tested seed exploration, Exploratory %" value={form.tuning.explorationExploratory} onChange={(value) => setTuning("explorationExploratory", value)} />
            <NumberField label="Candidate inspection exploration, Conservative %" value={form.tuning.candidateExploreConservative} onChange={(value) => setTuning("candidateExploreConservative", value)} />
            <NumberField label="Candidate inspection exploration, Balanced %" value={form.tuning.candidateExploreBalanced} onChange={(value) => setTuning("candidateExploreBalanced", value)} />
            <NumberField label="Candidate inspection exploration, Exploratory %" value={form.tuning.candidateExploreExploratory} onChange={(value) => setTuning("candidateExploreExploratory", value)} />
            <NumberField label="Multi-seed bonus" value={form.tuning.multiSeedBonus} onChange={(value) => setTuning("multiSeedBonus", value)} />
            <NumberField label="Pool low-water" value={form.tuning.poolLowWater} onChange={(value) => setTuning("poolLowWater", value)} />
            <NumberField label="Pool high-water" value={form.tuning.poolHighWater} onChange={(value) => setTuning("poolHighWater", value)} />
            <NumberField label="Seed Following max scrolls" value={form.tuning.seedMaxScrolls} onChange={(value) => setTuning("seedMaxScrolls", value)} />
            <NumberField label="Seed scrolls with no new usernames" value={form.tuning.seedStaleScrolls} onChange={(value) => setTuning("seedStaleScrolls", value)} />
            <NumberField label="Commercial intent weight" value={form.tuning.commercialIntentWeight} onChange={(value) => setTuning("commercialIntentWeight", value)} />
            <NumberField label="Source yield weight" value={form.tuning.sourceYieldWeight} onChange={(value) => setTuning("sourceYieldWeight", value)} />
            <NumberField label="Network confidence weight" value={form.tuning.networkConfidenceWeight} onChange={(value) => setTuning("networkConfidenceWeight", value)} />
            <NumberField label="Empty seed cooldown, first visit (minutes)" value={form.tuning.seedCooldownFirstMinutes} onChange={(value) => setTuning("seedCooldownFirstMinutes", value)} />
            <NumberField label="Empty seed cooldown, second visit (minutes)" value={form.tuning.seedCooldownSecondMinutes} onChange={(value) => setTuning("seedCooldownSecondMinutes", value)} />
            <NumberField label="Empty seed cooldown, third visit (minutes)" value={form.tuning.seedCooldownThirdMinutes} onChange={(value) => setTuning("seedCooldownThirdMinutes", value)} />
            <NumberField label="Approved prospects before keyword suggestions" value={form.tuning.keywordSuggestionMinimum} onChange={(value) => setTuning("keywordSuggestionMinimum", value)} />
            <NumberField label="Home Feed share, Low %" value={form.tuning.homeFeedLow} onChange={(value) => setTuning("homeFeedLow", value)} />
            <NumberField label="Home Feed share, Medium %" value={form.tuning.homeFeedMedium} onChange={(value) => setTuning("homeFeedMedium", value)} />
            <NumberField label="Home Feed share, High %" value={form.tuning.homeFeedHigh} onChange={(value) => setTuning("homeFeedHigh", value)} />
            <NumberField label="Seed preference, Conservative %" value={form.tuning.seedShareConservative} onChange={(value) => setTuning("seedShareConservative", value)} />
            <NumberField label="Seed preference, Balanced %" value={form.tuning.seedShareBalanced} onChange={(value) => setTuning("seedShareBalanced", value)} />
            <NumberField label="Seed preference, Exploratory %" value={form.tuning.seedShareExploratory} onChange={(value) => setTuning("seedShareExploratory", value)} />
            <NumberField label="Yield strength weight, Low" value={form.tuning.yieldWeightLow} onChange={(value) => setTuning("yieldWeightLow", value)} />
            <NumberField label="Yield strength weight, Medium" value={form.tuning.yieldWeightMedium} onChange={(value) => setTuning("yieldWeightMedium", value)} />
            <NumberField label="Yield strength weight, High" value={form.tuning.yieldWeightHigh} onChange={(value) => setTuning("yieldWeightHigh", value)} />
            <NumberField label="High-yield candidate bonus" value={form.tuning.highYieldCandidateBonus} onChange={(value) => setTuning("highYieldCandidateBonus", value)} />
            <NumberField label="Seed source baseline" value={form.tuning.sourceBaseSeed} onChange={(value) => setTuning("sourceBaseSeed", value)} />
            <NumberField label="Suggested Accounts baseline" value={form.tuning.sourceBaseSuggested} onChange={(value) => setTuning("sourceBaseSuggested", value)} />
            <NumberField label="Home Feed baseline" value={form.tuning.sourceBaseHome} onChange={(value) => setTuning("sourceBaseHome", value)} />
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={pending || migrationNeeded}
            onClick={() => {
              const tuning = { ...DEFAULT_DISCOVERY_TUNING };
              setForm({ ...form, tuning });
              run(() => saveDiscoveryOptimization({ ...form, tuning, positiveKeywords: lines(positive), negativeKeywords: lines(negative) }));
            }}
          >
            Reset to recommended defaults
          </button>
        </details>
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
            setNegative(DEFAULT_NEGATIVE_KEYWORDS.join("\n"));
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

function labelStrategy(value: string) {
  if (value === "conservative") return "Conservative";
  if (value === "exploratory") return "Exploratory";
  return "Balanced";
}

function labelSource(value: string) {
  if (value === "auto_promoted") return "Auto-promoted";
  if (value === "system_imported") return "Imported";
  return "Manual";
}
