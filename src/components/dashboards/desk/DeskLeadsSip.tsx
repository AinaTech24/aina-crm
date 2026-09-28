/**
 * §14 Leads needing action and §19 SIP debit health check.
 *
 * The debit check shows only what the SIP register actually records (§19):
 * next-instalment dates, the register's failure counter and the mandate. The
 * at-risk rules are the SIP-defence module's, so this card and the At-risk
 * SIPs page agree about which SIP is in trouble. Where the register is silent
 * the card says so rather than inferring a failure.
 */

import Link from "next/link";
import { ShieldAlert, UserSearch } from "lucide-react";
import type { LeadActions, SipDebitHealth } from "@/lib/dashboard/my/desk";
import { humanStatus } from "@/lib/dashboard/my/desk";
import type { Voice } from "@/components/dashboards/my/voice";
import { Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ─────────────────────────── §14 leads needing action ─────────────────────────── */

export function LeadsNeedingAction({ data, voice }: { data: LeadActions; voice: Voice }) {
  return (
    <Section
      title="Leads needing action"
      subtitle="Prospects waiting on me — first contact, a follow-up, a meeting, or a next step."
      icon={<UserSearch className="size-4" />}
      action={<SectionLink href={voice.leads()}>All my leads</SectionLink>}
      note={`Stale means no contact, follow-up, stage change or edit for ${data.staleAfterDays} days — set in Settings → Dashboard thresholds. "Meeting not scheduled" is a contacted lead with no meeting on record.`}
    >
      <StatGrid cols={6}>
        <Stat label="New, not contacted" value={data.notContacted} tone={data.notContacted > 0 ? "warn" : "neutral"} href={voice.leads()} />
        <Stat label="Follow-up due today" value={data.dueToday} href={voice.leads("followup_today=1")} />
        <Stat label="Follow-up overdue" value={data.overdue} tone={data.overdue > 0 ? "bad" : "neutral"} href={voice.leads("followup_overdue=1")} />
        <Stat label="No next action" value={data.noNextAction} tone={data.noNextAction > 0 ? "warn" : "neutral"} hint="no follow-up date" />
        <Stat label={`Stale (${data.staleAfterDays}d+)`} value={data.stale} tone={data.stale > 0 ? "warn" : "neutral"} />
        <Stat label="Meeting not scheduled" value={data.meetingNotScheduled} tone={data.meetingNotScheduled > 0 ? "warn" : "neutral"} />
      </StatGrid>
      <div className="mt-4">
        <Table
          rows={data.rows.length}
          empty="No lead is waiting on you."
          head={
            <>
              <th scope="col">Lead</th>
              <th scope="col">Source</th>
              <th scope="col">Created</th>
              <th scope="col">Last activity</th>
              <th scope="col">Stage</th>
              <th scope="col" className="text-right">Potential</th>
              <th scope="col">Next action</th>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2.5">
                <Link href={`/dashboard/leads/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link>
              </td>
              <td className="py-2.5 text-xs">{r.source ? humanStatus(r.source) : <span className="text-muted-foreground">Not recorded</span>}</td>
              <td className="whitespace-nowrap py-2.5 text-xs">{formatDate(r.created)}</td>
              <td className="whitespace-nowrap py-2.5 text-xs">{r.lastActivity ? formatDate(r.lastActivity) : <span className="text-muted-foreground">None</span>}</td>
              <td className="py-2.5 text-xs">{humanStatus(r.stage)}</td>
              <Num>{r.potential != null && r.potential > 0 ? formatMoney(r.potential) : <span className="text-muted-foreground">Not recorded</span>}</Num>
              <td className={cn("py-2.5 text-xs font-medium",
                r.urgency === "bad" ? "text-destructive" : r.urgency === "warn" ? "text-warning-foreground" : "text-foreground")}>
                {r.nextAction}
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}

/* ─────────────────────────── §19 SIP debit health ─────────────────────────── */

const REASON: Record<string, string> = {
  dead_mandate: "Dead mandate",
  repeated_failures: "Repeated failures",
  mandate_expiring: "Mandate expiring",
  ending_soon: "Ending soon",
};

export function SipDebitCheck({ data }: { data: SipDebitHealth }) {
  return (
    <Section
      title="SIP debit health check"
      subtitle="Debits coming up, debits that failed, and SIPs at risk — as far as the SIP register records it."
      icon={<ShieldAlert className="size-4" />}
      action={<SectionLink href="/dashboard/sips/at-risk">At-risk SIPs</SectionLink>}
      note="At-risk rules are the SIP register's: a dead or expiring mandate, two or more consecutive failed instalments, or a SIP ending within 60 days. The CRM keeps no record of a periodic debit review, so a six-month debit review cannot be scheduled from data and is not shown."
    >
      {!data.tracked ? (
        <Unavailable>
          The SIP register carries no next-instalment dates for your clients, so upcoming debits cannot be checked. Failed
          debits still show under SIP health from the transaction ledger.
        </Unavailable>
      ) : (
        <>
          <StatGrid cols={5}>
            <Stat label="Debit check due" value={data.dueSoon.length} hint="instalment in the next 3 days" />
            <Stat label="Failed debit" value={data.failedDebits} tone={data.failedDebits > 0 ? "bad" : "neutral"} hint="last 30 days"
                  href="/dashboard/sip-rejections" />
            <Stat label="Repeated failure" value={data.repeatedFailures} tone={data.repeatedFailures > 0 ? "bad" : "neutral"} hint="2+ in a row" />
            <Stat label="Follow-up pending" value={data.followUpPending} tone={data.followUpPending > 0 ? "warn" : "neutral"}
                  href="/dashboard/sip-rejections?recovery=pending,client_contacted,bank_issue,mandate_issue" />
            <Stat label="Mandate issue" value={data.mandateIssues} tone={data.mandateIssues > 0 ? "warn" : "neutral"} hint="dead or expiring" />
          </StatGrid>
          {(data.dueSoon.length > 0 || data.atRisk.length > 0) && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Debits in the next 3 days</h3>
                <Table rows={data.dueSoon.length} empty="No instalment falls due in the next three days."
                  head={<><th scope="col">Client</th><th scope="col">Scheme</th><th scope="col" className="text-right">Amount</th><th scope="col">Date</th></>}>
                  {data.dueSoon.map((d) => (
                    <tr key={d.sipId}>
                      <td className="py-2.5"><Link href={`/dashboard/investors/${d.clientId}`} className="font-medium hover:text-primary hover:underline">{d.client}</Link></td>
                      <td className="max-w-xs truncate py-2.5 text-xs">{d.scheme ?? "—"}</td>
                      <Num>{formatMoney(d.amount)}</Num>
                      <td className="whitespace-nowrap py-2.5 text-xs">{formatDate(d.next)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
              <div>
                <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">SIPs at risk</h3>
                <Table rows={data.atRisk.length} empty="No SIP is at risk on the register's rules."
                  head={<><th scope="col">Client</th><th scope="col">Reason</th><th scope="col" className="text-right">Amount</th></>}>
                  {data.atRisk.map((s) => (
                    <tr key={s.sipId}>
                      <td className="py-2.5"><Link href={`/dashboard/investors/${s.investorId}`} className="font-medium hover:text-primary hover:underline">{s.investorName}</Link></td>
                      <td className="py-2.5 text-xs">
                        {s.reasons.map((r) => (
                          <span key={r} className={cn("chip mr-1", s.riskLevel === "high" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning-foreground")}>
                            {REASON[r] ?? r}
                          </span>
                        ))}
                      </td>
                      <Num>{formatMoney(s.amount)}</Num>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
