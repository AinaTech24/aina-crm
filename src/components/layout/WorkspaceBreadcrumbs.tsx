"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LayoutGrid } from "lucide-react";

/** Use the accessible navigation labels; never expose record IDs in the chrome. */
export function WorkspaceBreadcrumbs({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname() ?? "/dashboard";
  const current = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const label = current?.label ?? (pathname === "/dashboard" ? "Overview" : "Workspace");
  const detail = current && pathname !== current.href;

  return (
    <nav aria-label="Breadcrumb" className="hidden xl:flex min-w-0 items-center gap-2 text-xs">
      <Link href="/dashboard" aria-label="Workspace home" className="btn-icon shrink-0">
        <LayoutGrid className="size-4" />
      </Link>
      <ChevronRight aria-hidden className="size-3 text-muted-foreground/60" />
      {detail ? <Link href={current.href} className="truncate max-w-40 text-muted-foreground hover:text-primary">{label}</Link>
        : <span aria-current="page" className="truncate max-w-44 font-semibold">{label}</span>}
      {detail && <><ChevronRight aria-hidden className="size-3 text-muted-foreground/60" /><span aria-current="page" className="text-muted-foreground">{pathname.endsWith("/new") ? "Create" : "Details"}</span></>}
    </nav>
  );
}
