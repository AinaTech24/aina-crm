/**
 * §8 investment flow, §9 redemption watch, §10 new-client acquisition.
 *
 * Flows only. Current AUM appears nowhere in this file — the brief is explicit
 * that a balance and the money that moved must not share a table, because a
 * market rally then reads as sales.
 */

import Link from "next/link";
import { ArrowLeftRight, TrendingDown, UserPlus } from "lucide-react";
import type { Acquisition, InvestmentFlow } from "@/lib/dashboard/branch/sections";
import type { RedemptionWatch } from "@/lib/dashboard/my/pipeline";
import { CategoryTag, Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { formatCount, formatDate, formatMoney, formatPercent, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ToggleChips } from "./BranchPerformance";

/* ─────────────────────────── §8 investment flow ─────────────────────────── */

export function BranchInvestmentFlow({
  data, hrefs, rmHref,
}: {
  data: InvestmentFlow;
  hrefs: Record<"mtd" | "fytd", string>;
  rmHref: (id: string) => string;
}) {
  const b = data.buckets;
  const tot = b ? b.reduce((s, x) => ({ p: s.p + x.purchase, r: s.r + x.redemption }), { p: 0, r: 0 }) : null;
  return (
    <Section
      title="Investment flow by product"
      subtitle={`Gross purchase, redemption and net — ${data.horizon === "mtd" ? "month to date" : "FY to date"}.`}
      icon={<ArrowLeftRight className="size-4" />}
      action={
        <ToggleChips
          label="Flow horizon"
          current={data.horizon}
          hrefs={hrefs}
          options={[{ key: "mtd", label: "MTD" }, { key: "fytd", label: "FYTD" }]}
        />
      }
      note="From Business Entries (confirmed and e-mailed), the same source as the Results MIS — the RTA ledger has no SIF, AIF or PMS rows and often no scheme category. Totals can therefore differ from the KPI strip by timing and coverage. Switch and STP count as purchase into the target product, as in the MIS. Current AUM is deliberately not shown here."
    >
      {!b ? (
        <Unavailable>
          No business entry has ever been recorded for this branch, so there is no product split to show.
          The split comes from Business Entries, not from the RTA feed.
        </Unavailable>
      ) : (
        <>
          <Table
            rows={b.length}
            empty="Nothing recorded."
            head={
              <>
                <th scope="col">Product</th>
                <th scope="col" className="text-right">Gross purchase</th>
                <th scope="col" className="text-right">Redemption</th>
                <th scope="col" className="text-right">Net</th>
              </>
            }
          >
            {b.map((x) => (
              <tr key={x.key}>
                <td className="py-2.5 font-medium">{x.label}</td>
                <Num>{x.purchase ? formatMoney(x.purchase) : <span className="text-muted-foreground">—</span>}</Num>
                <Num>{x.redemption ? formatMoney(x.redemption) : <span className="text-muted-foreground">—</span>}</Num>
                <Num tone={x.net < 0 ? "warn" : "neutral"}>{x.purchase || x.redemption ? formatMoney(x.net) : <span className="text-muted-foreground">—</span>}</Num>
              </tr>
            ))}
            {tot && (
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2.5">Total</td>
                <Num>{formatMoney(tot.p)}</Num>
                <Num>{formatMoney(tot.r)}</Num>
                <Num>{formatMoney(tot.p - tot.r)}</Num>
              </tr>
            )}
          </Table>

          <h3 className="mb-2 mt-5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">By RM</h3>
          <Table
            rows={data.byRm.length}
            empty="No business entries in this window."
            head={
              <>
                <th scope="col">RM</th>
                <th scope="col" className="text-right">Purchase</th>
                <th scope="col" className="text-right">Redemption</th>
                <th scope="col" className="text-right">Net</th>
              </>
            }
          >
            {data.byRm.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5">
                  {r.id.startsWith("__") ? <span className="text-muted-foreground">{r.name}</span>
                    : <Link href={rmHref(r.id)} className="font-medium hover:text-primary hover:underline">{r.name}</Link>}
                </td>
                <Num>{formatMoney(r.purchase)}</Num>
                <Num>{formatMoney(r.redemption)}</Num>
                <Num tone={r.net < 0 ? "warn" : "neutral"}>{formatMoney(r.net)}</Num>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}

/* ─────────────────────────── §9 redemption watch ─────────────────────────── */

export const HV_PRESETS = [500_000, 1_000_000, 2_500_000, 5_000_000] as const;

export function BranchRedemptions({
  data, periodLabel, presetHrefs, customAction, customHidden, showRm, personal = false,
}: {
  /** The RM desk's wording ("my book") instead of the branch's. */
  personal?: boolean;
  data: RedemptionWatch;
  periodLabel: string;
  /** One link per preset threshold, keeping every other param. */
  presetHrefs: Array<{ value: number; href: string }>;
  /** The form target for a custom threshold, and the params to carry through it. */
  customAction: string;
  customHidden: Array<[string, string]>;
  showRm: boolean;
}) {
  const t = data.highValueThreshold;
  const isPreset = (HV_PRESETS as readonly number[]).includes(t);
  return (
    <Section
      title="Redemption watch"
      subtitle={personal
        ? `Money that left my book in ${periodLabel}, and whether I have followed up.`
        : `Money that left the branch in ${periodLabel}, and whether anyone has followed up.`}
      icon={<TrendingDown className="size-4" />}
      action={<SectionLink href="/dashboard/reports/redemption">Redemption report</SectionLink>}
      note="A redemption is not automatically a problem — a client funding a house is not churning. The reason is shown where the feed recorded one. Follow-up means a task has been raised on the client since the redemption date."
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-2xs text-muted-foreground">Large redemption from</span>
        {presetHrefs.map((p) => (
          <Link
            key={p.value}
            href={p.href}
            scroll={false}
            aria-current={p.value === t ? "true" : undefined}
            className={cn(
              "inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-semibold transition-colors",
              p.value === t ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {formatMoney(p.value, { decimals: 0 })}+
          </Link>
        ))}
        {/* A plain GET form: a custom threshold needs no client JavaScript, and
            the other filters ride along as hidden fields. */}
        <form action={customAction} method="get" className="inline-flex items-center gap-1">
          {customHidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="hv-custom">Custom threshold in rupees</label>
          <input
            id="hv-custom"
            name="hv"
            type="number"
            min={10000}
            step={10000}
            defaultValue={isPreset ? undefined : t}
            placeholder="Custom ₹"
            className="h-7 w-28 rounded-md border border-border bg-card px-2 text-2xs tabular-nums"
          />
          <button type="submit" className="inline-flex h-7 items-center rounded-md bg-secondary px-2 text-2xs font-semibold text-foreground hover:bg-accent">
            Apply
          </button>
        </form>
      </div>

      {data.total == null ? (
        <Unavailable>{personal ? "No redemption has ever been recorded against your clients." : "No redemption has ever been recorded for this branch's clients."}</Unavailable>
      ) : (
        <>
          <StatGrid cols={4}>
            <Stat label="Total redemption" value={data.total} format="currency" hint={periodLabel} />
            <Stat label="Clients redeemed" value={data.clients} />
            <Stat label="Large redemptions" value={data.highValue} tone={data.highValue > 0 ? "warn" : "neutral"}
                  hint={`${formatMoney(t)} and above`} />
            <Stat label="Follow-up pending" value={data.followUpPending} tone={data.followUpPending > 0 ? "warn" : "neutral"}
                  hint="no task raised since" />
          </StatGrid>
          <div className="mt-4">
            <Table
              rows={data.rows.length}
              empty="Nothing redeemed in this period."
              head={
                <>
                  {showRm && <th scope="col">RM</th>}
                  <th scope="col">Client</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="text-right" title="Remaining AUM plus this redemption — an approximation of the relationship before the exit.">AUM before</th>
                  <th scope="col" className="text-right">Amount</th>
                  <th scope="col">Product</th>
                  <th scope="col">Date</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Follow-up</th>
                </>
              }
            >
              {data.rows.map((r) => {
                const large = r.amount >= t;
                return (
                  <tr key={r.id}>
                    {showRm && <td className="py-2.5 text-xs">{r.rm ?? <span className="text-muted-foreground">No RM</span>}</td>}
                    <td className="py-2.5">
                      <Link href={`/dashboard/investors/${r.clientId}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                    </td>
                    <td className="py-2.5"><CategoryTag value={r.category} /></td>
                    <Num>{formatMoney(r.aum + r.amount)}</Num>
                    <Num tone={large ? "warn" : "neutral"}>{formatMoney(r.amount)}</Num>
                    <td className="max-w-xs truncate py-2.5 text-xs" title={r.product ?? undefined}>
                      {r.product ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 text-xs">{formatDate(r.date)}</td>
                    <td className="py-2.5 text-xs">
                      {r.reason ? humanise(r.reason) : <span className="text-muted-foreground" title="No reason was recorded. That is not the same as no reason.">Not recorded</span>}
                    </td>
                    <td className="py-2.5">
                      {r.followedUp ? (
                        <span className="chip bg-success/10 text-success">Followed up</span>
                      ) : large ? (
                        <span className="chip bg-destructive/10 text-destructive" title="A large redemption with no task raised since — critical by the firm's threshold.">Pending</span>
                      ) : (
                        <span className="chip bg-secondary text-secondary-foreground">None yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            {data.rows.length >= 12 && (
              <p className="mt-2 text-2xs text-muted-foreground">The twelve largest are listed; the counts above cover every redemption in the period.</p>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

/* ─────────────────────────── §10 acquisition ─────────────────────────── */

export function BranchAcquisition({
  data, periodLabel, rmHref, newClientsHref,
}: {
  data: Acquisition;
  periodLabel: string;
  rmHref: (id: string) => string;
  newClientsHref: string;
}) {
  const pct = data.periodTarget != null && data.periodTarget > 0 ? data.actual / data.periodTarget : null;
  const peak = Math.max(1, ...data.byRm.map((r) => Math.max(r.actual, r.target ?? 0)));
  const srcPeak = Math.max(1, ...data.sources.map((s) => s.clients));
  return (
    <Section
      title="New client acquisition"
      subtitle={`Clients added in ${periodLabel}, against target, and where they came from.`}
      icon={<UserPlus className="size-4" />}
      action={<SectionLink href={newClientsHref}>New clients</SectionLink>}
      note="Source is read from the lead each client was converted from. A client keyed in directly (or imported from the RTA) has no lead and is counted as “Not recorded” — never guessed into a source. Only source values that actually occur are listed."
    >
      <StatGrid cols={5}>
        <Stat label="Target" value={data.periodTarget} unavailable={data.fyTarget == null ? "No new-client target set." : "Target phasing is off, so this period has no target."} />
        <Stat label="Actual" value={data.actual} href={newClientsHref} />
        <Stat label="Achievement" value={pct} format="percent" unavailable="No target to measure against."
              tone={pct == null ? "neutral" : pct >= 1 ? "good" : "neutral"} />
        <Stat label="Previous month" value={data.previousMonth} />
        <Stat label="FY to date" value={data.fytd} hint={data.fyTarget != null ? `of ${formatCount(data.fyTarget)} for the year` : undefined} />
      </StatGrid>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Target vs added, by RM</h3>
          {data.byRm.length === 0 ? (
            <Unavailable>No relationship managers in this view.</Unavailable>
          ) : (
            <div className="space-y-2">
              {data.byRm.map((r) => (
                <div key={r.id} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={rmHref(r.id)} className="truncate hover:text-primary hover:underline">{r.name}</Link>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{formatCount(r.actual)}</span>
                      {" / "}
                      {r.target == null ? <span title="No target for this RM and period.">—</span> : formatCount(Math.round(r.target * 10) / 10)}
                    </span>
                  </div>
                  <div className="relative mt-1 h-2 rounded-full bg-secondary" aria-hidden>
                    {r.target != null && (
                      <span className="absolute inset-y-0 left-0 rounded-full border border-primary/40"
                            style={{ width: `${(r.target / peak) * 100}%` }} />
                    )}
                    <span className="absolute inset-y-0 left-0 rounded-full bg-primary/70"
                          style={{ width: `${(r.actual / peak) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-2xs text-muted-foreground">Filled bar: clients added. Outline: the RM&apos;s target for the period.</p>
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">By source</h3>
          {data.sources.length === 0 ? (
            <Unavailable>No new clients in {periodLabel}.</Unavailable>
          ) : (
            <div className="space-y-1.5">
              {data.sources.map((s) => (
                <div key={s.source} className="grid grid-cols-12 items-center gap-2 text-xs">
                  <span className={cn("col-span-5 truncate", s.source === "__none__" && "text-muted-foreground")}>{s.label}</span>
                  <span className="col-span-5 h-2 rounded-full bg-secondary" aria-hidden>
                    <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(s.clients / srcPeak) * 100}%` }} />
                  </span>
                  <span className="col-span-2 text-right tabular-nums font-medium">{formatCount(s.clients)}</span>
                </div>
              ))}
              {data.actual > 0 && (
                <p className="pt-1 text-2xs text-muted-foreground">
                  {formatPercent((data.sources.find((s) => s.source === "__none__")?.clients ?? 0) / data.actual * 100, 0)} of new
                  clients have no recorded source.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

