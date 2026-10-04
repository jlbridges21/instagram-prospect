export type ProspectListView = "active" | "review" | "approved" | "outreach" | "contacted" | "excluded" | "all";

export type ProspectViewFields = {
  status: string;
  already_following: boolean;
  fit_label: string | null;
  queued?: boolean;
};

const excludedStatus = new Set(["disqualified", "skipped"]);

export function prospectMatchesView(view: ProspectListView, row: ProspectViewFields) {
  if (view === "all") return true;
  if (view === "excluded") return row.already_following || excludedStatus.has(row.status);
  if (view === "review") return row.status === "qualified" || row.status === "review";
  if (view === "approved") return row.status === "approved";
  if (view === "outreach") return row.status === "approved" && row.queued === true;
  if (view === "contacted") {
    return ["contacted", "replied", "follow_up", "demo_booked", "converted"].includes(row.status);
  }
  return !row.already_following && !excludedStatus.has(row.status) && row.status !== "converted";
}
