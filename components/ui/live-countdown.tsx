"use client";

import { useSyncExternalStore } from "react";
import { liveClockNow, serverClockNow, subscribeLiveClock } from "@/components/ui/live-clock";
import { formatCountdown } from "@/lib/ui/countdown";

export function LiveCountdown({
  targetAt,
  prefix,
}: {
  targetAt: string | number | null | undefined;
  prefix?: string;
}) {
  const now = useSyncExternalStore(subscribeLiveClock, liveClockNow, serverClockNow);

  if (targetAt == null || targetAt === "") return null;
  const label = formatCountdown(targetAt, now);
  return (
    <span className="tabular-nums">
      {prefix ? `${prefix} ` : ""}
      {label}
    </span>
  );
}
