/**
 * §14 renewal command centre · §15 the renewal cycle · §16 retention · §17
 * renewals at risk. The largest band on the page, as the brief asks.
 */

import { AlarmClock, RefreshCcw, ShieldAlert, Target } from "lucide-react";
import type { AtRiskRow, RenewalBucket, RenewalCycle, Retention } from "@/lib/dashboard/insurance/renewals";
import { policyTypeLabel } from "@/lib/insurance/book";
import { Num, Section, SectionLink, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { Badge } from "@/components/ui/Badge";
import { formatCount, formatDate, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ClientLink } from "./InsClientDrawer";

export function RenewalCommand({ buckets, pastGrace, hrefs }: { buckets: RenewalBucket[]; pastGrace: { count: number; premium: number }; hrefs: Record<string, string> }) {
  return (
    <Section title="Renewal command centre" subtitle="In-force policies by when their renewal falls due."
      icon={<AlarmClock className="size-4" />} action={<SectionLink href={hrefs.renewals}>Renewals desk</SectionLink>}
      note={`Premium due is one installment of each policy. ${pastGrace.count ? `${formatCount(pastGrace.count)} overdue polic${pastGrace.count === 1 ? "y is" : "ies are"} past the grace period (${formatMoney(pastGrace.premium)}) but not yet marked lapsed.` : "No overdue policy is past its grace period."}`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {buckets.map((b) => {
          const bad = b.key === "overdue" && b.count > 0;
          const warn = (b.key === "today" || b.key === "d7") && b.count > 0;
          return (
            <Link key={b.key} href={hrefs[`bucket:${b.key}`] ?? hrefs.renewals}
              className={cn("block rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent",
                bad ? "border-destructive/30 bg-destructive/5" : warn ? "border-warning/50 bg-warning/5" : "border-transparent bg-secondary/70")}>
              <div className="text-2xs font-semibold text-muted-foreground">{b.label}</div>
              <div className={cn("mt-1 text-2xl font-semibold tabular-nums", bad ? "text-destructive" : warn ? "text-warning-foreground" : "text-foreground")}>
                {formatCount(b.count)}
              </div>
              <div className="text-xs tabular-nums text-muted-foreground">{formatMoney(b.premium)}</div>
              {b.oldestDays != null && b.count > 0 && <div className="mt-1 text-2xs text-destructive">Oldest {b.oldestDays} days</div>}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

export function RenewalCyclePanel({ c }: { c: RenewalCycle }) {
  const steps = [
    { key: "due", label: "Renewal due", v: c.due },
    { key: "contacted", label: "Client contacted", v: c.contacted },
    { key: "followUp", label: "Follow-up task raised", v: c.followUp },
    { key: "renewed", label: "Renewed", v: c.renewed },
  ];
  const top = Math.max(1, c.due.count);
  return (
    <Section title="Renewal cycle" subtitle={`Renewals due ${formatDate(c.from)} – ${formatDate(c.to)}, and how far each has got.`}
      icon={<RefreshCcw className="size-4" />}
      note="Contacted = a logged call, visit or message, or a completed meeting, since 45 days before the due date. The CRM does not record quote shared, client confirmation or payment as renewal steps.">
      {c.due.count === 0 ? <Unavailable>No renewal falls due in this window.</Unavailable> : (
        <div className="space-y-1.5">
          {steps.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 truncate sm:w-44">{s.label}</span>
              <span className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
                {s.v.count > 0 && (
                  <span className={cn("flex h-full items-center rounded px-1.5 text-2xs font-semibold text-primary-foreground", s.key === "renewed" ? "bg-success" : "bg-primary/70")}
                    style={{ width: `${Math.max(6, (s.v.count / top) * 100)}%` }}>{formatCount(s.v.count)}</span>
                )}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">{formatMoney(s.v.premium)}</span>
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{formatPercent((s.v.count / top) * 100, 0)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-border/60 pt-2 text-xs">
            <span className="w-32 shrink-0 font-medium text-destructive sm:w-44">Lost / not renewed</span>
            <span className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
              {c.notRenewed.count > 0 && (
                <span className="flex h-full items-center rounded bg-destructive/70 px-1.5 text-2xs font-semibold text-primary-foreground"
                  style={{ width: `${Math.max(6, (c.notRenewed.count / top) * 100)}%` }}>{formatCount(c.notRenewed.count)}</span>
              )}
            </span>
            <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">{formatMoney(c.notRenewed.premium)}</span>
            <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{formatPercent((c.notRenewed.count / top) * 100, 0)}</span>
          </div>
        </div>
      )}
    </Section>
  );
}

export type RetentionView = {
  month: Retention | null; fy: Retention | null; py: Retention | null;
  breakdowns: Array<{ key: string; label: string; rows: Array<{ label: string; r: Retention }> }>;
  labels: { month: string; fy: string; py: string };
};

const pct = (v: number | null) => (v == null ? <span className="text-muted-foreground" title="Nothing fell due">—</span> : formatPercent(v * 100, 1));

export function RetentionPanel({ v }: { v: RetentionView }) {
  const cols = [
    { k: "month" as const, label: v.labels.month, r: v.month },
    { k: "fy" as const, label: v.labels.fy, r: v.fy },
    { k: "py" as const, label: v.labels.py, r: v.py },
  ];
  return (
    <Section title="Renewal retention" subtitle="Two separate measures: how many renewals were kept, and how much premium."
      icon={<Target className="size-4" />}
      note="Policy retention = renewals marked renewed ÷ renewals that fell due (up to today). Premium retention = renewed installment premium ÷ premium that fell due. A renewal keyed as a separate new policy is renewal premium, but its old row stays due until it is marked renewed or closed.">
      <Table rows={2} empty="" head={<>
        <th scope="col">Measure</th>
        {cols.map((c) => <th key={c.k} scope="col" className="text-right">{c.label}</th>)}
      </>}>
        <tr>
          <td className="py-2.5 text-xs font-medium">Policy retention</td>
          {cols.map((c) => <Num key={c.k}>{pct(c.r?.policyPct ?? null)}<div className="text-2xs text-muted-foreground">{c.r ? `${formatCount(c.r.renewed)} of ${formatCount(c.r.due)}` : "—"}</div></Num>)}
        </tr>
        <tr>
          <td className="py-2.5 text-xs font-medium">Premium retention</td>
          {cols.map((c) => <Num key={c.k}>{pct(c.r?.premiumPct ?? null)}<div className="text-2xs text-muted-foreground">{c.r ? `${formatMoney(c.r.renewedPremium)} of ${formatMoney(c.r.duePremium)}` : "—"}</div></Num>)}
        </tr>
      </Table>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {v.breakdowns.map((b) => (
          <div key={b.key} className="min-w-0">
            <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">FY to date by {b.label}</h3>
            <Table rows={b.rows.length} empty="Nothing fell due." head={<>
              <th scope="col">{b.label === "RM" ? "RM" : b.label.charAt(0).toUpperCase() + b.label.slice(1)}</th>
              <th scope="col" className="text-right">Due</th>
              <th scope="col" className="text-right">Policy %</th>
              <th scope="col" className="text-right">Premium %</th>
            </>}>
              {b.rows.map((x) => (
                <tr key={x.label}>
                  <td className="py-2 text-xs">{x.label}</td>
                  <Num>{formatCount(x.r.due)}</Num>
                  <Num>{pct(x.r.policyPct)}</Num>
                  <Num>{pct(x.r.premiumPct)}</Num>
                </tr>
              ))}
            </Table>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function AtRiskPanel({ rows, total, names, hrefs }: { rows: AtRiskRow[]; total: number; names: Map<string, string>; hrefs: Record<string, string> }) {
  return (
    <Section title="Renewals at risk" subtitle={`${formatCount(total)} renewal${total === 1 ? "" : "s"} overdue or due within 30 days — overdue first, then within 7 days, then the larger premium.`}
      icon={<ShieldAlert className="size-4" />} action={<SectionLink href={hrefs.renewals}>Renewals desk</SectionLink>}
      note="No score: the order is the brief's — overdue, due within 7 days, higher premium, then no contact on record. Last contact is the latest logged call, visit, message or completed meeting with the client.">
      <Table rows={rows.length} empty="No renewal is overdue or due within 30 days." head={<>
        <th scope="col">Client</th>
        <th scope="col">Policy · insurer</th>
        <th scope="col" className="text-right">Premium</th>
        <th scope="col">Renewal date</th>
        <th scope="col">Owner</th>
        <th scope="col">Last contact</th>
        <th scope="col">Status</th>
      </>}>
        {rows.map((r) => {
          const overdue = r.daysLeft < 0;
          const pastGrace = r.daysLeft < -r.grace;
          return (
            <tr key={r.policyId} className={overdue ? "bg-destructive/5" : undefined}>
              <td className="py-2.5 text-xs font-medium"><ClientLink id={r.investorId} name={r.client} /></td>
              <td className="py-2.5 text-xs">
                <Link href={`/dashboard/insurance/${r.policyId}`} className="hover:text-primary hover:underline">{r.plan || policyTypeLabel(r.policyType)}</Link>
                <div className="text-2xs text-muted-foreground">{[r.policyNumber ?? "No policy number", r.insurer ?? "Insurer not recorded"].join(" · ")}</div>
              </td>
              <Num>{formatMoney(r.premium)}</Num>
              <td className="whitespace-nowrap py-2.5 text-xs tabular-nums">
                {formatDate(r.due)}
                <div className={overdue ? "text-2xs text-destructive" : r.daysLeft <= 7 ? "text-2xs text-warning-foreground" : "text-2xs text-muted-foreground"}>
                  {r.daysLeft < 0 ? `${-r.daysLeft} d overdue` : r.daysLeft === 0 ? "today" : `in ${r.daysLeft} d`}
                </div>
              </td>
              <td className="py-2.5 text-xs">{r.ownerId ? names.get(r.ownerId) ?? "—" : <span className="text-warning-foreground">Owner missing</span>}</td>
              <td className="py-2.5 text-xs">{r.lastContact ? formatDate(r.lastContact) : <span className="text-warning-foreground">No contact recorded</span>}</td>
              <td className="py-2.5">
                <Badge raw tone={pastGrace ? "danger" : overdue ? "danger" : r.daysLeft <= 7 ? "warning" : "info"}>
                  {pastGrace ? "Past grace" : overdue ? "Overdue" : r.daysLeft <= 7 ? "Due soon" : "Upcoming"}
                </Badge>
                {r.claimOpen && <span className="ml-1"><Badge raw tone="neutral">Claim open</Badge></span>}
              </td>
            </tr>
          );
        })}
      </Table>
      {total > rows.length && <p className="mt-2 text-center text-2xs text-muted-foreground">{total - rows.length} more on the renewals desk.</p>}
    </Section>
  );
}
