import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { ChevronLeft, Target } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { getMonthAchievements, currentMonthBounds } from "@/lib/targets/achievement";
import { TargetsManager, type MemberTarget } from "./TargetsManager";
import { BranchTargetsManager } from "./BranchTargetsManager";
import { BRANCH_TARGET_METRICS } from "@/lib/targets/branch-targets";
import { currentFiscalYear } from "@/lib/business/sif-status";
import { sql } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";
import { INS_TARGETS } from "@/lib/dashboard/insurance/targets";
import { InsuranceTargetsManager } from "./InsuranceTargetsManager";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

export default async function TargetsSettingsPage() {
  const session = await requireSession();
  const manager = isManager(session.roles);
  const { startISO, endISO, label } = currentMonthBounds();

  const members = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        name: users.name,
        annualTarget: users.annualTarget,
        sipMonthlyTarget: users.sipMonthlyTarget,
        newMeetingsMonthlyTarget: users.newMeetingsMonthlyTarget,
        renewalMeetingsMonthlyTarget: users.renewalMeetingsMonthlyTarget,
      })
      .from(users)
      .where(
        and(
          eq(users.tenantId, session.tenantId),
          ne(users.status, "suspended"),
          manager ? undefined : eq(users.id, session.userId)
        )
      )
      .orderBy(asc(users.name));

    const ach = await getMonthAchievements(tx, session.tenantId, startISO, endISO);
    return rows.map<MemberTarget>((r) => ({
      id: r.id,
      name: r.name ?? "—",
      annualTarget: r.annualTarget != null ? Number(r.annualTarget) : null,
      sipMonthlyTarget: r.sipMonthlyTarget != null ? Number(r.sipMonthlyTarget) : null,
      newMeetingsMonthlyTarget: r.newMeetingsMonthlyTarget ?? null,
      renewalMeetingsMonthlyTarget: r.renewalMeetingsMonthlyTarget ?? null,
      achievedBusiness: ach.businessByRm[r.id] ?? 0,
      achievedNewMeetings: ach.newMeetingsByRm[r.id] ?? 0,
      achievedRenewalMeetings: ach.renewalMeetingsByRm[r.id] ?? 0,
    }));
  });

  // Branch-level FY targets. Only an owner sets these — a branch head setting
  // their own branch's target is marking their own homework.
  const fiscalYear = currentFiscalYear();
  const branchData = session.roles.includes("owner")
    ? await withTenant(session.tenantId, async (tx) => {
        const branches = await tx.execute(sql`SELECT id, name FROM branches ORDER BY name`);
        const targets = await tx.execute(sql`
          SELECT scope_id, metric_key, target_value
            FROM annual_targets
           WHERE fiscal_year = ${fiscalYear} AND scope_type = 'branch'
        `);
        const map: Record<string, Record<string, number>> = {};
        for (const t of targets.rows as any[]) {
          if (!t.scope_id) continue;
          (map[String(t.scope_id)] ??= {})[String(t.metric_key)] = Number(t.target_value);
        }
        return {
          branches: (branches.rows as any[]).map((b) => ({ id: String(b.id), name: String(b.name ?? "—") })),
          targets: map,
        };
      })
    : null;

  // Firm-level insurance targets (the Insurance Business Command Centre).
  // Firm policy, so settings.dashboard — owner, or an Insurance Head granted it.
  const insuranceTargets = can(session.roles, "settings.dashboard", session.permissions)
    ? await withTenant(session.tenantId, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT metric_key, target_value FROM annual_targets
           WHERE tenant_id = ${session.tenantId}::uuid AND fiscal_year = ${fiscalYear} AND scope_type = 'firm' AND scope_id IS NULL
             AND metric_key IN (${sql.join(INS_TARGETS.map((t) => sql`${t.key}`), sql`, `)})
        `);
        return Object.fromEntries((rows.rows as Array<{ metric_key: string; target_value: string }>).map((r) => [r.metric_key, Number(r.target_value)]));
      })
    : null;

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <PageHeaderCard title={<><Target className="size-5 text-brand-cyan" /> Targets &amp; quota</>} subtitle={<>Month-to-date: <span className="font-medium text-foreground">{label}</span></>} />

      <TargetsManager members={members} canEditAll={manager} selfId={session.userId} monthLabel={label} />

      {branchData && (
        <BranchTargetsManager
          branches={branchData.branches}
          metrics={BRANCH_TARGET_METRICS}
          initial={branchData.targets}
          fiscalYear={fiscalYear}
        />
      )}

      {insuranceTargets && (
        <InsuranceTargetsManager metrics={INS_TARGETS} initial={insuranceTargets} fiscalYear={fiscalYear} />
      )}
    </div>
  );
}
