/**
 * §34 settlement · §35 ageing · §36 escalations · §37 renewal vs claim.
 */

import { Hourglass, Percent, Siren, Waypoints } from "lucide-react";
import type { Escalation, ServiceLink, Settlement } from "@/lib/dashboard/insurance/claims";
import { CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL } from "@/lib/insurance/book";
import { Num, Section, SectionLink, Stat, StatGrid, Table } from "@/components/dashboards/my/Shared";
import { Badge } from "@/components/ui/Badge";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { ClientLink } from "./InsClientDrawer";

export function SettlementPanel({ s, periodLabel }: { s: Settlement; periodLabel: string }) {
  return (
    <Section title="Claim settlement" subtitle={`${periodLabel}.`} icon={<Percent className="size-4" />}
      note="Count % = settled ÷ (settled + rejected) decided in the period; a rejection has no date of its own, so its last update stands in for it. Amount % = settled ÷ claimed on claims settled in the period. Neither is a verdict on an insurer without the claim's context.">
      <StatGrid cols={4}>
        <Stat label="Settlement by count" value={s.countPct} format="percent" hint={`${formatCount(s.settled)} of ${formatCount(s.decided)} decided`} unavailable="No claim decided in the period." />
        <Stat label="Settlement by amount" value={s.amountPct} format="percent" hint={`${formatMoney(s.settledAmount)} of ${formatMoney(s.claimedOnSettled)}`} unavailable="No claim settled in the period." />
        <Stat label="Settled" value={s.settled} tone={s.settled ? "good" : "neutral"} />
        <Stat label="Rejected" value={s.rejected} tone={s.rejected ? "bad" : "neutral"} />
      </StatGrid>
    </Section>
  );
}

export function ClaimAgeingPanel({ rows, href }: { rows: Array<{ key: string; label: string; count: number; amount: number }>; href: string }) {
  return (
    <Section title="Claim ageing" subtitle="Open claims by days since intimation." icon={<Hourglass className="size-4" />}>
      <StatGrid cols={6}>
        {rows.map((r) => (
          <Stat key={r.key} label={r.label} value={r.count} hint={formatMoney(r.amount)} href={href}
            tone={r.key === "c6" && r.count > 0 ? "bad" : r.key === "c5" && r.count > 0 ? "warn" : "neutral"} />
        ))}
      </StatGrid>
    </Section>
  );
}

export function EscalationPanel({ rows, total, names, hrefs, highClaim }: { rows: Escalation[]; total: number; names: Map<string, string>; hrefs: Record<string, string>; highClaim: number }) {
  return (
    <Section title="Claims needing attention" subtitle={`${formatCount(total)} claim${total === 1 ? "" : "s"} past SLA, missing files, with an insurer query, high value or recently rejected.`}
      icon={<Siren className="size-4" />} action={<SectionLink href={hrefs.claimsList}>Claims register</SectionLink>}
      note={`Exceptions only. High value = an open claim of ${formatMoney(highClaim)} or more. A rejected claim stays here for 30 days for review.`}>
      <Table rows={rows.length} empty="No claim needs escalation." head={<>
        <th scope="col">Client</th>
        <th scope="col">Claim type</th>
        <th scope="col">Insurer</th>
        <th scope="col" className="text-right">Claim amount</th>
        <th scope="col">Status</th>
        <th scope="col" className="text-right">Ageing</th>
        <th scope="col">Claim handler</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.claimId}>
            <td className="py-2.5 text-xs font-medium">
              {r.investorId ? <ClientLink id={r.investorId} name={r.client} /> : r.client}
              <div className="mt-0.5 flex flex-wrap gap-1">{r.why.map((w) => <Badge key={w} raw tone={w === "High value" ? "warning" : "danger"}>{w}</Badge>)}</div>
            </td>
            <td className="py-2.5 text-xs">{r.claimType ? CLAIM_TYPE_LABEL[r.claimType] ?? r.claimType : <span className="text-muted-foreground">Not recorded</span>}</td>
            <td className="py-2.5 text-xs">{r.insurer ?? <span className="text-muted-foreground">Not recorded</span>}</td>
            <Num>{formatMoney(r.amount)}</Num>
            <td className="py-2.5 text-xs"><a href={`/dashboard/insurance-claims/${r.claimId}`} className="hover:text-primary hover:underline">{CLAIM_STATUS_LABEL[r.status] ?? r.status}</a></td>
            <Num tone={r.ageDays > 90 ? "bad" : "neutral"}>{r.ageDays} d</Num>
            <td className="py-2.5 text-xs">{r.handlerId ? names.get(r.handlerId) ?? "—" : <span className="text-warning-foreground">Handler missing</span>}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

export function RenewalClaimPanel({ rows, renewalWithClaim, claimOnLapsed }: { rows: ServiceLink[]; renewalWithClaim: number; claimOnLapsed: number }) {
  return (
    <Section title="Renewals and claims together" subtitle="A service-coordination view: where an open claim meets a renewal or a policy no longer in force."
      icon={<Waypoints className="size-4" />}
      note="For coordination only. Nothing here suggests whether a policy should or will be renewed.">
      <StatGrid cols={2}>
        <Stat label="Renewal due in 60 days, claim open" value={renewalWithClaim} tone={renewalWithClaim ? "warn" : "neutral"} />
        <Stat label="Open claim on a lapsed, ended or past-grace policy" value={claimOnLapsed} tone={claimOnLapsed ? "bad" : "neutral"} />
      </StatGrid>
      {rows.length > 0 && (
        <div className="mt-4">
          <Table rows={rows.length} empty="" head={<>
            <th scope="col">Client</th>
            <th scope="col">Policy</th>
            <th scope="col">Renewal date</th>
            <th scope="col">Claim status</th>
            <th scope="col">Situation</th>
          </>}>
            {rows.map((r, i) => (
              <tr key={`${r.investorId}-${i}`}>
                <td className="py-2.5 text-xs font-medium"><ClientLink id={r.investorId} name={r.client} /></td>
                <td className="py-2.5 text-xs">{r.policy}</td>
                <td className="py-2.5 text-xs tabular-nums">{r.due ? formatDate(r.due) : "—"}</td>
                <td className="py-2.5 text-xs">{CLAIM_STATUS_LABEL[r.claimStatus] ?? r.claimStatus}</td>
                <td className="py-2.5"><Badge raw tone={r.kind === "claim_on_lapsed" ? "danger" : "warning"}>{r.kind === "claim_on_lapsed" ? "Claim on lapsed / ended policy" : "Renewal with open claim"}</Badge></td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Section>
  );
}
