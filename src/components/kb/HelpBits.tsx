/**
 * Shared pieces of the public help centre: the banner with breadcrumb + search,
 * and the folder block (a folder's first articles with "View all N").
 */

import Link from "next/link";
import { ChevronRight, FileText, FolderOpen, Search } from "lucide-react";
import type { HelpFolder } from "@/lib/kb/help";

export type Crumb = { label: string; href?: string };

export function HelpBanner({
  title,
  crumbs,
  subtitle,
  q = "",
}: {
  title: string;
  crumbs: Crumb[];
  subtitle?: string | null;
  q?: string;
}) {
  return (
    <section className="bg-primary text-primary-foreground print:hidden">
      <div className="max-w-6xl mx-auto px-6 pt-5 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs font-semibold">
            {crumbs.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 opacity-70" />}
                {c.href ? (
                  <Link href={c.href} className="underline underline-offset-2 hover:opacity-80">{c.label}</Link>
                ) : (
                  <span className="opacity-90">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          <form action="/knowledge-base/search" method="get" role="search" className="flex w-full sm:w-80">
            <input
              name="q"
              defaultValue={q}
              placeholder="Find some solutions here…"
              aria-label="Search the knowledge base"
              className="min-w-0 flex-1 rounded-l-md border-0 bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/60"
            />
            <button type="submit" aria-label="Search" className="rounded-r-md bg-white/90 px-3 text-foreground border-l border-border hover:bg-white">
              <Search className="size-4" />
            </button>
          </form>
        </div>
        <h1 className="mt-10 text-3xl sm:text-4xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm opacity-90">{subtitle}</p>}
      </div>
    </section>
  );
}

export function FolderBlock({ folder, limit = 3 }: { folder: HelpFolder; limit?: number }) {
  const shown = folder.articles.slice(0, limit);
  return (
    <div className="p-5">
      <Link
        href={`/knowledge-base/folder/${folder.slug}`}
        className="inline-flex items-center gap-2 font-bold text-foreground hover:text-primary"
      >
        <FolderOpen className="size-5 text-muted-foreground" />
        {folder.name} <span className="font-semibold text-muted-foreground">({folder.count})</span>
      </Link>
      <ul className="mt-3 space-y-2.5 pl-7">
        {shown.map((a) => (
          <li key={a.id} className="flex items-start gap-2 text-sm">
            <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
            <Link href={`/knowledge-base/${a.slug}`} className="text-primary hover:underline">
              {a.title}
            </Link>
          </li>
        ))}
        {folder.count > shown.length && (
          <li>
            <Link href={`/knowledge-base/folder/${folder.slug}`} className="text-xs font-semibold text-muted-foreground hover:text-primary">
              View all {folder.count}
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
