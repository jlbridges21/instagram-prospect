export function mustHeartbeatBeforeClaim(input: {
  mode: "agent" | "smoke" | "login";
  dryRun: boolean;
  singleOutreach: boolean;
  discoveryOnly: boolean;
  noWrite: boolean;
}) {
  if (input.mode !== "agent" || input.dryRun) return false;
  if (input.singleOutreach) return true;
  return !input.discoveryOnly && !input.noWrite;
}

export function createHeartbeatSession(intervalMs: number, beat: () => Promise<void>) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const startInterval = () => {
    if (timer) return;
    timer = setInterval(() => {
      void beat().catch(() => undefined);
    }, Math.max(intervalMs, 1));
  };
  return {
    startInterval,
    async register() {
      await beat();
      startInterval();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    hasInterval() {
      return timer !== null;
    },
  };
}

export async function claimAfterHeartbeat<T>(input: {
  workerId: string;
  heartbeat: (workerId: string) => Promise<void>;
  claim: (workerId: string) => Promise<T>;
}) {
  try {
    await input.heartbeat(input.workerId);
  } catch (error) {
    return { ok: false as const, error };
  }
  const result = await input.claim(input.workerId);
  return { ok: true as const, result };
}

export function safeHeartbeatError(error: unknown) {
  const message = error instanceof Error ? error.message : "The heartbeat request failed.";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}
