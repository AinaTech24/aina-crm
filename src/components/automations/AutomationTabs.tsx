"use client";

/**
 * Rules · Actions · Run history — the tabs of /dashboard/automations. Each tab
 * is its own route, so a tab is a link (shareable, back-button friendly) and
 * the active one follows the URL.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AutomationTab = { href: string; label: string };

export function AutomationTabs({ tabs }: { tabs: AutomationTab[] }) {
  const pathname = usePathname();
  // The Rules tab is the section root, so it is active only on an exact match.
  const isActive = (href: string) => (href === "/dashboard/automations" ? pathname === href : pathname.startsWith(href));
  return (
    <nav aria-label="Automations sections" className="border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
