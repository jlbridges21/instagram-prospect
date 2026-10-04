export const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/prospects", label: "Prospects", icon: "prospects" },
  { href: "/discovery", label: "Discovery", icon: "discovery" },
  { href: "/review", label: "Review Queue", icon: "review" },
  { href: "/outreach", label: "Outreach Queue", icon: "outreach" },
  { href: "/follow-ups", label: "Follow-Ups", icon: "followups" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/worker", label: "Worker", icon: "worker" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

export type NavIcon = (typeof NAV_ITEMS)[number]["icon"];

export function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
