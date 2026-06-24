"use client";

/**
 * Combined "Dashboards" sidebar item — a single collapsible entry that holds the
 * default Dashboard + the user's custom Boards (My Dashboards), instead of two
 * separate top-level nav links. Rendered at the top of the sidebar nav.
 */

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ChevronDown } from "lucide-react";

export type DashboardSubItem = { href: string; label: string };

const DEFAULT_SUB: DashboardSubItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/boards", label: "My Dashboards" },
];

const isOn = (pathname: string, href: string) =>
  href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(href + "/");

export function DashboardNavDropdown({ items }: { items?: DashboardSubItem[] }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const sub = items && items.length ? items : DEFAULT_SUB;
  // Pick a SINGLE active item — the longest matching href — so a nested path
  // (e.g. /dashboard/team/scorecard) highlights only "Team Scorecard" and not
  // its parent "Team Dashboard" (/dashboard/team), which is also a prefix match.
  const activeHref = sub
    .filter((s) => isOn(pathname, s.href))
    .reduce<string | null>((best, s) => (best && best.length >= s.href.length ? best : s.href), null);
  const onDash = activeHref !== null;
  const [open, setOpen] = useState(onDash);

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`group nav-link w-full ${onDash ? "nav-link-active" : ""}`}
      >
        <LayoutDashboard className="size-4 shrink-0" />
        <span className="truncate flex-1 text-left sidebar-when-expanded">Dashboards</span>
        <ChevronDown className={`size-3.5 shrink-0 transition-transform sidebar-when-expanded ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="ml-4 pl-3 border-l border-border/60 space-y-0.5 sidebar-when-expanded">
          {sub.map((s) => {
            const active = s.href === activeHref;
            const go = () => router.push(s.href);
            return (
              <div
                key={s.href}
                role="link"
                tabIndex={0}
                onClick={go}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
                className={`block rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                  active ? "bg-brand-cyan-light/50 text-brand-cyan-deep font-medium" : "text-muted-foreground hover:bg-brand-cyan-light/40 hover:text-foreground"
                }`}
              >
                {s.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
