"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Send, Settings, Users, X } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { Logo } from "@/components/layout/logo";
import { NAV_ITEMS, isNavItemActive } from "@/lib/constants/navigation";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/prospects", label: "Prospects", icon: Users },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function MobileHeader({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const initial = email.trim().charAt(0).toUpperCase() || "S";

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070d]/90 px-4 backdrop-blur-xl md:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo compact priority />
            <span className="text-[15px] font-semibold tracking-tight text-slate-50">ShootPortal</span>
          </Link>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-slate-100"
            aria-label="Account menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            {initial}
          </button>
        </div>
      </header>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close account menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-white/10 bg-[#0b1020] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl transition duration-200 motion-reduce:transition-none">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-50">Account</p>
                <p className="text-xs text-slate-400">{email}</p>
              </div>
              <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="grid gap-1" aria-label="More">
              {NAV_ITEMS.filter((item) => !TABS.some((tab) => tab.href === item.href)).map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-xl px-3 text-sm text-slate-200">
                  {item.label}
                </Link>
              ))}
            </nav>
            <form action={logout} className="mt-3">
              <button type="submit" className="min-h-12 w-full rounded-xl border border-white/10 text-sm font-medium text-slate-200">
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#080b12]/95 backdrop-blur-xl md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Mobile">
      <div className="grid grid-cols-4">
        {TABS.map((tab) => {
          const active = tab.href === "/prospects" ? pathname === "/prospects" || pathname.startsWith("/prospects/") || pathname === "/review" : isNavItemActive(pathname, tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-indigo-300" : "text-slate-500")}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
