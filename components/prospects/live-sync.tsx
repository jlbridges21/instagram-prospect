"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { livePollDelay, pageRefreshNeeded } from "@/lib/discovery/policy";

export function LiveProspectSync({ notice = false }: { notice?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

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
            if (notice && body.changed) setPending(true);
            else if (pageRefreshNeeded(body.changed === true) || statusChanged) router.refresh();
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
  }, [notice, router]);

  if (!pending) return null;
  return (
    <div className="mb-3 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
      <p>New prospects are available. The current page, filters, and selection stay put.</p>
      <button type="button" className="rounded-lg bg-indigo-600 px-2 py-1 text-xs text-white" onClick={() => { setPending(false); router.refresh(); }}>
        Show
      </button>
    </div>
  );
}
