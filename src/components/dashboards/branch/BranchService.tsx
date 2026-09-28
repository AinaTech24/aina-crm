/**
 * §20 insurance snapshot, §24 operations snapshot, §25 management attention.
 *
 * The first two are deliberately SLICES, not dashboards: the brief says the
 * branch head does not need the full insurance or operations views, only the
 * branch's share of them, with a door into the full view.
 */

import Link from "next/link";
import { AlertOctagon, Shield, Wrench } from "lucide-react";
import type { AttentionItem, InsuranceSnapshot, OpsSnapshot } from "@/lib/dashboard/branch/sections";
import type { RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import { Figure, Section, SectionLink, Stat, StatGrid, Unavailable } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney, pluralDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RmTable, rmRows } from "./RmTable";

/* ─────────────────────────── §20 insurance ─────────────────────────── */

export function BranchInsurance({
  data, ledger, rmHref, periodLabel, showRm,
}: {
  data: InsuranceSnapshot;
  ledger: RmLedgerRow[];
  rmHref: (id: string) => string;
  periodLabel: string;
  showRm: boolean;
}) {
  const sellers = ledger.filter((r) => r.insurance > 0 || (r.kind === "person" && r.isRm));
  return (
    <Section
      title="Insurance — branch snapshot"
      subtitle={`Premium booked through the branch in ${periodLabel}, and what is due.`}
      icon={<Shield className="size-4" />}
      action={<SectionLink href="/dashboard/insurance">Open insurance</SectionLink>}
      note="New premium is cover that started in the period; renewal premium is premium collected in the period on cover that started earlier. Premium is attributed to the branch the policy was booked in and to the person who sold it."
    >
      {data.totalPremium == null ? (
        <Unavailable>No insurance policy is recorded against this branch, so there is nothing to show.</Unavailable>
      ) : (
        <>
          <StatGrid cols={6}>
            <Stat label="New premium" value={data.newPremium} format="currency" />
            <Stat label="Renewal premium" value={data.renewalPremium} format="currency" />
            <Stat label="Total premium" value={data.totalPremium} format="currency" />
            <Stat label="Active policies" value={data.policies} href="/dashboard/insurance?status=active" />
            <Stat label="Renewals due (30d)" value={data.renewalsDue30} tone={data.renewalsDue30 > 0 ? "warn" : "neutral"}
                  href="/dashboard/insurance?due=1" />
            <Stat label="Open claims" value={data.openClaims} tone={data.openClaims > 0 ? "warn" : "neutral"}
                  href="/dashboard/insurance-claims" />
          </StatGrid>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {data.byLine.map((l) => (
              <div key={l.key} className="rounded-lg border border-border p-3">
                <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{l.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(l.premium)}</div>
                <div className="text-2xs text-muted-foreground">new premium · {formatCount(l.policies)} active policies</div>
              </div>
            ))}
          </div>
          {data.byMarket.length > 0 && (
            <p className="mt-2 text-2xs text-muted-foreground">
              {data.byMarket.map((m) => `${m.label}: ${formatMoney(m.premium)}`).join(" · ")}
            </p>
          )}
        </>
      )}
      {showRm && data.totalPremium != null && sellers.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Premium booked, by person</h3>
          <RmTable
            rows={sellers}
            rmHref={rmHref}
            cols={[{ key: "p", label: "New premium", get: (r) => r.insurance, format: "currency" }]}
          />
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── §24 operations ─────────────────────────── */

export function BranchOps({
  data, ledger, rmHref, showRm, opsHref, period,
}: {
  data: OpsSnapshot;
  /** The selected period — rejected transactions are counted over it. */
  period: { from: string; to: string };
  ledger: RmLedgerRow[];
  rmHref: (id: string) => string;
  showRm: boolean;
  opsHref: string | null;
}) {
  return (
    <Section
      title="Branch operations snapshot"
      subtitle="Only the service work that concerns this branch's clients and people."
      icon={<Wrench className="size-4" />}
      action={opsHref ? <SectionLink href={opsHref}>Operations view</SectionLink> : undefined}
      note="Cases beyond SLA counts client queries past their resolution SLA plus the branch's tasks past theirs (or past their due date where no SLA is set). Documents pending are open document-collection tasks — the CRM has no separate document queue."
    >
      <StatGrid cols={6}>
        <Stat label="Transactions pending" value={data.transactionsPending} tone={data.transactionsPending > 0 ? "warn" : "neutral"}
              href="/dashboard/transactions?status=pending" />
        <Stat label="Transactions rejected" value={data.transactionsRejected} tone={data.transactionsRejected > 0 ? "warn" : "neutral"}
              hint="in the period" href={`/dashboard/transactions?status=rejected&date_from=${period.from}&date_to=${period.to}`} />
        <Stat label="Cases beyond SLA" value={data.casesBeyondSla} tone={data.casesBeyondSla > 0 ? "bad" : "neutral"} />
        <Stat label="Documents pending" value={data.documentsPending} />
        <Stat label="Client queries pending" value={data.queriesPending} />
        <Stat
          label="Oldest pending case"
          display={data.oldestPendingDays == null ? <span className="text-muted-foreground" title="Nothing is pending.">—</span> : pluralDays(data.oldestPendingDays)}
          tone={data.oldestPendingDays != null && data.oldestPendingDays > 15 ? "bad" : "neutral"}
        />
      </StatGrid>
      {showRm && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Summary by RM</h3>
          <RmTable
            rows={rmRows(ledger)}
            rmHref={rmHref}
            cols={[
              { key: "to", label: "Tasks open", get: (r) => r.tasksOpenNow },
              { key: "td", label: "Tasks overdue", get: (r) => r.tasksOverdueNow, tone: (v) => (v ? "bad" : "neutral") },
              { key: "qo", label: "Queries open", get: (r) => r.queriesOpen },
              { key: "qs", label: "Queries past SLA", get: (r) => r.queriesOverdue, tone: (v) => (v ? "bad" : "neutral") },
              { key: "sp", label: "SIP rejections pending", get: (r) => r.sipPending, tone: (v) => (v ? "warn" : "neutral") },
            ]}
          />
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────── §25 management attention ─────────────────────── */

export function AttentionCentre({
  items, rmHref, highValue,
}: {
  items: AttentionItem[];
  rmHref: (id: string) => string;
  highValue: number;
}) {
  const critical = items.filter((i) => i.severity === "critical").length;
  return (
    <Section
      title="Needs branch head attention"
      subtitle={items.length === 0
        ? "Nothing needs escalation right now."
        : `${items.length} exception type${items.length === 1 ? "" : "s"} — ${critical} critical. Each card says how many, how much, whose, and how old.`}
      icon={<AlertOctagon className="size-4" />}
      note={`Critical: SLA breaches, unworked SIP rejections, large redemptions (${formatMoney(highValue)}+) with no follow-up, badly overdue A/B reviews, renewals past due and claims past their service window. Attention: target gaps and ageing. Every threshold is set in Settings → Dashboard thresholds.`}
    >
      <div id="attention" className="scroll-mt-40" />
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          No exceptions in this view. The cards appear here as soon as anything crosses a threshold.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <div
              key={i.key}
              className={cn(
                "flex flex-col rounded-lg border bg-card p-4",
                i.severity === "critical" ? "border-destructive/40" : "border-warning/50",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <Link href={i.href} className="text-xs font-semibold leading-snug text-foreground hover:text-primary hover:underline">
                  {i.label}
                </Link>
                <span className={cn("chip shrink-0", i.severity === "critical" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning-foreground")}>
                  {i.severity === "critical" ? "Critical" : "Attention"}
                </span>
              </div>
              <Link href={i.href} className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums leading-none">{formatCount(i.count)}</span>
                {i.value != null && i.value !== 0 && (
                  <span className="text-xs font-medium tabular-nums text-muted-foreground"><Figure value={i.value} /></span>
                )}
              </Link>
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-2 text-2xs">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Responsible</dt>
                  <dd className="truncate font-medium">
                    {i.owner ? (
                      <Link href={rmHref(i.owner.id)} className="hover:text-primary hover:underline">
                        {i.owner.name}
                      </Link>
                    ) : <span className="text-muted-foreground">Not assigned</span>}
                    {i.owner && i.count > 1 && i.owner.count < i.count && (
                      <span className="font-normal text-muted-foreground"> · {i.owner.count} of {i.count}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{i.ageLabel ? i.ageLabel[0].toUpperCase() + i.ageLabel.slice(1) : "Age"}</dt>
                  <dd className="font-medium tabular-nums">
                    {i.oldestDays == null ? <span className="text-muted-foreground">—</span> : pluralDays(i.oldestDays)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

