"use client";

import { livePollDelay } from "@/lib/discovery/policy";

export type DashboardStatus = {
  online: boolean;
  machineName: string | null;
  lastHeartbeatAt: string | null;
  discoveryEnabled: boolean;
  outreachEnabled: boolean;
  username: string | null;
  currentAction: string | null;
  reviewCount: number;
  reviewTarget: number | "unlimited";
  hourlyLimit: number;
  hourly: { count: number; limit: number; resumesAt: string } | null;
  stopReason: string | null;
  queueCount: number;
  nextEligibleAt?: string | null;
  paceAt?: string | null;
  paceReason?: string | null;
  paceUsername?: string | null;
  remaining?: number;
  fresh?: number;
  retrying?: number;
  failedCount?: number;
  sentToday?: number;
  scheduledToday?: number;
  contactedCount?: number;
  hourlyMaximum?: number;
  dailyMaximum?: number;
  minimumSpacingSeconds?: number;
  attentionReason: string | null;
  browser?: { state: "connected" | "restarting" | "closed" | "failed"; reason: string | null } | null;
  reportedVersion: string | null;
  requiredVersion: string;
  command?: { error_code?: string | null; error_message?: string | null; status?: string } | null;
  polledAt?: number;
};

type Listener = (status: DashboardStatus) => void;

let current: DashboardStatus | null = null;
let timer = 0;
let listening = false;
const listeners = new Set<Listener>();

export function subscribeDashboardStatus(listener: Listener) {
  listeners.add(listener);
  if (current) listener(current);
  ensurePolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

export function dashboardStatusSnapshot() {
  return current;
}

export function dashboardListenerCount() {
  return listeners.size;
}

function ensurePolling() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", onVisible);
  void tick();
}

function stopPolling() {
  listening = false;
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  document.removeEventListener("visibilitychange", onVisible);
}

function onVisible() {
  if (document.visibilityState === "visible") void tick();
}

async function tick() {
  window.clearTimeout(timer);
  if (!listening) return;
  try {
    const response = await fetch("/api/dashboard/worker-status", { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as DashboardStatus;
      current = { ...body, polledAt: Date.now() };
      for (const listener of listeners) listener(current);
    }
  } catch {
    // The next poll retries.
  }
  if (listening) timer = window.setTimeout(() => void tick(), livePollDelay(document.visibilityState === "visible"));
}
