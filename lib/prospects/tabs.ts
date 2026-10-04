export const PROSPECT_TABS = [
  {
    id: "review",
    label: "Review",
    help: "Qualified prospects waiting for your decision.",
    empty: "No prospects are waiting for review.",
    next: "Start Discovery",
    href: "/discovery",
  },
  {
    id: "approved",
    label: "Approved",
    help: "Prospects you approved for outreach.",
    empty: "No approved prospects. Approve profiles from Review to add them here.",
    next: null,
    href: null,
  },
  {
    id: "outreach",
    label: "Outreach",
    help: "Approved prospects currently queued or being processed.",
    empty: "No prospects are currently queued. Approved profiles appear here when outreach is prepared.",
    next: null,
    href: null,
  },
  {
    id: "contacted",
    label: "Contacted",
    help: "Prospects whose outreach was completed.",
    empty: "No prospects have been contacted yet.",
    next: null,
    href: null,
  },
  {
    id: "excluded",
    label: "Excluded",
    help: "Profiles that were fully evaluated but did not qualify.",
    empty: "No profiles have been excluded.",
    next: null,
    href: null,
  },
  {
    id: "suppressed",
    label: "Suppressed",
    help: "Profiles blocked before AI, such as already-followed accounts or hard-filter failures.",
    empty: "No profiles have been suppressed before AI.",
    next: null,
    href: null,
  },
] as const;

export type ProspectTabId = (typeof PROSPECT_TABS)[number]["id"];

export function parseProspectTab(value: string): ProspectTabId {
  if (value === "active") return "review";
  const match = PROSPECT_TABS.find((tab) => tab.id === value);
  return match?.id ?? "review";
}

export function prospectTab(id: ProspectTabId) {
  return PROSPECT_TABS.find((tab) => tab.id === id) ?? PROSPECT_TABS[0];
}

export function bulkActionCopy(kind: "approve" | "delete", count: number) {
  if (kind === "approve") {
    return {
      title: `Approve ${count} prospect${count === 1 ? "" : "s"}?`,
      description: "This moves them to Approved, prepares outreach, and keeps the locked outreach message.",
      confirm: `Approve ${count}`,
    };
  }
  return {
    title: `Delete ${count} prospect${count === 1 ? "" : "s"} permanently?`,
    description: "This removes their stored prospect records and related workflow data. This cannot be undone.",
    confirm: `Delete ${count}`,
  };
}
