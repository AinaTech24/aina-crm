"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { NAV_LABELS, SETTINGS_HOMED } from "@/lib/nav-labels";

/**
 * Breadcrumb derived from the URL, for the 250 pages that never had one.
 *
 * Each path prefix that matches a sidebar route becomes a crumb with the
 * sidebar's own label; a segment nobody named (an id, "new", "edit") falls
 * back to a readable word. Record ids never appear — the crumb for a detail
 * page reads "Details", not a UUID.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const words = (seg: string) =>
  seg === "new" ? "New" : seg === "edit" ? "Edit" : UUID.test(seg) || /^\d+$/.test(seg) ? "Details"
  : seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function AutoBreadcrumb({ current }: { current?: string }) {
  const pathname = usePathname() ?? "/dashboard";
  const segs = pathname.split("/").filter(Boolean); // ["dashboard", "leads", "<id>"]
  const crumbs: { label: string; href?: string }[] = [];
  let acc = "";
  for (let i = 1; i < segs.length; i++) {
    acc += "/" + segs.slice(1, i + 1).join("/");
    const href = "/dashboard" + acc.replace(/^\/dashboard/, "");
    const label = NAV_LABELS[href] ?? words(segs[i]);
    crumbs.push({ label, href });
    acc = "";
  }
  // A page that lives in Settings says so.
  if (crumbs[0]?.href && SETTINGS_HOMED.has(crumbs[0].href)) crumbs.unshift({ label: "Settings", href: "/dashboard/settings" });
  if (crumbs.length === 0) crumbs.push({ label: current ?? "Overview" });
  else if (current) crumbs[crumbs.length - 1] = { label: current };

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
        <Home className="size-3.5" aria-hidden /> Dashboard
      </Link>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
            {last || !c.href ? (
              <span aria-current="page" className="truncate font-semibold text-foreground">{c.label}</span>
            ) : (
              <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">{c.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
