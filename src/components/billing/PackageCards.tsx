"use client";

/**
 * The packages side by side, each with the full breakdown the server computed:
 * Monthly · Half-yearly · Yearly (Best value), or — for a firm's first
 * purchase — the 6-month commitment and Yearly, with a note that monthly
 * billing opens up after the commitment. Used by /pricing (appearance "site",
 * the public site's palette) and by Billing (the app's), so a firm sees the
 * same card in both places. Stacks on a phone.
 *
 * A card leads with what is paid and what it buys; the line-by-line breakdown
 * (maintenance, users, discount, GST, round off) folds under "Price breakdown".
 */

import { Check, ChevronDown, Info, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { cycleLabel, inr, type CycleKey, type CycleQuote } from "@/lib/billing/aum-pricing";

const pct = (bp: number) => `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

const TAGLINE: Record<CycleKey, string> = {
  commitment: "Start here — one payment for your first months.",
  monthly: "Pay as you go, month by month.",
  half_yearly: "Two payments a year, at a lower price.",
  yearly: "One payment a year, at the best price.",
};

function points(q: CycleQuote): string[] {
  const out: string[] = [];
  if (q.cycle === "commitment") {
    out.push(`${q.months} months paid upfront, full monthly price`);
    out.push("Then monthly, or switch to half-yearly or yearly");
  } else if (q.cycle === "monthly") {
    out.push("Billed every month");
  } else {
    out.push(`One payment every ${q.months} months`);
  }
  if (q.discountBp > 0) out.push(`${pct(q.discountBp)} off the whole bill`);
  out.push(`${q.users} CRM user${q.users === 1 ? "" : "s"} included`);
  out.push("Auto-debit renewal — change it any time from Billing");
  out.push("GST tax invoice emailed with every payment");
  return out;
}

export function PackageCards({
  quotes,
  tierLabel,
  onChoose,
  busy,
  current,
  chooseLabel = "Choose",
  disabled = false,
  appearance = "app",
}: {
  quotes: CycleQuote[];
  tierLabel: string;
  onChoose?: (cycle: CycleKey) => void;
  busy?: CycleKey | null;
  current?: CycleKey | null;
  chooseLabel?: string;
  disabled?: boolean;
  /** "site" — the public site's cream / crimson; "app" — the CRM's tokens. */
  appearance?: "app" | "site";
}) {
  const site = appearance === "site";
  const commitment = quotes.find((q) => q.cycle === "commitment") ?? null;
  return (
    <div className="space-y-4">
      <div className={cn("grid gap-5 items-stretch", quotes.length === 2 ? "md:grid-cols-2 max-w-4xl" : "md:grid-cols-3", site && quotes.length === 2 && "mx-auto")}>
        {quotes.map((q) => {
          const best = q.cycle === "yearly";
          const label = cycleLabel(q.cycle, q.months);
          const isCurrent = current === q.cycle;
          return (
            <section
              key={q.cycle}
              aria-label={`${label} package`}
              className={cn(
                "relative flex flex-col p-6",
                site ? "rounded-3xl border bg-site-paper shadow-sm" : "card-surface",
                site && (best ? "border-site-crimson ring-1 ring-site-crimson shadow-lg" : "border-site-sand"),
                !site && best && "ring-2 ring-primary",
                best && "pt-8",
              )}
            >
              {best && (
                <span
                  className={cn(
                    "absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-sm",
                    site ? "bg-site-crimson" : "bg-primary",
                  )}
                >
                  <Sparkles className="size-3.5" aria-hidden /> Best value
                </span>
              )}

              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className={cn("text-lg font-bold", site ? "font-brand text-site-ink" : "text-foreground")}>{label}</h3>
                  <p className={cn("mt-0.5 text-sm", site ? "text-site-muted" : "text-muted-foreground")}>{TAGLINE[q.cycle]}</p>
                </div>
                {q.discountBp > 0 && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                      site ? "bg-site-mint/15 text-site-mint" : "bg-success/10 text-success",
                    )}
                  >
                    Save {pct(q.discountBp)}
                  </span>
                )}
              </div>

              <div className="mt-5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn("text-4xl font-extrabold tracking-tight tabular-nums", site ? "font-brand text-site-ink" : "text-foreground")}>
                    {inr(q.totalPaise)}
                  </span>
                </div>
                <p className={cn("mt-1 text-sm", site ? "text-site-muted" : "text-muted-foreground")}>
                  {q.cycle === "commitment" ? `for the first ${q.months} months` : `every ${q.months === 1 ? "month" : `${q.months} months`}`} · incl. GST
                  {q.months > 1 && <> · ≈ {inr(q.effectiveMonthlyPaise)}/month</>}
                </p>
                {q.savingVsMonthlyPaise > 0 && (
                  <p className={cn("mt-2 inline-flex rounded-lg px-2.5 py-1 text-sm font-semibold", site ? "bg-site-mint/10 text-site-mint" : "bg-success/10 text-success")}>
                    You save {inr(q.savingVsMonthlyPaise)} vs paying monthly
                  </p>
                )}
              </div>

              <ul className="mt-5 space-y-2.5 text-sm flex-1">
                {points(q).map((p) => (
                  <li key={p} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                        site ? "bg-site-ink/5 text-site-ink" : "bg-primary/10 text-primary",
                      )}
                    >
                      <Check className="size-3.5" aria-hidden />
                    </span>
                    <span className={site ? "text-site-text" : "text-foreground"}>{p}</span>
                  </li>
                ))}
              </ul>

              <details className={cn("group mt-5 rounded-xl px-4 py-3 text-sm", site ? "bg-site-cream" : "bg-secondary/70")}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold [&::-webkit-details-marker]:hidden">
                  <span>Price breakdown</span>
                  <span className={cn("inline-flex items-center gap-1 font-normal", site ? "text-site-muted" : "text-muted-foreground")}>
                    {inr(q.taxablePaise)} + GST
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <dl className="mt-3 space-y-1.5">
                  <Row site={site} label={`Maintenance (${tierLabel})`} value={`${inr(q.maintenanceMonthlyPaise)}/mo`} />
                  <Row site={site} label={`${q.users} user${q.users === 1 ? "" : "s"} × ${inr(q.perUserMonthlyPaise)}`} value={`${inr(q.usersMonthlyPaise)}/mo`} />
                  <Row site={site} label={`Subtotal (${q.months} mo)`} value={inr(q.subtotalPaise)} />
                  {q.discountPaise > 0 && <Row site={site} label={`Discount ${pct(q.discountBp)}`} value={`− ${inr(q.discountPaise)}`} />}
                  <Row site={site} label={`GST ${pct(q.gstBp)}`} value={inr(q.gstPaise)} />
                  {q.roundOffPaise !== 0 && <Row site={site} label="Round off" value={inr(q.roundOffPaise)} />}
                  <Row site={site} label="Total" value={inr(q.totalPaise)} strong />
                </dl>
              </details>

              {onChoose &&
                (site ? (
                  <button
                    type="button"
                    onClick={() => onChoose(q.cycle)}
                    disabled={disabled || (busy != null && busy !== q.cycle) || busy === q.cycle}
                    className={cn(
                      "mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
                      best
                        ? "bg-site-crimson text-white hover:bg-site-crimson-deep"
                        : "border border-site-ink/20 bg-white text-site-ink hover:border-site-ink/40 hover:bg-site-cream",
                    )}
                  >
                    {isCurrent && <Check className="size-4" aria-hidden />}
                    {isCurrent ? "Current package" : `${chooseLabel} ${label.toLowerCase()}`}
                  </button>
                ) : (
                  <Button
                    className="mt-5 w-full"
                    variant={best ? "primary" : "secondary"}
                    loading={busy === q.cycle}
                    disabled={disabled || (busy != null && busy !== q.cycle)}
                    onClick={() => onChoose(q.cycle)}
                    icon={isCurrent ? <Check className="size-4" /> : undefined}
                  >
                    {isCurrent ? "Current package" : `${chooseLabel} ${label.toLowerCase()}`}
                  </Button>
                ))}
            </section>
          );
        })}
      </div>
      {commitment && (
        <p
          className={cn(
            "flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm",
            quotes.length === 2 && "max-w-4xl",
            site ? "mx-auto bg-site-paper text-site-muted border border-site-sand" : "bg-secondary/70 text-muted-foreground",
          )}
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Your first purchase is the {commitment.months}-month commitment or yearly. Monthly and half-yearly billing become available after
            the first {commitment.months} months.
          </span>
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong = false, site }: { label: string; value: string; strong?: boolean; site: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "font-semibold border-t pt-1.5", strong && (site ? "border-site-sand" : "border-border"))}>
      <dt className={cn(!strong && (site ? "text-site-muted" : "text-muted-foreground"))}>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap">{value}</dd>
    </div>
  );
}
