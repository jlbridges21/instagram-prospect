"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { livePollDelay, pageRefreshNeeded } from "@/lib/discovery/policy";

export function LiveProspectSync() {
  const router = useRouter();

  useEffect(() => {
    let cursor = new Date().toISOString();
    let workerKey = "";
    let timer = 0;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      const visible = document.visibilityState === "visible";
      try {
        if (visible) {
          const response = await fetch(`/api/prospects/changes?since=${encodeURIComponent(cursor)}`, { cache: "no-store" });
          if (response.ok) {
            const body = (await response.json()) as { changed?: boolean; cursor?: string; workerTask?: string | null; workerEvent?: string | null };
            if (body.cursor) cursor = body.cursor;
            const nextKey = `${body.workerTask ?? ""}|${body.workerEvent ?? ""}`;
            const statusChanged = workerKey !== "" && nextKey !== workerKey;
            workerKey = nextKey;
            if (pageRefreshNeeded(body.changed === true) || statusChanged) router.refresh();
          }
        }
      } catch {
        // A missed poll retries on the next interval.
      }
      timer = window.setTimeout(tick, livePollDelay(visible));
    }

    timer = window.setTimeout(tick, livePollDelay(true));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [router]);

  return null;
}
