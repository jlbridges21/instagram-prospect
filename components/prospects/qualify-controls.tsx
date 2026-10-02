"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { qualifyProspectAction } from "@/lib/actions/qualify";
import { AI_BATCH_LIMIT, AI_CONCURRENCY } from "@/lib/ai/config";
import { FIT_LABELS_TEXT, type FitLabel, type ProspectStatus } from "@/lib/constants/prospects";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function QualifyButton({
  id,
  analyzed,
}: {
  id: string;
  analyzed: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(force: boolean) {
    startTransition(async () => {
      const result = await qualifyProspectAction(id, force);
      setConfirm(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const label = FIT_LABELS_TEXT[result.fitLabel as FitLabel] ?? result.fitLabel;
      toast.success(
        result.cached
          ? `Saved analysis: ${label}, score ${result.fitScore}`
          : result.calledModel
            ? `Analyzed: ${label}, score ${result.fitScore}`
            : `${label}. ${result.reason}`,
      );
    });
  }

  return (
    <div>
      <Button
        variant={analyzed ? "secondary" : "primary"}
        disabled={pending}
        onClick={() => (analyzed ? setConfirm(true) : run(false))}
      >
        {pending ? "Analyzing profile..." : analyzed ? "Reanalyze" : "Analyze with AI"}
      </Button>
      <ConfirmDialog
        open={confirm}
        title="Reanalyze this prospect?"
        description="This sends the profile to OpenAI again unless the saved inputs are unchanged."
        confirmLabel="Reanalyze"
        pending={pending}
        onClose={() => setConfirm(false)}
        onConfirm={() => run(true)}
      />
    </div>
  );
}

export function AnalyzeSelectedButton({
  rows,
}: {
  rows: { id: string; status: ProspectStatus }[];
}) {
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const discovered = rows.filter((row) => row.status === "discovered").slice(0, AI_BATCH_LIMIT);

  async function run() {
    setConfirm(false);
    setPending(true);
    setProgress({ done: 0, total: discovered.length });
    let qualified = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const queue = [...discovered];
    let done = 0;

    async function worker() {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        const result = await qualifyProspectAction(next.id);
        done += 1;
        setProgress({ done, total: discovered.length });
        if (!result.ok) {
          failed += 1;
          if (errors.length < 2) errors.push(result.error);
        } else if (result.qualified) qualified += 1;
        else skipped += 1;
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(AI_CONCURRENCY, discovered.length) }, () => worker()),
    );
    setPending(false);
    setProgress(null);
    const summary = `${qualified} qualified, ${skipped} skipped${failed ? `, ${failed} failed` : ""}`;
    if (failed && qualified + skipped === 0) toast.error(errors[0] ?? summary);
    else toast.success(summary);
  }

  if (discovered.length === 0) return null;

  return (
    <>
      <Button size="sm" disabled={pending} onClick={() => setConfirm(true)}>
        {progress ? `Analyzing ${progress.done} of ${progress.total}` : "Analyze selected"}
      </Button>
      <ConfirmDialog
        open={confirm}
        title={`Analyze ${discovered.length} prospect${discovered.length === 1 ? "" : "s"}?`}
        description={
          rows.length > discovered.length
            ? "Only discovered prospects are analyzed, up to 25 at a time. Qualifying profiles enter the review queue."
            : "Qualifying profiles enter the review queue. Profiles that are not a fit are marked disqualified."
        }
        confirmLabel="Analyze"
        pending={pending}
        onClose={() => setConfirm(false)}
        onConfirm={run}
      />
    </>
  );
}
