/**
 * The frame every dashboard widget sits in: title, an optional count line, an
 * (i) for a definition, "Filter not applied" when a dashboard filter does not
 * reach this card, a "View all" link, and the ⋯ menu (Filter this card /
 * Export CSV). SERVER component; the menu is the only client part.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { WidgetSize } from "@/lib/dashboards/system/catalog";
import { WidgetMenu } from "./WidgetMenu";

export const SIZE_CLASS: Record<WidgetSize, string> = {
  S: "col-span-12 md:col-span-6 xl:col-span-4",
  M: "col-span-12 xl:col-span-6",
  L: "col-span-12",
};

export function WidgetCard({
  size,
  title,
  subtitle,
  info,
  notApplied,
  href,
  hrefLabel = "View all",
  menu,
  cardFilterLabel,
  children,
  flush = false,
}: {
  size: WidgetSize;
  title: string;
  subtitle?: string;
  info?: string;
  /** Labels of active dashboard filters this card cannot use. */
  notApplied?: string[];
  href?: string;
  hrefLabel?: string;
  menu?: { dashboardId: string; instanceId: string; csv: boolean; exportQuery: string; cardFilter: boolean; title: string };
  /** The viewer's personal filter on this card, e.g. "This month". */
  cardFilterLabel?: string;
  children: ReactNode;
  /** Body is a table that owns its own edge padding. */
  flush?: boolean;
}) {
  return (
    <section className={`${SIZE_CLASS[size]} min-w-0`}>
      <Card equal className="h-full flex flex-col">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              {title}
              {info && (
                <span className="text-muted-foreground cursor-help" title={info} aria-label={info}>
                  <Info className="size-3.5" aria-hidden />
                </span>
              )}
            </span>
          }
          subtitle={
            subtitle || cardFilterLabel || notApplied?.length ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {subtitle && <span>{subtitle}</span>}
                {cardFilterLabel && <span className="text-foreground">Card filter: {cardFilterLabel}</span>}
                {notApplied?.length ? (
                  <span className="text-muted-foreground" title={`Not applied to this card: ${notApplied.join(", ")}`}>
                    Filter not applied
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
          action={
            <>
              {href && (
                <Link href={href} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
                  {hrefLabel}
                </Link>
              )}
              {menu && <WidgetMenu {...menu} />}
            </>
          }
        />
        <CardBody padded={!flush} className="flex-1 min-w-0">
          {children}
        </CardBody>
      </Card>
    </section>
  );
}

/** A card-shaped skeleton for the one page-level loading state. */
export function WidgetSkeleton({ size, lines = 4 }: { size: WidgetSize; lines?: number }) {
  return (
    <section className={`${SIZE_CLASS[size]} min-w-0`} aria-hidden>
      <div className="card-surface h-full p-5 space-y-3 animate-pulse">
        <div className="h-4 w-32 rounded bg-secondary" />
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-secondary" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    </section>
  );
}
