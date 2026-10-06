"use client";

import { useState, useTransition } from "react";
import { startOptimizationWindow } from "@/lib/actions/seeds";

export function QualityMarkerButton() {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3">
      <button
        type="button"
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
        disabled={pending}
        onClick={() => start(async () => {
          const result = await startOptimizationWindow();
          setMessage(result.ok ? result.message ?? "Started." : result.error);
        })}
      >
        Start measuring from now
      </button>
      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
