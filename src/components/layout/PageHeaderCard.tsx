import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { AutoBreadcrumb } from "./AutoBreadcrumb";

/**
 * The page header, as its own card.
 *
 * Taken from the FlowDesk reference: every screen opens with a white rounded
 * card carrying the page title on the left and the breadcrumb trail on the
 * right, sitting above the content rather than floating on the page ground.
 *
 * Two things it buys beyond looking deliberate:
 *
 *  · The breadcrumb finally has somewhere to live. This product is 303 screens
 *    across 9 nav groups, and a user three levels into Compliance or Finance
 *    had no on-screen indication of where they were or how to step back.
 *  · A card gives the title a surface, so the eye reads "header · content"
 *    instead of one continuous scroll that happens to start with bold text.
 *
 * `subtitle` keeps the existing page convention — every page opens with a
 * one-line plain-English description — rather than dropping it for the sake of
 * matching the reference exactly. The reference has no equivalent, but on a
 * product whose users are not software people the sentence earns its place.
 */
export type Crumb = { label: string; href?: string };

export function PageHeaderCard({
  title,
  subtitle,
  breadcrumb,
  actions,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Trail after Dashboard. Omit it and the trail is derived from the URL
   *  using the sidebar's labels (see AutoBreadcrumb). */
  breadcrumb?: Crumb[];
  /** Buttons for the right of the card, under the breadcrumb. */
  actions?: React.ReactNode;
  /** Anything a detail page shows under its title — status chips, provenance,
   *  a metadata line. Sits in the left column under the subtitle. */
  children?: React.ReactNode;
}) {
  return (
    <div className="card-surface flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6 sm:py-5">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle mt-1">{subtitle}</p>}
        {children}
      </div>

      <div className="flex min-w-0 max-w-full flex-col items-start gap-2 sm:items-end">
        {breadcrumb ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs">
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Home className="size-3.5" aria-hidden /> Dashboard
            </Link>
            {breadcrumb.map((c, i) => {
              const last = i === breadcrumb.length - 1;
              return (
                <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
                  {last || !c.href ? (
                    <span aria-current={last ? "page" : undefined} className="truncate font-semibold text-foreground">{c.label}</span>
                  ) : (
                    <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">{c.label}</Link>
                  )}
                </span>
              );
            })}
          </nav>
        ) : (
          <AutoBreadcrumb />
        )}
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
    </div>
  );
}
