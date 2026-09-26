"use client";

/**
 * Card — the standard content surface, plus a real header slot.
 *
 * `card-surface` in globals.css already fixes the *look* of a card. What it
 * cannot fix is that every card builds its own header out of ad-hoc divs, which
 * is why headings, sub-labels and the "view all" link sit at different sizes and
 * positions from one screen to the next.
 *
 * `<Card>` + `<CardHeader>` gives that structure one definition:
 *
 *   <Card>
 *     <CardHeader title="Lead pipeline" subtitle="9 open" action={<Link…>All leads</Link>} />
 *     <CardBody>…</CardBody>
 *   </Card>
 *
 * `padded={false}` is for cards whose body is a table — the table owns its own
 * edge padding via `.table-scroll`, and doubling it is what makes some lists
 * look inset and others flush.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  elevated = false,
  /** Adds `h-full` so a row of cards is never one tall and one short. */
  equal = false,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
  equal?: boolean;
}) {
  return (
    <div className={cn(elevated ? "card-elevated" : "card-surface", equal && "card-equal", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  /** One plain-English line. Say what the card answers, not what it contains. */
  subtitle?: ReactNode;
  icon?: ReactNode;
  /** Right-aligned slot — a link, a filter, a menu. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="shrink-0 text-muted-foreground mt-0.5">{icon}</span>}
        <div className="min-w-0">
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="section-subtitle mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cn(padded && "px-5 pb-5", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-5 py-3 border-t border-border flex items-center justify-between gap-3", className)}>
      {children}
    </div>
  );
}
