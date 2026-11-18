"use client";

/**
 * The packages side by side, each with the full breakdown the server computed:
 * Monthly · Half-yearly · Yearly (highlighted), or — for a firm's first
 * purchase — the 6-month commitment and Yearly, with a note that monthly
 * billing opens up after the commitment. Used by /pricing and by Billing, so a
 * firm sees the same card in both places. Stacks on a phone.
 */

import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { cycleLabel, inr, type CycleKey, type CycleQuote } from "@/lib/billing/aum-pricing";

const pct = (bp: number) => `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

export function PackageCards({
  quotes,
  tierLabel,
  onChoose,
  busy,
  current,
  chooseLabel = "Choose",
  disabled = false,
}: {
  quotes: CycleQuote[];
  tierLabel: string;
  onChoose?: (cycle: CycleKey) => void;
  busy?: CycleKey | null;
  current?: CycleKey | null;
  chooseLabel?: string;
  disabled?: boolean;
}) {
  const commitment = quotes.find((q) => q.cycle === "commitment") ?? null;
  return (
    <div className="space-y-3">
      <div className={cn("grid gap-4", quotes.length === 2 ? "md:grid-cols-2 max-w-4xl" : "md:grid-cols-3")}>
        {quotes.map((q) => {
          const best = q.cycle === "yearly";
          const label = cycleLabel(q.cycle, q.months);
          return (
            <section
              key={q.cycle}
              aria-label={`${label} package`}
              className={cn("card-surface p-5 flex flex-col", best && "ring-2 ring-primary")}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="section-title">{label}</h3>
                {q.discountBp > 0 && <Badge tone={best ? "accent" : "info"} raw>Save {pct(q.discountBp)}</Badge>}
              </div>
              <p className="section-subtitle mt-0.5">
                {q.cycle === "commitment"
                  ? `${q.months} months, paid upfront · then monthly, or switch to half-yearly or yearly`
                  : `${q.months === 1 ? "Billed every month" : `Billed every ${q.months} months`} · auto-renews`}
              </p>

              <div className="mt-4">
                <div className="text-3xl font-bold tabular-nums">{inr(q.totalPaise)}</div>
                <div className="text-sm text-muted-foreground">
                  {q.cycle === "commitment" ? `for the first ${q.months} months` : `per ${q.months === 1 ? "month" : `${q.months} months`}`}, incl. GST
                </div>
                {q.months > 1 && (
                  <div className="text-sm text-muted-foreground">≈ {inr(q.effectiveMonthlyPaise)} a month</div>
                )}
                {q.savingVsMonthlyPaise > 0 && (
                  <div className="mt-1 text-sm font-medium text-success">You save {inr(q.savingVsMonthlyPaise)} vs monthly</div>
                )}
              </div>

              <dl className="mt-4 space-y-1.5 text-sm border-t border-border pt-3 flex-1">
                <Row label={`Maintenance (${tierLabel})`} value={`${inr(q.maintenanceMonthlyPaise)}/mo`} />
                <Row label={`${q.users} user${q.users === 1 ? "" : "s"} × ${inr(q.perUserMonthlyPaise)}`} value={`${inr(q.usersMonthlyPaise)}/mo`} />
                <Row label={`Subtotal (${q.months} mo)`} value={inr(q.subtotalPaise)} />
                {q.discountPaise > 0 && <Row label={`Discount ${pct(q.discountBp)}`} value={`− ${inr(q.discountPaise)}`} />}
                <Row label={`GST ${pct(q.gstBp)}`} value={inr(q.gstPaise)} />
                {q.roundOffPaise !== 0 && <Row label="Round off" value={inr(q.roundOffPaise)} />}
                <Row label="Total" value={inr(q.totalPaise)} strong />
              </dl>

              {onChoose && (
                <Button
                  className="mt-4 w-full"
                  variant={best ? "primary" : "secondary"}
                  loading={busy === q.cycle}
                  disabled={disabled || (busy != null && busy !== q.cycle)}
                  onClick={() => onChoose(q.cycle)}
                  icon={current === q.cycle ? <Check className="size-4" /> : undefined}
                >
                  {current === q.cycle ? "Current package" : `${chooseLabel} ${label.toLowerCase()}`}
                </Button>
              )}
            </section>
          );
        })}
      </div>
      {commitment && (
        <p className="text-sm text-muted-foreground">
          Your first purchase is the {commitment.months}-month commitment or yearly. Monthly and half-yearly billing become available after
          the first {commitment.months} months.
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "font-semibold border-t border-border pt-1.5")}>
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap">{value}</dd>
    </div>
  );
}
