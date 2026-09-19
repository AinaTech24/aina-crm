import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Group({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-foreground/70">
            {title}
          </h2>
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-2xs text-muted-foreground hover:text-foreground font-medium"
          >
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * A labelled band of the dashboard.
 *
 * `Group` above does the same job for a single block of tiles. `Band` wraps
 * SEVERAL cards under one heading, which is what the cockpit actually needed:
 * it had fourteen sections and exactly two headings, so the two looked like
 * mistakes rather than structure. Either every band is labelled or none is.
 */
export function Band({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full brand-bar" />
        <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-foreground/70">
          {title}
        </h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Kpi({
  href,
  icon: Icon,
  label,
  value,
  sub,
  trend,
  accent,
  delta,
  deltaTone,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down";
  accent?: "cyan" | "violet" | "emerald" | "amber";
  hero?: boolean;
  delta?: string;
  deltaTone?: "up" | "down";
}) {
  // Same anatomy as Stat; the chip takes an identity hue from the metric set
  // instead of a severity tone. `hero` is accepted and ignored — the reference
  // has no gradient variant.
  const hue =
    accent === "violet" ? "--metric-violet"
    : accent === "emerald" ? "--metric-emerald"
    : accent === "amber" ? "--metric-amber"
    : "--metric-indigo";
  const dir = deltaTone ?? trend;
  const deltaClass = dir === "up" ? "text-success" : dir === "down" ? "text-destructive" : "text-muted-foreground";
  const inner = (
    <div
      className="card-surface flex h-full items-center gap-3.5 p-5 transition-colors hover:border-foreground/20"
      style={{ ["--c" as string]: `hsl(var(${hue}))` }}
    >
      <span
        className="grid size-10 shrink-0 place-items-center rounded-[10px]"
        style={{ background: "color-mix(in srgb, var(--c) 14%, transparent)", color: "var(--c)" }}
        aria-hidden
      >
        {Icon ? <Icon className="size-[18px]" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-2xl font-semibold leading-none tabular-nums tracking-tight text-foreground">{value}</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm leading-tight text-muted-foreground">
          <span>{label}</span>
          {delta && <span className={`text-2xs font-semibold tabular-nums ${deltaClass}`}>{dir === "down" ? "▼" : "▲"} {delta}</span>}
          {!delta && sub && <span className={`text-2xs ${deltaClass}`}>{sub}</span>}
        </div>
      </div>
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export function Stat({
  href,
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
}) {
  // Reference tile anatomy — tinted chip · figure above label · chevron.
  // The chip carries the severity tone; the figure stays in ink so a row of
  // tiles reads as numbers first and status second.
  const chip =
    tone === "rose" ? "bg-destructive/10 text-destructive"
    : tone === "amber" ? "bg-warning/10 text-warning"
    : tone === "emerald" ? "bg-success/10 text-success"
    : "bg-secondary text-muted-foreground";
  const inner = (
    <div className="card-surface flex h-full items-center gap-3.5 p-5 transition-colors hover:border-foreground/20">
      <span className={`grid size-10 shrink-0 place-items-center rounded-[10px] ${chip}`} aria-hidden>
        {Icon ? <Icon className="size-[18px]" /> : <span className="size-2 rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-2xl font-semibold leading-none tabular-nums tracking-tight text-foreground">{value}</div>
        <div className="mt-1.5 text-sm leading-tight text-muted-foreground">
          {label}
          {sub && <span className="ml-2 text-2xs text-muted-foreground/80">{sub}</span>}
        </div>
      </div>
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}
