import Link from "next/link";
import { Inbox } from "lucide-react";

/**
 * Shared empty-state for dashboard sections — replaces bare "0"/blank panels
 * with a friendly message and an optional call-to-action. Server-safe.
 */
export function DashboardEmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  cta,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  cta?: { href: string; label: string };
  compact?: boolean;
}) {
  // One row. A dashboard with four empty sections should lose four LINES to
  // saying so, not four panels — otherwise the half of the page with no data
  // outweighs the half with data.
  if (compact) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground/60" />
        <span className="text-2xs font-medium text-foreground">{title}</span>
        {hint && <span className="text-2xs text-muted-foreground truncate">{hint}</span>}
        {cta && (
          <Link
            href={cta.href}
            className="ml-auto shrink-0 text-2xs text-muted-foreground hover:text-foreground"
          >
            {cta.label} →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center text-center rounded-lg border border-dashed border-border bg-secondary/30 py-10 px-6">
      <div className="size-9 rounded-full bg-secondary grid place-items-center mb-2">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1 max-w-xs">{hint}</p>}
      {cta && (
        <Link href={cta.href} className="mt-3 btn-secondary text-xs">
          {cta.label}
        </Link>
      )}
    </div>
  );
}
