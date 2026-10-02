"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setDiscoveryEnabled } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";

export function DiscoveryControls({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();

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
    </div>
  );
}
