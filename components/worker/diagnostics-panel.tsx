"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";
import type { WorkerCommandType } from "@/lib/worker/commands";

const TOOLS: { type: WorkerCommandType; title: string; body: string; confirm?: string }[] = [
  { type: "run_discovery_test", title: "Test Discovery — 10 Profiles", body: "What it will do: inspect up to 10 profiles and may create prospects or run AI. What it may change: Review prospects. What it will not do: Follow, send a DM, or change the saved Review target." },
  { type: "run_outreach_preview", title: "Preview Next Outreach", body: "What it will do: open the next eligible approved prospect and check the planned Follow and DM. What it may change: nothing is saved as sent. What it will not do: Follow or send a DM." },
  { type: "run_one_outreach", title: "Run One Outreach", body: "What it will do: process one eligible approved prospect, then stop. What it may change: a real Follow and one DM if every safety check passes. What it will not do: continue through the rest of the queue.", confirm: "This will perform a real outreach action." },
  { type: "recover_outreach", title: "Recover Interrupted Outreach", body: "What it will do: check an interrupted Follow or DM and recover the recorded state. What it may change: the stored outreach step. What it will not do: blindly repeat a Follow or DM." },
  { type: "inspect_dm", title: "Test Instagram DM Detection", body: "What it will do: open the profile and Direct UI and check the recipient. What it may change: the open browser tab. What it will not do: type or send." },
  { type: "inspect_composer", title: "Test Message Composer", body: "What it will do: load the locked message and read it back. What it may change: an unsent draft can remain. What it will not do: send the message." },
];

export function DiagnosticsPanel({ disabled }: { disabled: boolean }) {
  const [username, setUsername] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<WorkerCommandType | null>(null);

  function send(type: WorkerCommandType) {
    if (type === "run_one_outreach") {
      setConfirm(type);
      return;
    }
    const needsName = type === "inspect_dm" || type === "inspect_composer";
    startTransition(async () => {
      const result = await requestWorkerCommand(type, needsName ? { username: username.replace(/^@/, "") } : {});
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Command sent.");
    });
  }

  return (
    <section id="diagnostics" className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Tools and diagnostics</h2>
      <p className="mt-1 text-sm text-slate-500">These use the same checks as the local worker. They are disabled while the worker is offline.</p>
      <label className="mt-3 block text-xs text-slate-500">
        Instagram username
        <input aria-label="Instagram username" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="vsiaerial" />
      </label>
      <div className="mt-3 space-y-3">
        {TOOLS.map((tool) => (
          <div key={tool.type} className="rounded-xl border border-slate-100 p-3">
            <p className="font-medium text-slate-900">{tool.title}</p>
            <p className="mt-1 text-sm text-slate-600">{tool.body}</p>
            <button type="button" className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50" disabled={disabled || pending} onClick={() => send(tool.type)}>
              {pending ? "Sending..." : tool.title}
            </button>
          </div>
        ))}
      </div>
      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <p className="font-semibold">Run One Outreach</p>
            <p className="mt-2 text-sm text-slate-600">This will perform a real outreach action.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-white" onClick={() => { setConfirm(null); startTransition(async () => { const result = await requestWorkerCommand("run_one_outreach", {}); if (!result.ok) toast.error(result.error); else toast.success(result.message ?? "Sent."); }); }}>Run One Outreach</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
