/**
 * Process Measures — how well each core process is done, over the last 90
 * days (lib/practice/measures.ts). A process the CRM cannot measure says so,
 * with what it would need, rather than showing a zero.
 */

import Link from "next/link";
import { Lock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canViewPractice } from "@/lib/practice/access";
import { PRACTICE_PROCESSES } from "@/lib/practice/catalog";
import { MEASURE_SOURCE } from "@/lib/practice/map";
import { formatMeasure, runAllMeasures } from "@/lib/practice/measures";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { PracticeNav } from "@/components/practice/PracticeNav";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/common/EmptyState";

export const dynamic = "force-dynamic";

export default async function ProcessMeasuresPage() {
  const session = await requireSession();

  if (!canViewPractice(session)) {
    return (
      <div className="space-y-6 max-w-7xl">
        <PageHeaderCard title="Process Measures" />
        <EmptyState
          icon={Lock}
          title="Process measures are not available to you"
          description="These figures are for the people who run the firm: the owner, branch heads and compliance."
          primary={{ href: "/dashboard/sops", label: "Open the SOP library" }}
        />
      </div>
    );
  }

  const measures = await withTenant(
    session.tenantId,
    (tx) => runAllMeasures(tx, session.tenantId, PRACTICE_PROCESSES.map((p) => p.measure)),
    { userId: session.userId, branchId: session.branchId, roles: session.roles },
  );
  const measured = PRACTICE_PROCESSES.filter((p) => measures.get(p.measure)?.hasData).length;

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard
        title="Process Measures"
        subtitle="What gets measured gets managed: each core process, firm-wide, over the last 90 days unless it says otherwise."
      />
      <PracticeNav active="measures" />

      <Card>
        <CardHeader
          title="Every core process"
          subtitle={`${measured} of ${PRACTICE_PROCESSES.length} processes can be measured from what the CRM records.`}
        />
        <ul className="divide-y divide-border">
          {PRACTICE_PROCESSES.map((p) => {
            const m = measures.get(p.measure);
            const has = !!m?.hasData;
            const src = MEASURE_SOURCE[p.measure];
            return (
              <li key={p.key} className="grid gap-3 px-5 py-4 md:grid-cols-12">
                <div className="min-w-0 md:col-span-5">
                  <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">What good looks like: </span>{p.outcome}
                  </p>
                </div>
                <div className="min-w-0 md:col-span-3">
                  <div className={`text-2xl font-semibold tabular-nums ${has ? "text-foreground" : "text-muted-foreground"}`}>
                    {m ? formatMeasure(m) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">{m?.label ?? "Not measured"}</div>
                </div>
                <div className="min-w-0 space-y-1 md:col-span-4">
                  {has ? (
                    <p className="text-xs text-muted-foreground">{m?.detail}</p>
                  ) : (
                    <>
                      <Badge tone="neutral" raw>No data yet</Badge>
                      {m?.detail && <p className="text-xs text-muted-foreground">{m.detail}</p>}
                      <Link href={src.href} className="block text-xs text-primary hover:underline">{src.text}</Link>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
