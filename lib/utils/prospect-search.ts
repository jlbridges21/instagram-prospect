import type { ProspectQuery } from "@/lib/db/prospects";

export function prospectSearchString(query: ProspectQuery, page = query.page) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status !== "all") params.set("status", query.status);
  if (query.fit !== "all") params.set("fit", query.fit);
  if (query.category) params.set("category", query.category);
  if (query.source) params.set("source", query.source);
  if (query.minFollowers) params.set("min", query.minFollowers);
  if (query.maxFollowers) params.set("max", query.maxFollowers);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (page > 1) params.set("page", String(page));
  const value = params.toString();
  return value ? `?${value}` : "";
}
