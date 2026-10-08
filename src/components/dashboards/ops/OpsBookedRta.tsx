/**
 * Booked vs RTA — the Operations Dashboard's worklist for business the team
 * booked that the registrar did not confirm, and RTA business nobody booked
 * (lib/dashboard/ops/booked-rta.ts). Rejections tab, anchor "booked-rta".
 */

import Link from "next/link";
import { FileWarning } from "lucide-react";
import { Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "../my/Shared";
import { Badge } from "@/components/ui/Badge";
import { formatMoney } from "@/lib/format";
import { fmtIstDay, inPeriod } from "@/lib/dashboard/ops/fmt";
import { RTA_STATUS_LABEL, RTA_STATUS_TONE } from "@/lib/business/rta-status";
import type { BookedRtaDesk } from "@/lib/dashboard/ops/booked-rta";

const TXN: Record<string, string> = {
  sip: "SIP", sip_topup: "SIP top-up", sip_stop: "SIP stop", lumpsum: "Lumpsum", additional_purchase: "Additional purchase",
  purchase: "Purchase", redemption: "Redemption", switch: "Switch", stp: "STP", swp: "SWP",
};
const txn = (t: string) => TXN[t] ?? t.replace(/_/g, " ");

export function BookedRtaPanel({ d, periodLabel }: { d: BookedRtaDesk | null; periodLabel: string }) {
  const total = d ? d.rejected + d.notFound + d.mismatch : 0;
  return (
    <Section
      title="Booked vs RTA"
      icon={<FileWarning className="size-4" />}
      action={d && total > 0 ? <SectionLink href="/dashboard/business-entries?rta=rejected,not_found,mismatch">Business entries</SectionLink> : undefined}
      note="Each mutual-fund line of a confirmed entry is checked against the RTA feed after every import and each night. Not found means the firm's wait is over and the imported feed reaches past it. Targets count the booking; incentives count only what the RTA processed."
    >
      {!d ? <Unavailable>Booked business is outside your own-work view.</Unavailable> : (
        <>
          <StatGrid cols={4}>
            <Stat label="Rejected by RTA" value={d.rejected} tone={d.rejected ? "bad" : "neutral"} href="/dashboard/business-entries?rta=rejected" />
            <Stat label="Not found in RTA" value={d.notFound} tone={d.notFound ? "warn" : "neutral"} href="/dashboard/business-entries?rta=not_found" />
            <Stat label="Amount differs" value={d.mismatch} tone={d.mismatch ? "warn" : "neutral"} href="/dashboard/business-entries?rta=mismatch" />
            <Stat
              label="RTA business not booked"
              value={d.unbooked?.count ?? null}
              display={d.unbooked ? undefined : "No entries yet"}
              tone={d.unbooked?.count ? "warn" : "neutral"}
              hint={d.unbooked?.count ? formatMoney(d.unbooked.value) : undefined}
            />
          </StatGrid>

          <div className="mt-4">
            <Table rows={d.rows.length} empty={`Every booked line ${inPeriod(periodLabel)} agrees with the RTA so far.`} head={<>
              <th scope="col">Client · RM</th>
              <th scope="col">Booked</th>
              <th scope="col" className="text-right">Amount</th>
              <th scope="col">RTA</th>
              <th scope="col">Booked on</th>
            </>}>
              {d.rows.map((r) => (
                <tr key={r.lineId}>
                  <td className="py-2.5">
                    {r.investorId
                      ? <Link href={`/dashboard/investors/${r.investorId}`} className="text-xs font-medium hover:text-primary hover:underline">{r.client}</Link>
                      : <span className="text-xs font-medium">{r.client}</span>}
                    <div className="text-2xs text-muted-foreground">{r.rm ?? "No RM"}</div>
                  </td>
                  <td className="py-2.5 text-xs">
                    <Link href={`/dashboard/business-entries/${r.entryId}`} className="hover:text-primary hover:underline">{txn(r.type)}</Link>
                    <div className="text-2xs text-muted-foreground">{r.scheme}</div>
                  </td>
                  <Num>
                    {formatMoney(r.booked)}
                    {r.status === "mismatch" && r.rtaAmount != null && (
                      <div className="text-2xs text-muted-foreground">RTA {formatMoney(r.rtaAmount)}</div>
                    )}
                  </Num>
                  <td className="py-2.5 text-xs">
                    <Badge tone={RTA_STATUS_TONE[r.status]} raw>{RTA_STATUS_LABEL[r.status]}</Badge>
                    {(r.note || (r.statusAt && r.status !== "not_found")) && (
                      <div className="mt-0.5 max-w-xs text-2xs text-muted-foreground">
                        {[r.statusAt && r.status !== "not_found" ? fmtIstDay(r.statusAt) : null, r.note].filter(Boolean).join(". ")}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDay(r.businessDate)}</td>
                </tr>
              ))}
            </Table>
            {d.more > 0 && (
              <p className="mt-2 text-center text-2xs text-muted-foreground">
                {d.more} more in <Link href="/dashboard/business-entries?rta=rejected,not_found,mismatch" className="text-primary hover:underline">Business entries</Link>.
              </p>
            )}
          </div>

          {d.unbooked && d.unbooked.count > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold" title={`Processed RTA purchases with no booked entry, since the firm's first entry (${fmtIstDay(d.unbooked.since)}). They count for the client's RM.`}>
                RTA business not booked
              </div>
              <Table rows={d.unbooked.rows.length} empty="Nothing unbooked." head={<>
                <th scope="col">Client · RM</th>
                <th scope="col">Transaction</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col">Date</th>
              </>}>
                {d.unbooked.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="text-xs font-medium hover:text-primary hover:underline">{r.client}</Link>
                      <div className="text-2xs text-muted-foreground">{r.rm ?? "No RM"}</div>
                    </td>
                    <td className="py-2.5 text-xs">{txn(r.type)}{r.scheme && <div className="text-2xs text-muted-foreground">{r.scheme}</div>}</td>
                    <Num>{r.amount != null ? formatMoney(r.amount) : "-"}</Num>
                    <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDay(r.date)}</td>
                  </tr>
                ))}
              </Table>
              {d.unbooked.more > 0 && <p className="mt-2 text-center text-2xs text-muted-foreground">{d.unbooked.more} more.</p>}
            </div>
          )}
        </>
      )}
    </Section>
  );
}
