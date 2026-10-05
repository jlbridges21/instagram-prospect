export const PROFILE_TAB_IDS = ["profile-tab-1", "profile-tab-2"] as const;
export type ProfileTabId = (typeof PROFILE_TAB_IDS)[number];
export const BLANK_TAB_LIMIT_MS = 15_000;

export type ProfileTabObservation = {
  closed: boolean;
  url: string | null;
  crashed: boolean;
  navigationFailed: boolean;
  blankSince: number | null;
  now: number;
};

export function profileTabHealth(tab: ProfileTabObservation) {
  if (tab.closed) return { healthy: false as const, reason: "closed" };
  if (tab.crashed) return { healthy: false as const, reason: "crashed" };
  if (tab.navigationFailed) return { healthy: false as const, reason: "navigation_failed" };
  if (tab.url == null) return { healthy: false as const, reason: "detached" };
  const url = tab.url.trim();
  if (url === "" || url === "about:blank") {
    const since = tab.blankSince ?? tab.now;
    if (tab.now - since >= BLANK_TAB_LIMIT_MS) return { healthy: false as const, reason: "about:blank" };
    return { healthy: true as const, reason: null };
  }
  if (!/instagram\.com/i.test(url)) return { healthy: false as const, reason: "missing_instagram" };
  return { healthy: true as const, reason: null };
}

export function selectInspectionTab(input: {
  tabs: Array<{ id: ProfileTabId; healthy: boolean }>;
  lastUsed: ProfileTabId | null;
}) {
  const repair = input.tabs.filter((tab) => !tab.healthy).map((tab) => tab.id);
  const healthy = input.tabs.filter((tab) => tab.healthy);
  if (healthy.length === 0) return { assign: null as ProfileTabId | null, repair };
  const alternate = healthy.find((tab) => tab.id !== input.lastUsed) ?? healthy[0];
  return { assign: alternate.id, repair };
}

export function browserRestartRequired(input: { contextConnected: boolean }) {
  return !input.contextConnected;
}
