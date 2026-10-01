/**
 * SIP operations (§9–12): the control centre, the rejection register that
 * replaces the monthly SIP-rejection report, rejection reasons, and recovery.
 * Recovery is "successful" only at Recovered — a repurchase initiated is not
 * yet a recovery (the brief).
 */

import Link from "next/link";
import { Download, Repeat, RotateCcw } from "lucide-react";
import { Num, Section, Stat, StatGrid, Table, Unavailable } from "../my/Shared";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/button-class";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { fmtIstDay, inPeriod } from "@/lib/dashboard/ops/fmt";
import type { RejectionDesk, SipControl } from "@/lib/dashboard/ops/sip";
import { cn } from "@/lib/utils";

export function SipControlPanel({ c, periodLabel, hrefs }: { c: SipControl; periodLabel: string; hrefs: Record<string, string> }) {
  return (
    <Section
      title="SIP control centre"
      subtitle={`${periodLabel}, unless marked "now".`}
      icon={<Repeat className="size-4" />}
      note="Registration, modification and stop requests are operations requests of those types. Stops confirmed come from the feed. A rejection is recovered only when the repurchase has actually gone through."
    >
      <StatGrid cols={6}>
        <Stat label="Registrations received" value={c.regReceived} href={hrefs.reg} />
        <Stat label="Registrations completed" value={c.regCompleted} tone={c.regCompleted ? "good" : "neutral"} />
        <Stat label="Registrations pending" value={c.regPending} hint="now" href={hrefs.reg} />
        <Stat label="Modifications pending" value={c.modPending} hint="now" href={hrefs.mod} />
        <Stat label="SIP stop requests" value={c.stopRequests} hint={c.stopConfirmed ? `${c.stopConfirmed} confirmed on the feed` : "none confirmed on the feed"} href={hrefs.stop} />
        <Stat label="Mandates pending" value={c.mandatesPending} hint="now" unavailable="The feed has never carried a mandate, so pending mandates are unknown." />
        <Stat label="SIPs rejected" value={c.rejected} tone={c.rejected ? "bad" : "neutral"} href={hrefs.sip} />
        <Stat label="Repurchase completed" value={c.repurchaseDone} tone={c.repurchaseDone ? "good" : "neutral"} href={hrefs.sip} />
        <Stat label="Repurchase pending" value={c.repurchasePending} hint="now" tone={c.repurchasePending ? "warn" : "neutral"} href={hrefs.sip} />
        <Stat label="Without remarks" value={c.withoutRemarks} hint="open rejections" tone={c.withoutRemarks ? "warn" : "neutral"} href={hrefs.sip} />
        <Stat label="SIPs set up in the CRM" value={c.sipsRegisteredInCrm} hint="new SIP records" />
      </StatGrid>
    </Section>
  );
}

const REPURCHASE: Record<string, { label: string; tone: "success" | "info" | "neutral" | "danger" }> = {
  completed: { label: "Completed", tone: "success" },
  initiated: { label: "Initiated", tone: "info" },
  not_yet: { label: "Not yet", tone: "neutral" },
  not_recoverable: { label: "Not recoverable", tone: "danger" },
};

export function RejectionsPanel({ d, periodLabel, exportQuery, sla }: { d: RejectionDesk; periodLabel: string; exportQuery: string; sla: number }) {
  const t = d.totals;
  const reasonMax = Math.max(1, ...d.reasons.map((r) => r.count));
  const funnelTop = d.funnel[0]?.count ?? 0;
  return (
    <Section
      title="SIP rejections and recovery"
      subtitle={`Received ${inPeriod(periodLabel)}, plus every one still open.`}
      icon={<RotateCcw className="size-4" />}
      action={
        <span className="flex items-center gap-2">
          <DownloadButton url={`/api/ops/export?kind=sip&${exportQuery}`} filename="sip-rejections.csv"
            className={buttonClass("secondary", "sm")} ariaLabel="Export SIP rejections as CSV">
            <Download className="size-3.5" aria-hidden /> Export
          </DownloadButton>
          <Link href="/dashboard/sip-rejections" className="inline-flex min-h-6 items-center text-xs font-medium text-primary hover:underline">Register ↗</Link>
        </span>
      }
      note={`Past SLA: open and unchanged for more than ${sla} days (Settings → Dashboard thresholds).`}
    >
      <StatGrid cols={5}>
        <Stat label={`Rejected — ${periodLabel}`} value={t.count} tone={t.count ? "bad" : "neutral"} hint={t.count ? formatMoney(t.value) : undefined} />
        <Stat label="Recovered, of those" value={t.recovered} tone={t.recovered ? "good" : "neutral"} hint={t.recovered ? formatMoney(t.recoveredValue) : undefined} />
        <Stat label="Still pending, of those" value={t.pendingCount} tone={t.pendingCount ? "warn" : "neutral"} hint={t.pendingCount ? formatMoney(t.pendingValue) : undefined} />
        <Stat label="All open now" value={t.openAll} hint={t.openAll ? formatMoney(t.openAllValue) : "any date"} />
        <Stat label="Past SLA" value={t.pastSla} tone={t.pastSla ? "bad" : "neutral"} hint={`${t.withoutRemarks} without remarks`} />
      </StatGrid>

      <div className="mt-4">
        <Table rows={d.rows.length} empty="No SIP rejection in this view." head={<>
          <th scope="col">Client · RM · branch</th>
          <th scope="col" className="text-right">SIP amount</th>
          <th scope="col">Rejected</th>
          <th scope="col">Reason</th>
          <th scope="col">Follow-up</th>
          <th scope="col" className="text-right">Pending</th>
          <th scope="col">Assigned to</th>
        </>}>
          {d.rows.map((r) => (
            <tr key={r.id} className={cn(r.pastSla && "bg-destructive/5")}>
              <td className="py-2.5">
                <div className="w-44 whitespace-normal">
                  <Link href={`/dashboard/investors/${r.investorId}`} className="text-xs font-medium hover:text-primary hover:underline">{r.client}</Link>
                  <div className="text-2xs text-muted-foreground">{[r.rm ?? "No RM", r.branch ?? "No branch"].join(" · ")}</div>
                </div>
              </td>
              <Num>{formatMoney(r.amount)}</Num>
              <td className="whitespace-nowrap py-2.5 text-xs">
                {fmtIstDay(r.date)}
                <div className={cn("text-2xs", r.pastSla ? "font-semibold text-destructive" : "text-muted-foreground")}>
                  {r.ageDays} d{r.pastSla ? " · past SLA" : ""}
                </div>
              </td>
              <td className="py-2.5 text-xs">
                <div className="w-48 whitespace-normal">
                  {r.reason ?? <span className="font-medium text-warning-foreground">Reason not updated</span>}
                  <div className="truncate text-2xs italic text-muted-foreground" title={r.remarks ?? undefined}>{r.remarks ?? "No remark"}</div>
                </div>
              </td>
              <td className="py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-1">
                  <span>{r.followUp}</span>
                  <Badge raw tone={REPURCHASE[r.repurchase].tone}>{REPURCHASE[r.repurchase].label}</Badge>
                </div>
                {r.followUpDate && <div className="text-2xs text-muted-foreground">next {fmtIstDay(r.followUpDate)}</div>}
              </td>
              <Num tone={r.pending ? "warn" : "neutral"}>{r.pending ? formatMoney(r.pending) : "—"}</Num>
              <td className="whitespace-nowrap py-2.5 text-xs">{r.assignedTo ?? <span className="text-warning-foreground">Not assigned</span>}</td>
            </tr>
          ))}
        </Table>
        {d.more > 0 && <p className="mt-2 text-center text-2xs text-muted-foreground">{d.more} more in the register — export for the full list.</p>}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-foreground">Rejection reasons</h3>
          {d.reasons.length === 0 ? <Unavailable>No rejection to analyse.</Unavailable> : (
            <ul className="space-y-1.5">
              {d.reasons.map((r) => (
                <li key={r.key} className="flex items-center gap-2 text-xs">
                  <span className={cn("w-32 shrink-0 truncate sm:w-44", r.missing ? "font-medium text-warning-foreground" : "text-foreground")} title={r.label}>{r.label}</span>
                  <span className="h-4 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
                    <span className={cn("block h-full rounded", r.missing ? "bg-warning" : "bg-primary/60")} style={{ width: `${(r.count / reasonMax) * 100}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums sm:w-10">{formatCount(r.count)}</span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground sm:w-24">{formatMoney(r.value)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-2xs text-muted-foreground">Reasons are the register&apos;s own values; &ldquo;Reason not updated&rdquo; is an exception to fix, not a reason.</p>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-foreground">
            Recovery {d.recoveryPct != null && <>— {formatPercent(d.recoveryPct * 100, 0)} recovered</>}
          </h3>
          {funnelTop === 0 ? <Unavailable>No rejection to recover.</Unavailable> : (
            <div className="space-y-1.5">
              {d.funnel.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0 truncate sm:w-44" title={s.label}>{s.label}</span>
                  <span className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
                    {s.count > 0 && (
                      <span className={cn("flex h-full items-center rounded px-1.5 text-2xs font-semibold text-primary-foreground", s.key === "completed" ? "bg-success" : "bg-primary/70")}
                            style={{ width: `${Math.max(6, (s.count / funnelTop) * 100)}%` }}>
                        {formatCount(s.count)}
                      </span>
                    )}
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground sm:w-24">{formatMoney(s.value)}</span>
                </div>
              ))}
              {d.notRecoverable > 0 && <p className="text-2xs text-muted-foreground">{d.notRecoverable} marked not recoverable.</p>}
              <p className="text-2xs text-muted-foreground">
                Pending value: {formatMoney(t.openAllValue)} across {formatCount(t.openAll)} open rejection{t.openAll === 1 ? "" : "s"}.
              </p>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
