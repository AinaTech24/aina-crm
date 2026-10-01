/**
 * The building blocks the personal cockpit is assembled from.
 *
 * Twenty-four sections is a lot of screen, and the only thing that keeps it
 * readable is that every one of them is made of the SAME four or five pieces.
 * A section that invents its own header, its own stat tile and its own empty
 * state adds a paragraph of visual grammar the reader has to learn before they
 * can read the number.
 *
 * ── The rules these encode ──────────────────────────────────────────────────
 *
 * · A null is never a zero. `Stat` renders "—" for null with a title
 *   explaining why, and `Figure` refuses to print ₹0 for an absent figure.
 * · Colour is a signal. `tone` is the only way to colour a number, there are
 *   four tones, and "neutral" is the default. A section where everything is
 *   amber has said nothing.
 * · Every count is a link. A figure you cannot open is decoration.
 * · Indian notation throughout, via @/lib/format. Nothing here formats money
 *   or dates itself.
 */

import Link from "next/link";
import { Children, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { InfoTip } from "./InfoTip";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ─────────────────────────────── info tip ─────────────────────────────── */

/**
 * The explanation behind a small ⓘ, shown on hover and on tap/focus.
 *
 * The dashboards used to print every section's purpose, every methodology
 * caveat and every "why is this empty" paragraph in full — about 450 pieces of
 * text across the six role dashboards. Read once they are useful; read on
 * every visit they are noise, and they made the pages feel crowded to people
 * who just want the numbers. They now live here: one tap away, never in the way.
 *
 * A client component in ./InfoTip.tsx: hover opens it with a mouse, and a tap
 * focuses the button, which opens it on a phone. Closed it takes no layout
 * space, and open it turns towards the side with room — an invisible popup near
 * a card's right edge used to widen the whole page. The text is the button's DESCRIPTION, so a screen reader hears
 * "What this shows" and then the explanation while the heading around it keeps
 * its short name; a link inside a note stays valid because it never sits inside
 * the button. No arbitrary Tailwind values — they fail silently in this repo.
 */
export { InfoTip };

/* ────────────────────────────── section shell ────────────────────────────── */

export function Section({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
  /** Shown top-right as a quiet caveat — how a figure is measured, what it excludes. */
  note,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  note?: string;
}) {
  // The subtitle (what the section answers) and the note (how it is measured)
  // are explanations, not data. Both move behind one ⓘ beside the title, so a
  // section reads as a title and its numbers.
  const about = subtitle || note;
  return (
    <section className={cn("card-surface p-5 sm:p-6", className)} aria-label={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
        <h2 className="section-title flex min-w-0 items-center gap-1.5">
          {icon && <span className="dash-icon mr-1" aria-hidden>{icon}</span>}
          {title}
          {about && (
            <InfoTip>
              {subtitle && <span className="block">{subtitle}</span>}
              {note && <span className={cn("block", subtitle && "mt-2")}>{note}</span>}
            </InfoTip>
          )}
        </h2>
        {/* Beside the title when it fits, on its own line when not — and never
            wider than the card (a phone has ~300px for it). */}
        {action && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * A right-aligned "open the underlying list" link. Used on nearly every section.
 *
 * `min-h-6` is the repo's 24px hit-target floor. A 16px-tall text link is
 * readable and, on a phone, close to unhittable — measured at 375px, this and
 * the sort chips were the only real controls on the page under the floor.
 */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs font-medium text-primary hover:bg-accent hover:underline"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/* ──────────────────────────────── figures ──────────────────────────────── */

export type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  good: "text-success",
  warn: "text-warning-foreground",
  bad: "text-destructive",
};

/**
 * A formatted figure that knows the difference between zero and unknown.
 *
 * `null` renders an em dash with the reason on hover, never "₹0" or "0%". The
 * brief's rule — "Never interpret missing data as zero" — is enforced at the
 * one place every number passes through, rather than trusted to each caller.
 */
export function Figure({
  value,
  format = "currency",
  unavailable = "Data unavailable — nothing recorded for this yet.",
  decimals,
}: {
  value: number | null | undefined;
  format?: "currency" | "count" | "percent";
  unavailable?: string;
  decimals?: number;
}) {
  if (value == null) {
    return (
      <span className="text-muted-foreground" title={unavailable}>
        —
      </span>
    );
  }
  if (format === "count") return <>{formatCount(value)}</>;
  if (format === "percent") return <>{formatPercent(value * 100, decimals ?? 1)}</>;
  return <>{formatMoney(value, decimals != null ? { decimals } : undefined)}</>;
}

/** One number in a grid of numbers. The workhorse of the whole page. */
export function Stat({
  label,
  value,
  format = "count",
  tone = "neutral",
  hint,
  href,
  unavailable,
  /** Overrides the formatted value entirely — for a figure already in words. */
  display,
}: {
  label: string;
  value?: number | null;
  format?: "currency" | "count" | "percent";
  tone?: Tone;
  hint?: string;
  href?: string;
  unavailable?: string;
  display?: ReactNode;
}) {
  // Quiet zeros. A zero is a fact, not an alarm and not an achievement, so it
  // drops to a lighter grey and loses its sub-line ("Clients 0 · Leads 0…"),
  // leaving the eye free for the figures that need action. `display` is a
  // caller's own wording and is shown as given.
  const zero = display == null && value === 0;
  const empty = display == null && (value == null || value === 0);
  // As a flex item (StatGrid) the tile stretches to its row on its own; only
  // inside a link does it need `h-full` to fill the anchor. A percentage
  // height on the bare tile stopped Chrome from stretching it.
  const body = (
    <div className={cn("dash-tile", href && "h-full")}>
      <div
        className={cn(
          "text-xl tabular-nums leading-tight tracking-tight",
          zero ? "font-medium text-muted-foreground/60" : cn("font-semibold", TONE_TEXT[tone]),
        )}
      >
        {display ?? <Figure value={value} format={format} unavailable={unavailable} />}
      </div>
      <div className="mt-1 text-2xs font-medium leading-snug text-foreground/80">{label}</div>
      {hint && !empty && <div className="text-2xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * A row of stats. Kept here so every section spaces them identically.
 *
 * `cols` is the widest the row should go; the tiles are laid out so that no
 * row is left with one tile alone. Five tiles asked to sit in four columns
 * take one row of five; seven in four take four then three, the three
 * sharing the row (the flex basis in `.dash-stats` does the stretching).
 */
export function StatGrid({ cols = 4, children }: { cols?: 2 | 3 | 4 | 5 | 6; children: ReactNode }) {
  const n = Children.toArray(children).length;
  const perRow = balancedColumns(n, cols);
  return (
    <div
      className="dash-stats"
      style={{ ["--cols-sm" as string]: Math.min(perRow, 3), ["--cols-lg" as string]: perRow }}
    >
      {children}
    </div>
  );
}

/** Tiles per row on a wide screen: never more than `cols`, and no orphan row. */
export function balancedColumns(n: number, cols: number): number {
  if (n <= 0) return cols;
  if (n <= cols) return n;
  let across = cols;
  let rows = Math.ceil(n / cols);
  // One more across than asked when it saves a whole row: five tiles in four
  // columns sit in one row of five, seven in three go four then three rather
  // than three, three and one. Only for modest widths — six across is already
  // as narrow as a small tile can go.
  if (cols <= 4 && Math.ceil(n / (cols + 1)) < rows && n <= 2 * (cols + 1)) {
    across = cols + 1;
    rows = Math.ceil(n / across);
  }
  return Math.ceil(n / rows);
}

/* ──────────────────────────── target meters ──────────────────────────── */

/**
 * Target · Actual · Gap · Achievement, and the FY pace marker.
 *
 * The brief is explicit that a percentage alone is not allowed, and the pace
 * marker is why: 50% of an annual target is ahead in September and a serious
 * problem in February. The bar carries a notch at the elapsed fraction so the
 * reader does not have to do that arithmetic, and the achievement figure is
 * coloured against the PACE, not against 100%.
 */
export function Meter({
  label,
  target,
  actual,
  format,
  pace,
  href,
  missing = "Not set",
  behindLabel = "Gap",
  neutralShortfall = false,
}: {
  /** What the shortfall is called — "Gap", or "Remaining" on the RM desk. */
  behindLabel?: string;
  /**
   * The RM desk shows what REMAINS of a target in ink, not red: mid-month,
   * most of a target is still to come, and red is kept for overdue work.
   */
  neutralShortfall?: boolean;
  label: string;
  /** null = no target set. Renders "Not set", which is not the same as 0%. */
  target: number | null;
  actual: number;
  format: "currency" | "count";
  /** NULL for a balance target — no notch, and only "achieved" is coloured. */
  pace: number | null;
  href: string;
  /** Why there is no target: "Not set" (default) or "Not phased". */
  missing?: string;
}) {
  const pct = target && target > 0 ? actual / target : null;
  const gap = target && target > 0 ? actual - target : null;
  // Unpaced (a balance): green once achieved, otherwise no judgement at all.
  const onPace = pct != null && (pace == null ? pct >= 1 : pct >= pace);
  const judged = pct != null && (pace != null || pct >= 1);
  const fill = pct == null ? 0 : Math.min(100, Math.max(0, pct * 100));

  return (
    <Link href={href} className="dash-tile">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">{label}</span>
        {pct == null ? (
          <span
            className="shrink-0 text-2xs text-muted-foreground"
            title={missing === "Not phased"
              ? "The firm compares annual targets with FY-to-date only, so a shorter period has no target."
              : "No annual target has been set for this metric."}
          >
            {missing}
          </span>
        ) : (
          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", !judged ? "text-foreground" : onPace ? "text-success" : "text-warning-foreground")}>
            {formatPercent(pct * 100, 1)}
          </span>
        )}
      </div>

      <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-border/70">
        <div
          className={cn("h-full rounded-full", pct == null ? "bg-border" : !judged ? "bg-primary/60" : onPace ? "bg-success" : "bg-warning")}
          style={{ width: `${fill}%` }}
        />
        {/* Where the firm SHOULD be by today. Without it a bar is just a bar. */}
        {target != null && target > 0 && pace != null && (
          <span
            aria-hidden
            className="absolute top-0 h-full w-0.5 bg-foreground/45"
            style={{ left: `${Math.min(100, pace * 100)}%` }}
            title={`FY pace today: ${(pace * 100).toFixed(0)}%`}
          />
        )}
      </div>

      <dl className="mt-2.5 grid grid-cols-3 gap-2 text-2xs">
        <div>
          <dt className="text-muted-foreground">Target</dt>
          <dd className="font-medium tabular-nums text-foreground">
            <Figure value={target} format={format} unavailable={missing} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Actual</dt>
          <dd className="font-medium tabular-nums text-foreground">
            <Figure value={actual} format={format} />
          </dd>
        </div>
        <div>
          {/* No target: the shortfall's own name, never "Ahead by" a target that does not exist. */}
          <dt className="text-muted-foreground">{gap != null && gap >= 0 ? "Ahead by" : behindLabel}</dt>
          <dd className={cn("font-medium tabular-nums",
            gap == null ? "text-muted-foreground" : gap >= 0 ? "text-success" : neutralShortfall ? "text-foreground" : "text-destructive")}>
            {gap == null ? "—" : <Figure value={Math.abs(gap)} format={format} />}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

/* ─────────────────────────────── table shell ─────────────────────────────── */

/**
 * A plain table. The app shell already styles every `<table>` under
 * `.dashboard-content` — header, row hover, hairline dividers — so this adds
 * only the horizontal scroll container and a consistent empty state. Reaching
 * for `<DataTable>` here would mean handing it a column spec for fifteen
 * different shapes; this is the honest smaller tool.
 */
export function Table({
  head,
  children,
  empty,
  rows,
}: {
  head: ReactNode;
  children: ReactNode;
  /** One sentence, ending in a full stop. Shown when `rows` is 0. */
  empty: string;
  rows: number;
}) {
  if (rows === 0) {
    return <p className="dash-empty">{empty}</p>;
  }
  return (
    <div className="table-scroll">
      <table className="w-full">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A right-aligned numeric cell, tabular so columns line up. */
export function Num({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <td className={cn("py-2.5 text-right tabular-nums", TONE_TEXT[tone], className)}>{children}</td>;
}

/**
 * Category letter as a quiet marker.
 *
 * Deliberately NOT coloured. Client category is taxonomy — what a client IS —
 * and the repo's badge contract reserves colour for status. An A that glows
 * green spends the same ink as an overdue warning two columns away.
 */
export function CategoryTag({ value }: { value: string | null }) {
  if (!value) return <span className="text-2xs text-muted-foreground" title="No category set for this client.">Not set</span>;
  return <span className="chip bg-secondary text-secondary-foreground">{value}</span>;
}

/**
 * A person's or client's initials in a soft disc, beside their name in a list.
 * Server-safe (no image, no state): the disc says "this row is about someone"
 * at a glance, which is what makes a list of names scannable.
 */
export function Initials({ name, className }: { name: string | null | undefined; className?: string }) {
  const parts = (name ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim().split(/\s+/).filter(Boolean);
  const text = parts.length === 0 ? "?" : (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  return <span className={cn("dash-avatar", className)} aria-hidden>{text}</span>;
}

/**
 * A single quiet line for a figure the CRM cannot currently produce, or an
 * empty list.
 *
 * Only the FIRST sentence is shown ("No new clients in September 2026."); any
 * further explanation — where the figure would come from, why it is missing —
 * sits behind an ⓘ. Most of these read the same every day, and a dashed box of
 * prose per empty section made quiet days look busier than busy ones.
 */
export function Unavailable({ children }: { children: ReactNode }) {
  let first: ReactNode = children;
  let rest: string | null = null;
  if (typeof children === "string") {
    const text = children.replace(/\s+/g, " ").trim();
    const cut = text.search(/[.!?]\s/);
    if (cut > 0) {
      first = text.slice(0, cut + 1);
      rest = text.slice(cut + 2).trim() || null;
    } else {
      first = text;
    }
  }
  return (
    <p className="flex items-center gap-1 py-1 text-xs text-muted-foreground">
      <span>{first}</span>
      {rest && <InfoTip label="More about this">{rest}</InfoTip>}
    </p>
  );
}
