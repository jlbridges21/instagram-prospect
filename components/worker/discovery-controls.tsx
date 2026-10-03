"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { fillReview } from "@/lib/actions/discovery";
import { setDiscoveryEnabled } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";

export function DiscoveryControls({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [customTarget, setCustomTarget] = useState("75");

  function toggle() {
    startTransition(async () => {
      const result = await setDiscoveryEnabled(!enabled);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? (enabled ? "Discovery is off." : "Discovery is on."));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Discovery</span>
      <span
        className={
          enabled
            ? "rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
            : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
        }
      >
        {enabled ? "On" : "Off"}
      </span>
      <Button size="sm" variant="secondary" disabled={pending} onClick={toggle}>
        {enabled ? "Turn discovery off" : "Turn discovery on"}
      </Button>
      {[20, 50, 100].map((target) => (
        <Button
          key={target}
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await fillReview(target);
              if (!result.ok) toast.error(result.error);
              else toast.success(result.message ?? `Fill review to ${target}.`);
            })
          }
        >
          Fill Review to {target}
        </Button>
      ))}
      <input
        aria-label="Custom review target"
        className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-xs"
        inputMode="numeric"
        value={customTarget}
        onChange={(event) => setCustomTarget(event.target.value)}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await fillReview(Number.parseInt(customTarget, 10));
            if (!result.ok) toast.error(result.error);
            else toast.success(result.message ?? "Fill review started.");
          })
        }
      >
        Fill Review to custom
      </Button>
    </div>
  );
}
