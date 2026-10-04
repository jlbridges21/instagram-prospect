"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChartColumn,
  LayoutDashboard,
  Radar,
  ListChecks,
  Menu,
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

export function AppShell({
  email,
  workerOnline,
  timeZone,
  children,
}: {
  email: string;
  workerOnline: boolean;
  timeZone: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenPath(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <SidebarContent email={email} pathname={pathname} workerOnline={workerOnline} />
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
          <Logo compact />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpenPath(open ? null : pathname)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="Close navigation"
              onClick={() => setOpenPath(null)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-sm">
              <SidebarContent
                email={email}
                pathname={pathname}
                workerOnline={workerOnline}
                onNavigate={() => setOpenPath(null)}
              />
            </div>
          </div>
        ) : null}
        <main id="main" className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
      <WorkerWidget timeZone={timeZone} />
    </div>
  );
}

function SidebarContent({
  email,
  pathname,
  workerOnline,
  onNavigate,
}: {
  email: string;
  pathname: string;
  workerOnline: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="border-b border-slate-200 px-5 py-5">
        <Logo />
        <p className="mt-3 text-xs font-medium tracking-wide text-slate-500">Outreach</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const Icon = icons[item.icon];
          const active = isNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                active
                  ? "bg-indigo-50 font-semibold text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <p className="flex items-center gap-2 px-2 pb-2 text-xs text-slate-500">
          <span
            className={cn("h-1.5 w-1.5 rounded-full", workerOnline ? "bg-green-600" : "bg-slate-300")}
            aria-hidden
          />
          {workerOnline ? "Worker connected" : "Worker offline"}
        </p>
        <p className="truncate px-2 text-xs text-slate-500" title={email}>
          {email}
        </p>
        <form action={logout} className="mt-2">
          <button
            type="submit"
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
