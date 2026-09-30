/**
 * §38 insurance data quality · §39 data completeness, branch → RM.
 */

import { ClipboardCheck } from "lucide-react";
import type { Quality } from "@/lib/dashboard/insurance/quality";
import { QUALITY_CHECKS } from "@/lib/dashboard/insurance/quality";
import { Num, Section, Stat, StatGrid, Table } from "@/components/dashboards/my/Shared";
import { formatCount, formatPercent } from "@/lib/format";

export function QualityPanel({ q, names, branches, hrefFor, branchHref, ownerHref }: {
  q: Quality; names: Map<string, string>; branches: Map<string, string>;
  hrefFor: (gap: string) => string; branchHref: (id: string) => string; ownerHref: (id: string) => string;
}) {
  const pct = (v: number | null) => (v == null ? "—" : formatPercent(v * 100, 1));
  return (
    <Section title="Insurance data quality" subtitle={`${formatCount(q.policies)} in-force and pending policies checked · ${pct(q.pct)} complete.`}
      icon={<ClipboardCheck className="size-4" />}
      note="Counted as required: client category, premium, insurer, a recognised policy type, an owner, a branch and a client phone or email on every policy; a renewal date on renewable in-force policies; a policy number once issued. Status is never blank. The CRM has no mandatory-field setting for policies yet, so this list is fixed.">
      <StatGrid cols={5}>
        {QUALITY_CHECKS.map((c) => (
          <Stat key={c.key} label={c.label} value={q.counts[c.key]} tone={q.counts[c.key] > 0 ? "warn" : "neutral"} href={hrefFor(c.gap)} />
        ))}
        <Stat label="Data completion" value={q.pct} format="percent" tone={q.pct != null && q.pct >= 0.95 ? "good" : "neutral"} unavailable="No policy to check." />
      </StatGrid>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">Completion by branch</h3>
          <Table rows={q.byBranch.length} empty="No policy to check." head={<>
            <th scope="col">Branch</th><th scope="col" className="text-right">Policies</th><th scope="col" className="text-right">Gaps</th><th scope="col" className="text-right">Complete</th>
          </>}>
            {q.byBranch.map((b) => (
              <tr key={b.key ?? "none"}>
                <td className="py-2 text-xs font-medium">{b.key ? <a href={branchHref(b.key)} className="hover:text-primary hover:underline">{branches.get(b.key) ?? "Branch"}</a> : <span className="text-muted-foreground">No branch recorded</span>}</td>
                <Num>{formatCount(b.policies)}</Num>
                <Num tone={b.gaps > 0 ? "warn" : "neutral"}>{formatCount(b.gaps)}</Num>
                <Num>{pct(b.pct)}</Num>
              </tr>
            ))}
          </Table>
        </div>
        <div className="min-w-0">
          <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">Completion by RM</h3>
          <Table rows={q.byOwner.length} empty="No policy to check." head={<>
            <th scope="col">RM / owner</th><th scope="col" className="text-right">Policies</th><th scope="col" className="text-right">Gaps</th><th scope="col" className="text-right">Complete</th>
          </>}>
            {q.byOwner.slice(0, 15).map((o) => (
              <tr key={o.key ?? "none"}>
                <td className="py-2 text-xs font-medium">{o.key ? <a href={ownerHref(o.key)} className="hover:text-primary hover:underline">{names.get(o.key) ?? "Former user"}</a> : <span className="text-warning-foreground">Owner missing</span>}</td>
                <Num>{formatCount(o.policies)}</Num>
                <Num tone={o.gaps > 0 ? "warn" : "neutral"}>{formatCount(o.gaps)}</Num>
                <Num>{pct(o.pct)}</Num>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </Section>
  );
}
