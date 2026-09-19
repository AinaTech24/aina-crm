import Link from "next/link";

/**
 * The reference's chart-card chrome: an 18px semibold title with a one-line
 * grey subtitle beneath it, an optional pill or link on the right, then the
 * chart. Every analytical card on the dashboard uses this so they read as a
 * set rather than as separately authored panels.
 */
export function FlowChartCard({
  title,
  subtitle,
  pill,
  href,
  hrefLabel = "View",
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  /** Short right-aligned tag, e.g. "Last 7 days" — tinted like the reference. */
  pill?: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card-surface p-6 ${className}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {pill ? (
          <span className="shrink-0 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            {pill}
          </span>
        ) : href ? (
          <Link
            href={href}
            className="shrink-0 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
          >
            {hrefLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
