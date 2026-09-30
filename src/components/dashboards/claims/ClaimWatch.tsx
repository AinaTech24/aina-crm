/**
 * §31 high-value watch · §32 claims without activity · §33 claims without a
 * next action · §41–42 client service and update due · §34–35 data quality
 * and linkage. Thresholds are the firm's (Settings → Dashboard thresholds);
 * the presets change this view only.
 */

import { BellRing, ClipboardCheck, ClipboardX, Clock4, Gem, Link2Off } from "lucide-react";
import type { ClaimRec } from "@/lib/dashboard/claims/set";
import { QUALITY, type quality, type withoutNextAction } from "@/lib/dashboard/claims/analysis";
import type { WorklistFocus } from "@/lib/dashboard/claims/params";
import { Section, Stat, StatGrid } from "@/components/dashboards/my/Shared";
import { LinkToggle } from "@/components/dashboards/insurance/parts";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { ClaimList, type Names } from "./parts";

type Toggle = { current: string; options: Array<{ key: string; label: string; href: string }> };
type FocusHref = (k: WorklistFocus) => string;

export function HighValuePanel({ rows, names, threshold, toggle }: { rows: ClaimRec[]; names: Names; threshold: number; toggle: Toggle }) {
  const total = rows.reduce((a, c) => a + c.claimed, 0);
  return (
    <Section title="High-value claim watch" subtitle={`${formatCount(rows.length)} open claim${rows.length === 1 ? "" : "s"} at or above ${formatMoney(threshold)} — ${formatMoney(total)} claimed.`}
      icon={<Gem className="size-4" />} action={<LinkToggle current={toggle.current} options={toggle.options} />} className="min-w-0"
      note="The firm's line is insurance: high-value claim from (Settings → Dashboard thresholds); the presets change this view only.">
      <ClaimList rows={rows} names={names} limit={12} empty={`No open claim at or above ${formatMoney(threshold)}.`}
        cols={["clientClaim", "amount", "insurer", "status", "age", "owner", "next"]} />
    </Section>
  );
}

export function StalePanel({ rows, names, days, toggle }: { rows: ClaimRec[]; names: Names; days: number; toggle: Toggle }) {
  return (
    <Section title="Claims without activity" subtitle={`${formatCount(rows.length)} open claim${rows.length === 1 ? "" : "s"} with no update for ${days} day${days === 1 ? "" : "s"} or more.`}
      icon={<Clock4 className="size-4" />} action={<LinkToggle current={toggle.current} options={toggle.options} />} className="min-w-0"
      note="An update is any edit to the claim — a status change, a remark, a document, an amount. A follow-up task or a logged call does not count as an update to the claim itself.">
      <ClaimList rows={[...rows].sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)} names={names} limit={12} empty="Every open claim has been updated recently."
        cols={["clientClaim", "status", "owner", "updated", "next"]} />
    </Section>
  );
}

export function NoActionPanel({ n, focusHref }: { n: ReturnType<typeof withoutNextAction>; focusHref: FocusHref }) {
  return (
    <Section title="Claims without a next action" subtitle={`Exceptions among ${formatCount(n.open)} open claims.`} icon={<ClipboardX className="size-4" />} className="min-w-0"
      note="The next action is a follow-up scheduled on the claim (Schedule follow-up in the claim drawer). The CRM has no separate insurer or TPA status: “Status not set” stands for it.">
      <StatGrid cols={5}>
        <Stat label="No next follow-up" value={n.noAction} tone={n.noAction ? "warn" : "neutral"} href={focusHref("noaction")} />
        <Stat label="No owner" value={n.noOwner} tone={n.noOwner ? "warn" : "neutral"} href={focusHref("noowner")} />
        <Stat label="No remarks" value={n.noRemarks} href={focusHref("noremark")} />
        <Stat label="No documents on file" value={n.noDocuments} />
        <Stat label="Status not set" value={n.noStatus} tone={n.noStatus ? "warn" : "neutral"} />
      </StatGrid>
    </Section>
  );
}

export function ClientServicePanel({ open, due, clientsDue, actionToday, actionOverdue, noContact, names, days, toggle, focusHref }: {
  open: number; due: ClaimRec[]; clientsDue: number; actionToday: number; actionOverdue: number; noContact: number;
  names: Names; days: number; toggle: Toggle; focusHref: FocusHref;
}) {
  return (
    <Section title="Client service" subtitle="Keeping claimants informed while the insurer works." icon={<BellRing className="size-4" />}
      action={<LinkToggle current={toggle.current} options={toggle.options} />}
      note={`A client update is any call, email, WhatsApp, meeting or visit logged with the claimant, or a message actually sent, since the claim was intimated. Due after ${days} days without one.`}>
      <StatGrid cols={5}>
        <Stat label="Open claims" value={open} />
        <Stat label="Clients awaiting an update" value={clientsDue} tone={clientsDue ? "warn" : "neutral"} href={focusHref("update")} />
        <Stat label="Follow-ups due today" value={actionToday} href={focusHref("actiondue")} />
        <Stat label="Follow-ups overdue" value={actionOverdue} tone={actionOverdue ? "bad" : "neutral"} href={focusHref("actiondue")} />
        <Stat label="No contact since intimation" value={noContact} tone={noContact ? "warn" : "neutral"} />
      </StatGrid>
      <h3 className="mb-1.5 mt-4 text-2xs font-semibold text-muted-foreground">Claim update due</h3>
      <ClaimList rows={due} names={names} limit={12} empty="Every claimant has had an update recently."
        cols={["clientClaim", "contact", "status", "owner"]} />
    </Section>
  );
}

export function QualityPanel({ q, periodLabel }: { q: ReturnType<typeof quality>; periodLabel: string }) {
  return (
    <Section title="Claim data quality" subtitle={`${formatCount(q.claims)} claims checked — open today and those logged or closed in ${periodLabel}. ${q.pct == null ? "" : `${formatPercent(q.pct * 100, 1)} complete.`}`}
      icon={<ClipboardCheck className="size-4" />}
      note="Only fields the claim actually has are checked: there is no claim-number, TPA or rejection-reason field to be missing. A blank is shown as a gap to fix, never as a zero.">
      <StatGrid cols={6}>
        {QUALITY.map((x) => <Stat key={x.key} label={x.label} value={q.counts[x.key]} tone={q.counts[x.key] ? "warn" : "neutral"} />)}
      </StatGrid>
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs">
        <Link2Off className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">Linkage</span>
        <span className={q.noPolicy ? "text-warning-foreground" : "text-muted-foreground"}>{formatCount(q.noPolicy)} without a policy</span>
        <span className="text-muted-foreground">·</span>
        <span className={q.noClient ? "text-warning-foreground" : "text-muted-foreground"}>{formatCount(q.noClient)} without a client</span>
        <span className="text-muted-foreground">— a claim with no policy has no line, product or checklist; one with no client has no RM or contact history.</span>
      </div>
    </Section>
  );
}
