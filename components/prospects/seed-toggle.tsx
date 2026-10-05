"use client";

import { useState, useTransition } from "react";
import { toggleProspectSeed } from "@/lib/actions/seeds";

export function ProspectSeedToggle({ prospectId, username, seeded }: { prospectId: string; username: string; seeded: boolean }) {
  const [on, setOn] = useState(seeded);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 text-sm">
      <button
        type="button"
        className="rounded-lg border border-slate-200 px-3 py-2"
        disabled={pending}
        onClick={() => start(async () => {
          const result = await toggleProspectSeed(prospectId, username, !on);
          if (result.ok) {
            setOn(!on);
            setMessage(on ? "Removed from Seeds" : "Discovery Seed ✓");
          } else setMessage(result.error);
        })}
      >
        {on ? "Discovery Seed ✓ · Remove from Seeds" : "Use as Discovery Seed"}
      </button>
      {message ? <p className="mt-2 text-slate-600">{message}</p> : null}
    </div>
  );
}
