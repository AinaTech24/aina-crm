import Link from "next/link";
import { sql } from "drizzle-orm";
import { ClipboardCheck, Plus, CheckCircle2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";
import { ONBOARDING_STAGES } from "@/db/schema";

const STAGE_LABELS: Record<string, string> = {
  first_meeting: "First Meeting",
  documents: "Documents",
  kyc: "KYC",
  risk_profile: "Risk Profile",
  goal_mapping: "Goal Mapping",
  ucc_can: "UCC / CAN",
  mandate: "Mandate",
  plan_shared: "Plan Shared",
  first_investment: "First Investment",
  welcome_kit: "Welcome Kit",
  first_review: "First Review",
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const pipelines = await tx.execute(sql`
      SELECT op.id, op.investor_id, op.current_stage, op.status, op.stages,
             op.expected_completion_at, op.actual_completion_at,
             op.pending_documents, op.updated_at,
             i.name AS investor_name, i.pan AS investor_pan, i.segment_tag,
             u.name AS rm_name
      FROM onboarding_pipelines op
      LEFT JOIN investors i ON i.id = op.investor_id
      LEFT JOIN users u ON u.id = op.assigned_rm_id
      ORDER BY op.created_at DESC
      LIMIT 200
    `);
    return { pipelines: pipelines.rows as any[] };
  });

  // Group by current_stage; completed pipelines into a special "Completed" pile
  const byStage: Record<string, any[]> = {};
  for (const s of ONBOARDING_STAGES) byStage[s] = [];
  byStage.completed = [];
  for (const p of data.pipelines) {
    const k = p.status === "completed" ? "completed" : p.current_stage;
    (byStage[k] ?? byStage.first_meeting).push(p);
  }

  const total = data.pipelines.length;
  const completed = byStage.completed.length;
  const inProgress = total - completed;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client onboarding</h1>
          <p className="text-muted-foreground text-sm">
            11-stage pipeline from first meeting to first review.
          </p>
        </div>
        <Link
          href="/dashboard/investors/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> New onboarding
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Active pipelines" value={String(inProgress)} />
        <Kpi label="Completed (all-time)" value={String(completed)} tone="emerald" />
        <Kpi
          label="Average completion"
          value="—"
          sub="Computed once 5+ pipelines exit"
        />
      </div>

      {total === 0 ? (
        <div className="border rounded-lg bg-card p-12 text-center text-sm text-muted-foreground">
          <ClipboardCheck className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No onboarding pipelines yet.</div>
          <p className="mt-2 text-xs max-w-md mx-auto">
            Create a new investor or click <em>Start onboarding</em> on an existing investor to begin.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {ONBOARDING_STAGES.map((stage) => (
              <div key={stage} className="border rounded-lg bg-card p-3">
                <div className="text-xs font-medium flex items-center justify-between">
                  <span>{STAGE_LABELS[stage]}</span>
                  <span className="text-muted-foreground">{byStage[stage]?.length ?? 0}</span>
                </div>
                <div className="mt-3 space-y-2 min-h-[80px]">
                  {(byStage[stage] ?? []).length === 0 ? (
                    <div className="text-[10px] text-muted-foreground text-center py-6">—</div>
                  ) : (
                    (byStage[stage] ?? []).slice(0, 10).map((p) => (
                      <Link
                        key={p.id}
                        href={`/dashboard/onboarding/${p.id}`}
                        className="block border rounded p-2 text-xs hover:bg-accent/40"
                      >
                        <div className="font-medium truncate">{p.investor_name}</div>
                        <div className="mt-0.5 text-muted-foreground flex items-center gap-1.5">
                          <span className="font-mono text-[10px]">{p.investor_pan}</span>
                          <span>·</span>
                          <span>{formatRelative(p.updated_at)}</span>
                        </div>
                        {p.pending_documents && (p.pending_documents as string[]).length > 0 && (
                          <div className="mt-1 text-[10px] text-amber-600">
                            {(p.pending_documents as string[]).length} doc(s) pending
                          </div>
                        )}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>

          {byStage.completed.length > 0 && (
            <div className="border rounded-lg bg-card">
              <div className="border-b px-4 py-2.5 font-medium flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Completed onboardings ({byStage.completed.length})
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Investor</th>
                    <th className="text-left py-2 font-medium">RM</th>
                    <th className="text-left py-2 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {byStage.completed.slice(0, 50).map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/dashboard/onboarding/${p.id}`} className="font-medium hover:underline">
                          {p.investor_name}
                        </Link>
                      </td>
                      <td className="py-2 text-muted-foreground">{p.rm_name ?? "—"}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {p.actual_completion_at ?? formatRelative(p.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "emerald" }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone === "emerald" ? "text-emerald-600" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
