/**
 * §9–11 branch, RM and insurance-team contribution · §25 meetings · §28
 * insurers · §47–48 the branch / RM drill-down summary.
 */

import { Building2, CalendarCheck, Landmark, UserCheck, Users } from "lucide-react";
import type { ExecRow, InsurerRow, Meetings, PeopleRow } from "@/lib/dashboard/insurance/team";
import { Num, Section, SectionLink, Stat, StatGrid, Table } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney } from "@/lib/format";
import { PeopleTable } from "./PeopleTable";

const moneyCols = [
  { key: "newAmt", label: "New", format: "currency" as const },
  { key: "renAmt", label: "Renewal", format: "currency" as const },
  { key: "total", label: "Total", format: "currency" as const },
  { key: "policies", label: "Policies", format: "count" as const },
  { key: "newClients", label: "New clients", format: "count" as const },
  { key: "renewalPct", label: "Renewal %", format: "percent" as const },
  { key: "lost", label: "Lost", format: "currency" as const, tone: "bad" as const },
];
/** Every policy in the row has no premium recorded: its premium is unknown ("—"), not ₹0. */
const cells = (r: PeopleRow) => {
  const unknown = r.money.total === 0 && r.money.policies > 0 && r.money.unpriced === r.money.policies;
  return {
  newAmt: unknown ? null : r.money.newAmt, renAmt: unknown ? null : r.money.renAmt, total: unknown ? null : r.money.total, policies: r.money.policies,
  newClients: r.newClients, renewalPct: r.renewalPct, lost: r.lostPremium, branch: r.branch,
  };
};

export function BranchPanel({ rows, periodLabel, hrefFor }: { rows: PeopleRow[]; periodLabel: string; hrefFor: (branchId: string) => string }) {
  return (
    <Section title="Branch-wise insurance performance" subtitle={`${periodLabel}.`}
      icon={<Building2 className="size-4" />}
      note="New, Renewal, Total and Lost are premium; Renewal % is policies renewed ÷ due, FY to date. A policy belongs to its client's branch — the policy's own branch field is whoever keyed it, usually head office, so it is used only where the client has no branch.">
      <PeopleTable cols={moneyCols} empty="No branch has insurance business in this period."
        rows={rows.map((r) => ({ id: r.key ?? "none", name: r.name, href: r.key ? hrefFor(r.key) : null, synthetic: r.synthetic, cells: cells(r) }))} />
    </Section>
  );
}

export function RmPanel({ rows, periodLabel, hrefFor }: { rows: PeopleRow[]; periodLabel: string; hrefFor: (userId: string) => string }) {
  return (
    <Section title="RM-wise insurance contribution" subtitle={`${periodLabel}.`}
      icon={<Users className="size-4" />}
      note="New, Renewal, Total and Lost are premium; Renewal % is FY to date. Business is credited to the seller when they hold a sales role, else to the client's RM. Operations keying a policy is not credited with the sale.">
      <PeopleTable cols={[{ key: "branch", label: "Branch", format: "text" }, ...moneyCols]} empty="No RM has insurance business in this period."
        rows={rows.map((r) => ({ id: r.key ?? "none", name: r.name, href: r.key ? hrefFor(r.key) : null, synthetic: r.synthetic, cells: cells(r) }))} />
    </Section>
  );
}

export function TeamPanel({ rows, periodLabel }: { rows: ExecRow[]; periodLabel: string }) {
  return (
    <Section title="Insurance team" subtitle={`${periodLabel} — what each insurance-team member sold or keyed, and what is open with them.`}
      icon={<UserCheck className="size-4" />}
      note="By the policy's seller, for users with the Insurance Team role; the CRM has no separate insurance-executive field. Pending is policies awaiting issue plus their open insurance leads; renewal due is within 30 days.">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">No user holds the Insurance Team role.</p>
      ) : (
        <Table rows={rows.length} empty="" head={<>
          <th scope="col">Executive</th>
          <th scope="col" className="text-right">Policies handled</th>
          <th scope="col" className="text-right">New business</th>
          <th scope="col" className="text-right">Renewal business</th>
          <th scope="col" className="text-right">Pending cases</th>
          <th scope="col" className="text-right">Renewal due</th>
          <th scope="col" className="text-right">Lost cases</th>
        </>}>
          {rows.map((r) => (
            <tr key={r.userId}>
              <td className="py-2.5 text-xs font-medium">{r.name}</td>
              <Num>{formatCount(r.handled)}</Num>
              <Num>{formatMoney(r.newAmt)}</Num>
              <Num>{formatMoney(r.renAmt)}</Num>
              <Num tone={r.pending > 0 ? "warn" : "neutral"}>{formatCount(r.pending)}</Num>
              <Num tone={r.renewalDue > 0 ? "warn" : "neutral"}>{formatCount(r.renewalDue)}</Num>
              <Num tone={r.lost > 0 ? "bad" : "neutral"}>{formatCount(r.lost)}</Num>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

export function MeetingsPanel({ m, periodLabel, href }: { m: Meetings; periodLabel: string; href: string }) {
  return (
    <Section title="Insurance meetings" subtitle={`${periodLabel} — held by the insurance team, or with a lead on the insurance pipeline.`}
      icon={<CalendarCheck className="size-4" />} action={<SectionLink href={href}>All meetings</SectionLink>}
      note="The meeting record has no product field, so this counts meetings by who held them and whom they were with. A follow-up is pending when a completed meeting has no follow-up task.">
      <StatGrid cols={5}>
        <Stat label="New meetings" value={m.newN} href={href} />
        <Stat label="Review meetings" value={m.review} href={href} />
        <Stat label="Corporate meetings" value={m.corporate} href={href} />
        <Stat label="Total meetings" value={m.total} href={href} />
        <Stat label="Follow-ups pending" value={m.followUp} tone={m.followUp > 0 ? "warn" : "neutral"} href={href} />
      </StatGrid>
      {m.rows.length > 0 && (
        <div className="mt-4">
          <Table rows={m.rows.length} empty="" head={<>
            <th scope="col">Owner</th>
            <th scope="col" className="text-right">New</th>
            <th scope="col" className="text-right">Review</th>
            <th scope="col" className="text-right">Corporate</th>
            <th scope="col" className="text-right">Total</th>
            <th scope="col" className="text-right">Follow-up pending</th>
          </>}>
            {m.rows.map((r) => (
              <tr key={r.ownerId ?? "none"}>
                <td className="py-2.5 text-xs font-medium">{r.name}</td>
                <Num>{formatCount(r.newN)}</Num>
                <Num>{formatCount(r.review)}</Num>
                <Num>{formatCount(r.corporate)}</Num>
                <Num>{formatCount(r.total)}</Num>
                <Num tone={r.followUp > 0 ? "warn" : "neutral"}>{formatCount(r.followUp)}</Num>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Section>
  );
}

export function InsurerPanel({ rows, periodLabel, hrefFor }: { rows: InsurerRow[]; periodLabel: string; hrefFor: (key: string) => string }) {
  return (
    <Section title="Insurer-wise business" subtitle={`${periodLabel} — business placed with each insurer.`}
      icon={<Landmark className="size-4" />}
      note="Insurer names are grouped as keyed, ignoring case. Business data only — no insurer is ranked or rated.">
      <Table rows={rows.length} empty="No business placed with any insurer in this period." head={<>
        <th scope="col">Insurer</th>
        <th scope="col" className="text-right">New premium</th>
        <th scope="col" className="text-right">Renewal premium</th>
        <th scope="col" className="text-right">Total premium</th>
        <th scope="col" className="text-right">Policies</th>
        <th scope="col" className="text-right">Renewal % (FY)</th>
        <th scope="col" className="text-right">Claims open</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5 text-xs font-medium"><a href={hrefFor(r.key)} className="hover:text-primary hover:underline">{r.name}</a></td>
            <Num>{formatMoney(r.money.newAmt)}</Num>
            <Num>{formatMoney(r.money.renAmt)}</Num>
            <Num>{formatMoney(r.money.total)}</Num>
            <Num>{formatCount(r.money.policies)}</Num>
            <Num>{r.renewalPct == null ? "—" : `${(r.renewalPct * 100).toFixed(1)}%`}</Num>
            <Num>{formatCount(r.claimsOpen)}</Num>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

/** §47 / §48 — shown when a branch or an RM is chosen in the filter bar. */
export function DrillSummary({ kind, name, facts }: { kind: "branch" | "rm"; name: string; facts: Array<{ label: string; value: number | null; format: "currency" | "count" | "percent"; href?: string; tone?: "warn" | "bad" }> }) {
  return (
    <Section title={kind === "branch" ? `Branch: ${name}` : `RM: ${name}`}
      icon={kind === "branch" ? <Building2 className="size-4" /> : <Users className="size-4" />}>
      <StatGrid cols={5}>
        {facts.map((f) => <Stat key={f.label} label={f.label} value={f.value} format={f.format} href={f.href} tone={f.tone ?? "neutral"} />)}
      </StatGrid>
    </Section>
  );
}
