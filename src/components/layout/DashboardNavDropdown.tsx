"use client";

/**
 * Combined "Dashboards" sidebar item — a single collapsible entry that holds the
 * default Dashboard + the user's custom Boards (My Dashboards), instead of two
 * separate top-level nav links. Rendered at the top of the sidebar nav.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const sub = items && items.length ? items : DEFAULT_SUB;
  const onDash = sub.some((s) => isOn(pathname, s.href));
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
            const active = isOn(pathname, s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`block rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  active ? "bg-brand-cyan-light/50 text-brand-cyan-deep font-medium" : "text-muted-foreground hover:bg-brand-cyan-light/40 hover:text-foreground"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
