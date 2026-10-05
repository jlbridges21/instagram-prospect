export const FILTER_PANEL_DEFAULT_OPEN = false;

export function toggleFilterPanel(open: boolean) {
  return !open;
}

export function activeFilterCount(query: {
  q: string;
  status: string;
  fit: string;
  category: string;
  source: string;
  minFollowers: string;
  maxFollowers: string;
  sort: string;
}) {
  let count = 0;
  if (query.q.trim()) count += 1;
  if (query.status !== "all") count += 1;
  if (query.fit !== "all") count += 1;
  if (query.category.trim()) count += 1;
  if (query.source) count += 1;
  if (query.minFollowers.trim()) count += 1;
  if (query.maxFollowers.trim()) count += 1;
  if (query.sort !== "newest") count += 1;
  return count;
}

export function filterButtonLabel(open: boolean, count: number) {
  if (open) return "Hide filters";
  if (count > 0) return `Filter · ${count}`;
  return "Filter";
}
