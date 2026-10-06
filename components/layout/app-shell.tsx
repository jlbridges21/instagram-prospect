"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribeDashboardStatus, type DashboardStatus } from "@/components/worker/status-poll";
import {
  CalendarClock,
  ChartColumn,
  LayoutDashboard,
  Radar,
  ListChecks,
  Menu,
  PanelLeft,
  Send,
  Monitor,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { NAV_ITEMS, isNavItemActive, type NavIcon } from "@/lib/constants/navigation";
import { Logo } from "@/components/layout/logo";
import { MobileBottomNav, MobileHeader } from "@/components/mobile/mobile-chrome";
import { WorkerWidget } from "@/components/worker/worker-widget";
import { cn } from "@/lib/utils/cn";

const icons: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  discovery: Radar,
  prospects: Users,
  review: ListChecks,
  outreach: Send,
  followups: CalendarClock,
  analytics: ChartColumn,
  worker: Monitor,
  settings: Settings,
};

const SIDEBAR_KEY = "shootportal-sidebar";
const SIDEBAR_EVENT = "shootportal-sidebar";

function subscribeSidebar(onChange: () => void) {
  window.addEventListener(SIDEBAR_EVENT, onChange);
  return () => window.removeEventListener(SIDEBAR_EVENT, onChange);
}

function sidebarCollapsed() {
  return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
}

export function AppShell({
  email,
  workerOnline,
  timeZone,
  reviewCount = 0,
  strip,
  children,
}: {
  email: string;
  workerOnline: boolean;
  timeZone: string;
  reviewCount?: number;
  strip: {
    discovery: string;
    discoveryDetail: string;
    reviewDetail: string;
    outreach: string;
    outreachDetail: string;
    workerDetail: string;
  };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeSidebar, sidebarCollapsed, () => false);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [live, setLive] = useState<DashboardStatus | null>(null);
  const open = openPath === pathname;
  const reviewLive = live?.reviewCount ?? reviewCount;
  const reviewValue = live ? `${live.reviewCount} waiting` : strip.reviewDetail;
  const outreachDetail = live ? `${live.queueCount} queued · ${live.contactedCount ?? 0} contacted` : strip.outreachDetail;

  useEffect(() => subscribeDashboardStatus(setLive), []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenPath(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleSidebar() {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "open" : "collapsed");
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  }

  return (
    <div className="portal min-h-screen text-slate-100" style={{ ["--side" as string]: collapsed ? "4.75rem" : "16rem" }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/10 bg-[#080b12]/90 backdrop-blur-xl lg:flex", collapsed ? "w-[4.75rem]" : "w-64")}>
        <SidebarContent email={email} pathname={pathname} workerOnline={workerOnline} reviewCount={reviewLive} collapsed={collapsed} onToggle={toggleSidebar} />
      </aside>
      <div className={cn("transition-[padding]", collapsed ? "lg:pl-[4.75rem]" : "lg:pl-64")}>
        <MobileHeader email={email} />
        {live?.attentionReason ? <p className="border-b border-red-400/30 bg-red-500/15 px-4 py-2 text-sm text-red-100 md:hidden">{live.attentionReason}</p> : null}
        <header className="sticky top-0 z-20 hidden border-b border-white/10 bg-[#05070d]/80 px-4 py-3 backdrop-blur-xl md:block">
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <Logo compact />
            <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-lg" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpenPath(open ? null : pathname)}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <StatusCard href="/discovery" label="Discovery" value={strip.discovery} detail={strip.discoveryDetail} />
            <StatusCard href="/review" label="Review" value={reviewValue} detail="Waiting for a decision" />
            <StatusCard href="/outreach" label="Outreach" value={strip.outreach} detail={outreachDetail} />
            <StatusCard href="/worker" label="Worker" value={workerOnline ? "CONNECTED" : "OFFLINE"} detail={strip.workerDetail} live={workerOnline} />
          </div>
        </header>
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close navigation" onClick={() => setOpenPath(null)} />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[#080b12]">
              <SidebarContent email={email} pathname={pathname} workerOnline={workerOnline} reviewCount={reviewLive} collapsed={false} onNavigate={() => setOpenPath(null)} onToggle={toggleSidebar} />
            </div>
          </div>
        ) : null}
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-6 pb-36 sm:px-6 lg:px-8">
          {children}
          <div className="h-[calc(4.75rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
        </main>
      </div>
      <MobileBottomNav />
      <WorkerWidget timeZone={timeZone} />
    </div>
  );
}

function StatusCard({ href, label, value, detail, live = false }: { href: string; label: string; value: string; detail: string; live?: boolean }) {
  return (
    <Link href={href} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 hover:border-sky-400/40">
      <p className="text-[11px] font-medium tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-slate-50">
        {live ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#22c55e]" aria-hidden /> : null}
        <span className="truncate">{value}</span>
      </p>
      <p className="truncate text-xs text-slate-400">{detail}</p>
    </Link>
  );
}

function SidebarContent({
  email,
  pathname,
  workerOnline,
  reviewCount,
  collapsed,
  onNavigate,
  onToggle,
}: {
  email: string;
  pathname: string;
  workerOnline: boolean;
  reviewCount: number;
  collapsed: boolean;
  onNavigate?: () => void;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-4">
        {collapsed ? <Logo compact /> : <Logo />}
        <button type="button" className="hidden rounded-lg p-2 text-slate-400 hover:bg-white/5 lg:inline-flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggle}>
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const Icon = icons[item.icon];
          const active = isNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2",
                active ? "bg-blue-500/15 text-sky-100 shadow-[0_8px_24px_rgba(59,130,246,0.12)]" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                collapsed && "justify-center px-2",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {collapsed ? null : (
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {item.label}
                    {item.href === "/review" && reviewCount > 0 ? <span className="rounded-md bg-blue-500/20 px-1.5 text-xs tabular-nums text-sky-200">{reviewCount}</span> : null}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">{item.hint}</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <p className={cn("flex items-center gap-2 text-xs text-slate-400", collapsed && "justify-center")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", workerOnline ? "bg-emerald-400" : "bg-slate-500")} aria-hidden />
          {collapsed ? null : workerOnline ? "Worker connected" : "Worker offline"}
        </p>
        {collapsed ? null : <p className="mt-2 truncate text-xs text-slate-500" title={email}>{email}</p>}
        <form action={logout} className="mt-2">
          <button type="submit" className="w-full rounded-lg px-2 py-2 text-left text-sm text-slate-400 hover:bg-white/5 hover:text-slate-100">
            {collapsed ? "Out" : "Sign out"}
          </button>
        </form>
      </div>
    </>
  );
}
