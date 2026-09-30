import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { AutoBreadcrumb } from "./AutoBreadcrumb";

/** Shared page heading: location, title, supporting text, and contextual actions. */
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
  /** Trail after Dashboard; falls back to the current route's labels. */
  breadcrumb?: Crumb[];
  /** Contextual actions aligned with the title. */
  actions?: React.ReactNode;
  /** Status chips or metadata below the subtitle. */
  children?: React.ReactNode;
}) {
  return (
    <header className="page-heading space-y-4">
      <div className="min-w-0 max-w-full">
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
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle mt-2 max-w-2xl">{subtitle}</p>}
          {children}
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

