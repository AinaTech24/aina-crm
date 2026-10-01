import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Columns3 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { PIPELINES, PIPELINE_KEYS, firstStage, isPipeline, type PipelineKey } from "@/lib/pipelines/config";
import { StageMover } from "@/components/pipelines/StageMover";
import { WorkSwitcher } from "@/components/layout/WorkSwitcher";
import { investorScopeSql } from "@/lib/investors/access";
import { OPPORTUNITY_PATHS, stageName } from "@/lib/opportunities/stages";
import { productLabel } from "@/lib/opportunities/products";

export const dynamic = "force-dynamic";

const PIPELINE_VIEWS = [
  { value: "/dashboard/leads", label: "Leads" },
  { value: "/dashboard/pipeline-board", label: "Pipeline Board" },
  { value: "/dashboard/lifecycle", label: "Lifecycle" },
];

const AMT = (col: string) => sql.raw(`NULLIF(regexp_replace(COALESCE(${col},''),'[^0-9.]','','g'),'')::numeric`);

type BoardStage = { key: string; label: string; won?: boolean; lost?: boolean };
type Card = { id: string; name: string; href: string; amt: number; owner: string | null; stage: string; sub?: string | null; delayed?: boolean };

/**
 * Two boards, one page:
 *   New clients (default)  leads, in the multiple-pipelines stages; cards move
 *                          freely with StageMover.
 *   Existing clients       opportunities — a client the firm already serves who
 *                          wants another product. Columns are the journey's
 *                          stages for that product line; a card opens the
 *                          client, where the journey (and its gates) is worked.
 */
export default async function PipelineBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const p: PipelineKey = isPipeline(sp.p) ? sp.p : "mf";
  const mine = sp.mine === "1" || !firmWide;
  const existing = sp.view === "existing";
  const fs = firstStage(p);

  const href = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { p, mine: mine ? "1" : null, view: existing ? "existing" : null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/dashboard/pipeline-board?${q}`;
  };

  let stages: BoardStage[];
  let cards: Card[];
  if (!existing) {
    stages = PIPELINES[p].stages;
    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const own = mine ? sql` AND l.owner_id = ${session.userId}::uuid` : sql``;
        return (await tx.execute(sql`
          SELECT l.id, l.name, l.pipeline, COALESCE(l.pipeline_stage, ${fs}) AS pstage, u.name AS owner,
                 COALESCE(${AMT("l.intended_amount")}, 0) AS amt
          FROM leads l LEFT JOIN users u ON u.id = l.owner_id
          WHERE l.tenant_id = ${session.tenantId}::uuid AND l.pipeline = ${p}
            AND l.converted_investor_id IS NULL${own}
          ORDER BY amt DESC NULLS LAST LIMIT 500
        `)).rows as any[];
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    cards = rows.map((r) => ({ id: r.id, name: r.name, href: `/dashboard/leads/${r.id}`, amt: Number(r.amt || 0), owner: r.owner, stage: r.pstage }));
  } else {
    // The journey's stages for this line, then the outcomes of the last 30 days.
    stages = [
      ...OPPORTUNITY_PATHS[p].filter((k) => k !== "won").map((k) => ({ key: k, label: stageName(k) })),
      { key: "won", label: "Won (30 days)", won: true },
      { key: "lost", label: "Lost (30 days)", lost: true },
    ];
    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const own = mine ? sql` AND (o.owner_id = ${session.userId}::uuid OR o.co_owner_id = ${session.userId}::uuid)` : sql``;
        // Anyone who can see clients sees the opportunities of the clients they can see.
        const canSee = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "investor.view.assigned", session.permissions);
        const scope = canSee ? await investorScopeSql(tx, session, "i") : sql`FALSE`;
        return (await tx.execute(sql`
          SELECT o.id, o.product, o.expected_value, o.investor_id, i.name AS client, u.name AS owner,
                 COALESCE(bi.current_stage_key, 'identified') AS stage, bi.is_delayed
            FROM client_opportunities o
            JOIN investors i ON i.id = o.investor_id
            LEFT JOIN users u ON u.id = o.owner_id
            LEFT JOIN blueprint_instances bi
              ON bi.tenant_id = o.tenant_id AND bi.subject_type = 'opportunity' AND bi.subject_id = o.id
           WHERE o.tenant_id = ${session.tenantId}::uuid AND o.pipeline = ${p} AND (${scope})
             AND (o.status = 'open' OR COALESCE(o.won_at, o.lost_at) >= now() - interval '30 days')${own}
           ORDER BY o.expected_value DESC NULLS LAST, o.created_at DESC
           LIMIT 500
        `)).rows as any[];
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    cards = rows.map((r) => ({
      id: r.id, name: r.client, href: `/dashboard/investors/${r.investor_id}#opportunities`,
      amt: Number(r.expected_value || 0), owner: r.owner ? String(r.owner).replace(/\s*\([^)]*\)\s*$/, "") : null,
      stage: r.stage, sub: productLabel(r.product), delayed: !!r.is_delayed,
    }));
  }

  const byStage: Record<string, Card[]> = {};
  for (const s of stages) byStage[s.key] = [];
  for (const c of cards) (byStage[c.stage] ?? (byStage[c.stage] = [])).push(c);
  const valOf = (k: string) => (byStage[k] ?? []).reduce((a, r) => a + Number(r.amt || 0), 0);
  const seg = (on: boolean) => `px-2.5 py-1 rounded-md font-medium ${on ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`;

  return (
    <div className="space-y-5 max-w-full">
      <PageHeaderCard
        title={<><Columns3 className="size-6 text-muted-foreground" /> Pipeline Board</>}
        subtitle={<>
          {existing ? "Existing clients who want another product." : "Separate stage flows for each sales process."}{" "}
          {mine ? (existing ? "Yours." : "Your leads.") : "Firm-wide."}
        </>}
        actions={<><div className="flex flex-wrap items-center gap-2">
          <WorkSwitcher current="/dashboard/pipeline-board" options={PIPELINE_VIEWS} label="Module" />
          <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs" role="group" aria-label="Who">
            <Link href={href({ view: null })} aria-current={!existing ? "page" : undefined} className={seg(!existing)}>New clients</Link>
            <Link href={href({ view: "existing" })} aria-current={existing ? "page" : undefined} className={seg(existing)}>Existing clients</Link>
          </div>
          {firmWide && (
            <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
              <Link href={href({ mine: null })} className={seg(!mine)}>Firm</Link>
              <Link href={href({ mine: "1" })} className={seg(mine)}>Mine</Link>
            </div>
          )}
          <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
            {PIPELINE_KEYS.map((k) => (
              <Link key={k} href={href({ p: k })} className={seg(p === k)}>{PIPELINES[k].label}</Link>
            ))}
          </div>
        </div></>} />

      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((s) => (
          <div key={s.key} className="w-64 shrink-0">
            <div className={`rounded-t-lg px-3 py-2 text-sm font-semibold flex items-center justify-between ${s.won ? "bg-emerald-50 text-emerald-700" : s.lost ? "bg-rose-50 text-rose-700" : "bg-secondary"}`}>
              <span>{s.label} <span className="opacity-60">{(byStage[s.key] ?? []).length}</span></span>
              <span className="text-2xs font-normal text-muted-foreground">{valOf(s.key) > 0 ? formatINR(valOf(s.key)) : ""}</span>
            </div>
            <div className="border border-t-0 rounded-b-lg bg-card/50 p-2 space-y-2 min-h-[120px]">
              {(byStage[s.key] ?? []).length === 0 ? (
                <div className="text-2xs text-muted-foreground text-center py-6">—</div>
              ) : (byStage[s.key] ?? []).map((r) => (
                <div key={r.id} className={`rounded-lg border bg-card p-2.5 shadow-sm ${r.delayed ? "border-amber-300" : ""}`}>
                  <Link href={r.href} className="font-medium text-sm hover:underline block truncate">{r.name}</Link>
                  {r.sub && <div className="text-xs text-foreground/80 truncate">{r.sub}</div>}
                  <div className="text-2xs text-muted-foreground">
                    {Number(r.amt) > 0 ? formatINR(Number(r.amt)) : "—"}{r.owner ? ` · ${r.owner}` : ""}
                    {r.delayed ? <span className="text-amber-700"> · past its target</span> : null}
                  </div>
                  {!existing && <StageMover leadId={r.id} pipeline={p} stage={r.stage} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground italic">
        {existing
          ? "An existing client's opportunity moves on the client's page, where its checks (risk profile, needs analysis, KYC, mandate) are applied and steps already on file are skipped."
          : "Move a card's stage, or switch its pipeline (e.g. send an MF lead into the Insurance flow). The 30-stage onboarding blueprint is unaffected."}
      </p>
    </div>
  );
}
