/**
 * Practice Systems — the map of how far the firm runs as a system
 * (The E-Myth Revisited). Every core process scored on four pillars:
 * documented, owned, measured, automated. See lib/practice/map.ts.
 */

import { Lock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canManagePractice, canViewPractice } from "@/lib/practice/access";
import { SYSTEM_PILLARS } from "@/lib/practice/catalog";
import { loadSystemsMap, nextStep, pillarsMet, processAnchor } from "@/lib/practice/map";
import { formatMeasure } from "@/lib/practice/measures";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { PracticeNav } from "@/components/practice/PracticeNav";
import { SystemsMapTable, type SystemsMapViewRow } from "@/components/practice/SystemsMapTable";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { InfoTip } from "@/components/dashboards/my/InfoTip";

export const dynamic = "force-dynamic";

export default async function PracticeSystemsPage() {
  const session = await requireSession();

  if (!canViewPractice(session)) {
    return (
      <div className="space-y-6 max-w-7xl">
        <PageHeaderCard title="Practice Systems" />
        <EmptyState
          icon={Lock}
          title="Practice Systems is not available to you"
          description="The systems map is for the people who run the firm: the owner, branch heads and compliance. Your own operations manual and the SOP library are open to everyone."
          primary={{ href: "/dashboard/sops", label: "Open the SOP library" }}
        />
      </div>
    );
  }

  const canManage = canManagePractice(session);
  const map = await withTenant(
    session.tenantId,
    (tx) => loadSystemsMap(tx, session.tenantId),
    { userId: session.userId, branchId: session.branchId, roles: session.roles },
  );

  const rows: SystemsMapViewRow[] = map.rows.map((r) => {
    const step = nextStep(r);
    return {
      key: r.key,
      anchor: processAnchor(r.key),
      name: r.name,
      outcome: r.outcome,
      pillars: r.pillars,
      met: pillarsMet(r),
      measure: { figure: formatMeasure(r.measure), label: r.measure.label, detail: r.measure.detail, hasData: r.measure.hasData },
      owner: r.owner ? { positionId: r.owner.positionId, title: r.owner.title, holders: r.owner.holders.map((h) => h.name) } : null,
      sops: r.sops.map((s) => ({ sopId: s.sopId, title: s.title, linkId: s.linkId, direct: s.via === "process", via: s.via })),
      recipes: r.recipes,
      rules: r.rules ?? [],
      next: step ? { text: step.text, href: step.href } : null,
    };
  });

  const byPillar = SYSTEM_PILLARS.map((p) => ({
    ...p,
    count: map.rows.filter((r) => r.pillars[p.key]).length,
  }));
  const fully = rows.filter((r) => r.met === SYSTEM_PILLARS.length).length;

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard
        title="Practice Systems"
        subtitle="Work on your firm, not just in it: every core process documented, owned by a position, measured and automated."
      />
      <PracticeNav active="map" />

      <Card>
        <div className="flex flex-col gap-5 px-5 py-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">
                Your practice is <span className="tabular-nums">{map.score.pct}%</span> systemised
              </h2>
              <InfoTip label="What systemised means">
                Michael Gerber&apos;s E-Myth: a firm that depends on the owner doing the work is a job; one whose
                every process is written down, owned by a position, measured and run by the system can grow
                without them.
              </InfoTip>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {map.score.met} of {map.score.total} pillars in place across {rows.length} core processes
              {fully ? ` · ${fully} fully systemised` : ""}.
            </p>
            <div
              className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={map.score.pct}
              aria-label="Practice systemised"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${map.score.pct}%` }} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:w-auto">
            {byPillar.map((p) => (
              <div key={p.key} className="rounded-md bg-secondary/70 px-3 py-2" title={p.hint}>
                <dt className="text-xs text-muted-foreground">{p.label}</dt>
                <dd className="text-base font-semibold tabular-nums">
                  {p.count}<span className="text-xs font-normal text-muted-foreground"> / {rows.length}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Core processes"
          subtitle={canManage
            ? "Choose who owns each process, link the SOP that says how it is done and turn on its automations."
            : "How each process stands on the four pillars, and what would systemise it next."}
        />
        <SystemsMapTable
          rows={rows}
          positions={map.positions}
          sops={map.sops}
          canManage={canManage}
          pillars={SYSTEM_PILLARS}
        />
      </Card>
    </div>
  );
}
