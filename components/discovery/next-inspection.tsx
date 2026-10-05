"use client";

import { useEffect, useState } from "react";
import { LiveCountdown } from "@/components/ui/live-countdown";
import { subscribeDashboardStatus, type DashboardStatus } from "@/components/worker/status-poll";

export function NextInspectionCountdown({
  initialAt,
  enabled,
}: {
  initialAt: string | null;
  enabled: boolean;
}) {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  useEffect(() => subscribeDashboardStatus(setStatus), []);
  if (!enabled) return null;
  const target = status?.hourly?.resumesAt ?? initialAt;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-slate-500">Next profile inspection</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">
        {target ? <LiveCountdown targetAt={target} /> : "Eligible now"}
      </p>
    </div>
  );
}
