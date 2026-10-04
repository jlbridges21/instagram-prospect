export type WidgetSnapshot = {
  online: boolean;
  attention: boolean;
  discoveryEnabled: boolean;
  outreachEnabled: boolean;
  hourlyWaiting: boolean;
  commandStatus: "queued" | "running" | null;
  currentTask: string | null;
  error: boolean;
};

export function widgetState(input: WidgetSnapshot) {
  if (!input.online) return { state: "offline" as const, title: "Worker offline", tone: "offline" as const };
  if (input.attention || input.currentTask === "attention_required" || input.currentTask === "auth_required") {
    return { state: "attention" as const, title: "Worker needs attention", tone: "attention" as const };
  }
  if (input.error) return { state: "error" as const, title: "Worker needs attention", tone: "attention" as const };
  if (input.commandStatus === "running") return { state: "command_running" as const, title: "Worker running a command", tone: "running" as const };
  if (input.commandStatus === "queued") return { state: "command_pending" as const, title: "Command pending", tone: "running" as const };
  if (input.hourlyWaiting && input.discoveryEnabled) {
    return { state: "discovery_waiting" as const, title: "Discovery waiting", tone: "waiting" as const };
  }
  if (input.discoveryEnabled && input.outreachEnabled) {
    return { state: "both" as const, title: "Discovery and Outreach running", tone: "running" as const };
  }
  if (input.discoveryEnabled) return { state: "discovery" as const, title: "Discovery running", tone: "running" as const };
  if (input.outreachEnabled) return { state: "outreach" as const, title: "Outreach running", tone: "running" as const };
  return { state: "ready" as const, title: "Worker ready", tone: "ready" as const };
}

export function executionEnabled(online: boolean) {
  return online;
}
