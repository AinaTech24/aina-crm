/**
 * §18 lost / cancelled business · §19 lost business analysis.
 */

import { TrendingDown } from "lucide-react";
import type { LostDesk } from "@/lib/dashboard/insurance/lost";
import { GROUP_LABEL, POLICY_STATUS_LABEL } from "@/lib/insurance/book";
import { Section, SectionLink, Stat, StatGrid, Table, Num } from "@/components/dashboards/my/Shared";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { BarRow } from "./parts";
import { ClientLink } from "./InsClientDrawer";

export function LostPanel({ d, periodLabel, names, branches, hrefs }: {
  d: LostDesk; periodLabel: string; names: Map<string, string>; branches: Map<string, string>; hrefs: Record<string, string>;
}) {
  const splits = [
    { key: "reason", label: "Lost premium by reason", rows: d.byReason.map((x) => ({ ...x, label: x.key ? x.label ?? x.key : "Reason not captured" })) },
    { key: "product", label: "Lost premium by product", rows: d.byGroup.map((x) => ({ ...x, label: GROUP_LABEL[x.key ?? ""] ?? "Type not recognised" })) },
    { key: "branch", label: "Lost premium by branch", rows: d.byBranch.map((x) => ({ ...x, label: x.key ? branches.get(x.key) ?? "Branch" : "No branch recorded" })) },
    { key: "rm", label: "Lost premium by RM", rows: d.byOwner.map((x) => ({ ...x, label: x.key ? names.get(x.key) ?? "Former user" : "Owner missing" })) },
    { key: "insurer", label: "Lost premium by insurer", rows: d.byInsurer.map((x) => ({ ...x, label: x.label ?? "Insurer not recorded" })) },
  ];
  const noReason = d.byReason.find((x) => x.key == null)?.count ?? 0;
  return (
    <Section title="Lost / cancelled business" subtitle={`${periodLabel} — policies that lapsed, were surrendered or cancelled.`}
      icon={<TrendingDown className="size-4" />} action={<SectionLink href={hrefs.lostRegister}>Lapsed and cancelled policies</SectionLink>}
      note={`Dated from the audit trail: the policy has no lapse or cancellation date of its own. The reason is the policy's lapse reason as keyed — the policy form has no field for it yet, so most read "Reason not captured".${d.undated.count ? ` ${formatCount(d.undated.count)} more polic${d.undated.count === 1 ? "y is" : "ies are"} marked lost with no recorded date (${formatMoney(d.undated.premium)}) and are not counted in any period.` : ""}`}>
      <StatGrid cols={4}>
        <Stat label="Policies lost" value={d.count} tone={d.count ? "bad" : "neutral"} href={hrefs.lostTable} />
        <Stat label="Lost premium" value={d.premium} format="currency" tone={d.premium ? "bad" : "neutral"} href={hrefs.lostTable} />
        <Stat label="New business lost" value={d.newBiz.premium} format="currency" hint={`${formatCount(d.newBiz.count)} cancelled before issue`} tone={d.newBiz.count ? "bad" : "neutral"} href={hrefs.lostTable} />
        <Stat label="Renewal lost" value={d.renewal.premium} format="currency" hint={`${formatCount(d.renewal.count)} lapsed / surrendered / cancelled`} tone={d.renewal.count ? "bad" : "neutral"} href={hrefs.lostTable} />
      </StatGrid>
      {d.count > 0 && (
        <>
          {noReason > 0 && <p className="mt-3 text-2xs text-warning-foreground">{formatCount(noReason)} of {formatCount(d.count)} lost policies have no reason captured.</p>}
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            {splits.map((s) => {
              const max = Math.max(0, ...s.rows.map((r) => r.premium));
              return (
                <div key={s.key} className="min-w-0">
                  <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">{s.label}</h3>
                  {s.rows.slice(0, 8).map((r) => (
                    <BarRow key={`${s.key}-${r.key ?? "none"}`} label={r.label} value={r.premium} max={max} tone="danger"
                      right={<>{formatMoney(r.premium)} · {formatCount(r.count)}</>} />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="mt-5" id="lost-table">
            <Table rows={d.rows.length} empty="" head={<>
              <th scope="col">Client</th>
              <th scope="col">Product</th>
              <th scope="col" className="text-right">Premium lost</th>
              <th scope="col">Reason</th>
              <th scope="col">Owner</th>
              <th scope="col">Status</th>
              <th scope="col">Date</th>
            </>}>
              {d.rows.map((r) => (
                <tr key={r.policyId}>
                  <td className="py-2.5 text-xs font-medium"><ClientLink id={r.investorId} name={r.client} /></td>
                  <td className="py-2.5 text-xs"><a href={`/dashboard/insurance/${r.policyId}`} className="hover:text-primary hover:underline">{GROUP_LABEL[r.grp] ?? r.plan}</a></td>
                  <Num tone="bad">{formatMoney(r.premium)}</Num>
                  <td className="py-2.5 text-xs">{r.reason ?? <span className="text-muted-foreground">Reason not captured</span>}</td>
                  <td className="py-2.5 text-xs">{r.ownerId ? names.get(r.ownerId) ?? "—" : <span className="text-warning-foreground">Owner missing</span>}</td>
                  <td className="py-2.5 text-xs">{POLICY_STATUS_LABEL[r.status] ?? r.status}{r.newBusiness ? " (before issue)" : ""}</td>
                  <td className="whitespace-nowrap py-2.5 text-xs tabular-nums">{formatDate(r.lostOn)}</td>
                </tr>
              ))}
            </Table>
            {d.more > 0 && <p className="mt-2 text-center text-2xs text-muted-foreground">{d.more} more lost in this period.</p>}
          </div>
        </>
      )}
    </Section>
  );
}
