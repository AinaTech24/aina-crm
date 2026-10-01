/**
 * §12 SIP health and §13 redemption watch — the two exception desks.
 *
 * ── Redemption is not automatically a problem ───────────────────────────────
 *
 * The brief says so and it is right. A client funding a house purchase is not
 * churning, and a table that paints every exit red trains the reader to skip
 * the colour. So this table:
 *
 *   · shows the recorded REASON where the feed carried one, and says
 *     "Not recorded" rather than inventing a motive;
 *   · takes severity from SIZE RELATIVE TO THE RELATIONSHIP, because ₹2 L is
 *     most of a ₹3 L client and a rounding error on a ₹5 Cr one;
 *   · marks whether anyone has followed up, which is the actually actionable
 *     column.
 */

import Link from "next/link";
import { Repeat, TrendingDown } from "lucide-react";
import type { RedemptionWatch, SipHealth } from "@/lib/dashboard/my/pipeline";
import { CategoryTag, Figure, Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "./Shared";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import { formatDate, formatMoney, formatPercent, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MySipHealth({ data, periodLabel }: { data: SipHealth; periodLabel: string }) {
  return (
    <Section
      title="SIP health"
      subtitle="The recurring book, and every debit that did not go through."
      icon={<Repeat className="size-4" />}
      action={<SectionLink href="/dashboard/sip-rejections">SIP rejections</SectionLink>}
      note="Rejections are read from the transaction ledger, not only from the rejection register — a book whose feed predates the register would otherwise show a clean SIP book while five debits had bounced."
    >
      <StatGrid cols={4}>
        <Stat label="Active SIP book" value={data.activeBook} format="currency" hint={`${data.activeCount} mandates`} href="/dashboard/sips" />
        <Stat label="Gross added" value={data.grossAdded} format="currency" hint={periodLabel} />
        <Stat label="Stopped" value={data.stopped} format="currency" hint={periodLabel} tone={(data.stopped ?? 0) > 0 ? "warn" : "neutral"} />
        <Stat
          label="Net SIP"
          value={data.netSip}
          format="currency"
          tone={data.netSip == null ? "neutral" : data.netSip >= 0 ? "good" : "bad"}
          hint="added − stopped"
        />
        <Stat
          label="Rejections"
          value={data.rejections}
          tone={data.rejections > 0 ? "bad" : "good"}
          hint={data.rejections > 0 ? `${formatMoney(data.rejectionValue)} bounced, 180 days` : "last 180 days"}
          href="/dashboard/sip-rejections"
        />
        <Stat label="Repurchase done" value={data.repurchaseDone} tone={data.repurchaseDone > 0 ? "good" : "neutral"} />
        <Stat
          label="Repurchase pending"
          value={data.repurchasePending}
          tone={data.repurchasePending > 0 ? "bad" : "good"}
          hint={data.repurchasePending > 0 ? formatMoney(data.repurchasePendingValue) : undefined}
        />
        <Stat
          label="SIPs without remarks"
          value={data.withoutRemarks}
          tone={data.withoutRemarks > 0 ? "warn" : "neutral"}
          hint="no context recorded"
        />
      </StatGrid>

      <div className="mt-4">
        <Table
          rows={data.rows.length}
          empty="No SIP has been rejected on your book in the last 180 days."
          head={
            <>
              <th scope="col">Client</th>
              <th scope="col" className="text-right">SIP amount</th>
              <th scope="col">Rejected</th>
              <th scope="col">Reason</th>
              <th scope="col">Repurchase</th>
              <th scope="col" className="text-right">Still pending</th>
              <th scope="col">Follow-up</th>
              <th scope="col">Remarks</th>
              <th scope="col" className="text-right">Action</th>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2.5">
                <Link href={`/dashboard/investors/${r.clientId}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
              </td>
              <Num>{formatMoney(r.amount)}</Num>
              <td className="py-2.5 text-xs">{r.rejectedOn ? formatDate(r.rejectedOn) : "—"}</td>
              <td className="py-2.5 text-xs">
                {/* The one long text in the row wraps, so the Action column stays on screen. */}
                {r.reason ? <span className="block max-w-56 whitespace-normal leading-snug">{humanise(r.reason)}</span> : <span className="text-muted-foreground" title="The feed carried no reason code.">Not recorded</span>}
              </td>
              <td className="py-2.5">
                <span
                  className={cn(
                    "chip",
                    ["recovered", "reprocessed"].includes(r.repurchase) ? "bg-success/10 text-success"
                    : r.repurchase === "not_recoverable" ? "bg-secondary text-secondary-foreground"
                    : "bg-destructive/10 text-destructive",
                  )}
                >
                  {humanise(r.repurchase)}
                </span>
              </td>
              <Num tone={r.pendingValue > 0 ? "bad" : "neutral"}>
                {r.pendingValue > 0 ? formatMoney(r.pendingValue) : <span className="text-muted-foreground">—</span>}
              </Num>
              <td className="py-2.5 text-xs">
                {r.followUp ? formatDate(r.followUp) : <span className="text-muted-foreground">Not set</span>}
              </td>
              <td className="py-2.5 text-xs">
                {r.remarks ?? <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2.5">
                {/* Contact the client from the RM's own phone; remarks, the
                    follow-up date and the repurchase are recorded on the
                    rejection register, where those edits are permitted. */}
                <span className="flex items-center justify-end gap-1">
                  <ContactQuickActions phone={r.phone} email={r.email} show={["call", "whatsapp"]} />
                  <Link href={`/dashboard/sip-rejections?q=${encodeURIComponent(r.client)}`}
                        className="inline-flex min-h-6 items-center whitespace-nowrap text-xs font-medium text-primary hover:underline">Update</Link>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}

export function MyRedemptions({ data, periodLabel }: { data: RedemptionWatch; periodLabel: string }) {
  return (
    <Section
      title="Redemption watch"
      subtitle={`Money that left my book in ${periodLabel}, and whether anyone has asked why.`}
      icon={<TrendingDown className="size-4" />}
      action={<SectionLink href="/dashboard/reports/redemption">Redemption report</SectionLink>}
      note={`Not every redemption is a problem. Severity comes from size relative to the relationship, and the reason is shown only where the feed recorded one. High-value threshold: ${formatMoney(data.highValueThreshold)}.`}
    >
      {data.total == null ? (
        <Unavailable>
          No redemption has ever been recorded against your clients, so there is nothing to watch.
        </Unavailable>
      ) : (
        <>
          <StatGrid cols={4}>
            <Stat label="Redeemed" value={data.total} format="currency" hint={periodLabel} tone={data.total > 0 ? "warn" : "neutral"} />
            <Stat label="Clients who redeemed" value={data.clients} />
            <Stat
              label="High value"
              value={data.highValue}
              tone={data.highValue > 0 ? "bad" : "neutral"}
              hint={`over ${formatMoney(data.highValueThreshold)}`}
            />
            <Stat
              label="No follow-up yet"
              value={data.followUpPending}
              tone={data.followUpPending > 0 ? "bad" : "good"}
              hint="no task raised since"
            />
          </StatGrid>

          <div className="mt-4">
            <Table
              rows={data.rows.length}
              empty="Nothing redeemed in this period."
              head={
                <>
                  <th scope="col">Client</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="text-right">Remaining AUM</th>
                  <th scope="col" className="text-right">Redeemed</th>
                  <th scope="col" className="text-right">Share of relationship</th>
                  <th scope="col">Date</th>
                  <th scope="col">Scheme</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Followed up</th>
                </>
              }
            >
              {data.rows.map((r) => {
                const heavy = r.shareOfAum != null && r.shareOfAum >= 0.25;
                return (
                  <tr key={r.id}>
                    <td className="py-2.5">
                      <Link href={`/dashboard/investors/${r.clientId}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                    </td>
                    <td className="py-2.5"><CategoryTag value={r.category} /></td>
                    <Num>{formatMoney(r.aum)}</Num>
                    <Num tone={r.amount >= data.highValueThreshold ? "warn" : "neutral"}>{formatMoney(r.amount)}</Num>
                    <Num tone={heavy ? "bad" : "neutral"}>
                      {r.shareOfAum == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span title="Against the relationship as it stood before this exit — an approximation of AUM plus this redemption.">
                          {formatPercent(r.shareOfAum * 100, 0)}
                        </span>
                      )}
                    </Num>
                    <td className="py-2.5 text-xs">{formatDate(r.date)}</td>
                    <td className="py-2.5 text-xs">{r.product ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2.5 text-xs">
                      {r.reason ? humanise(r.reason) : <span className="text-muted-foreground" title="No reason was recorded. That is not the same as no reason.">Not recorded</span>}
                    </td>
                    <td className="py-2.5">
                      {r.followedUp ? (
                        <span className="chip bg-success/10 text-success">Yes</span>
                      ) : (
                        <span className="chip bg-destructive/10 text-destructive">Not yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </>
      )}
    </Section>
  );
}
