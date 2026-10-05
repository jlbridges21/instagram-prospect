export const NAV_ITEMS = [
  { href: "/", label: "Overview", hint: "Control center", icon: "overview" },
  { href: "/discovery", label: "Discovery", hint: "Find new prospects", icon: "discovery" },
  { href: "/prospects", label: "Prospects", hint: "Everyone captured", icon: "prospects" },
  { href: "/review", label: "Review Queue", hint: "Waiting for approval", icon: "review" },
  { href: "/outreach", label: "Outreach Queue", hint: "Send sequence", icon: "outreach" },
  { href: "/follow-ups", label: "Follow-Ups", hint: "Later conversations", icon: "followups" },
  { href: "/analytics", label: "Analytics", hint: "Results", icon: "analytics" },
  { href: "/worker", label: "Worker", hint: "Windows automation", icon: "worker" },
  { href: "/settings", label: "Settings", hint: "Rules and pacing", icon: "settings" },
] as const;

export type NavIcon = (typeof NAV_ITEMS)[number]["icon"];

export function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
