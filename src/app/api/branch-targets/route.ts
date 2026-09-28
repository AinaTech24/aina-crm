import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { annualTargets } from "@/db/schema";
import { currentFiscalYear } from "@/lib/business/sif-status";
import { BRANCH_TARGET_METRICS, BRANCH_TARGET_KEYS } from "@/lib/targets/branch-targets";

/**
 * Branch-level FY targets, stored in `annual_targets` at `scope_type='branch'`.
 *
 * The table has supported branch scope since it was created; nothing had ever
 * written one, so the branch scoreboard's target columns read "Not set" on
 * every row. This is the write path.
 */

/** Branches, the targetable metrics, and this FY's values. Owners only. */
export async function GET(req: Request) {
  const session = await requireSession();
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const qsFy = url.searchParams.get("fy");
  const fiscalYear = qsFy && /^\d{4}-\d{2}$/.test(qsFy) ? qsFy : currentFiscalYear();

  const data = await withTenant(session.tenantId, async (tx) => {
    const branches = await tx.execute(sql`
      SELECT id, name FROM branches ORDER BY name
    `);
    const targets = await tx.execute(sql`
      SELECT scope_id, metric_key, target_value
        FROM annual_targets
       WHERE fiscal_year = ${fiscalYear} AND scope_type = 'branch'
    `);
    return { branches: branches.rows as any[], targets: targets.rows as any[] };
  });

  const map: Record<string, Record<string, number>> = {};
  for (const t of data.targets) {
    if (!t.scope_id) continue;
    (map[String(t.scope_id)] ??= {})[String(t.metric_key)] = Number(t.target_value);
  }
  return NextResponse.json({
    fiscalYear,
    metrics: BRANCH_TARGET_METRICS,
    branches: data.branches,
    targets: map,
  });
}

/** Upsert one branch's FY target for one metric. Owners only. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const branchId = String(body.branchId ?? "");
  const metricKey = String(body.metricKey ?? "");
  const raw = body.targetValue;
  const fiscalYear = /^\d{4}-\d{2}$/.test(String(body.fiscalYear ?? ""))
    ? String(body.fiscalYear)
    : currentFiscalYear();

  if (!/^[0-9a-f-]{36}$/i.test(branchId)) {
    return NextResponse.json({ error: "Invalid branch" }, { status: 400 });
  }
  if (!BRANCH_TARGET_KEYS.has(metricKey)) {
    return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  }

  // An empty value CLEARS the target. That is different from setting zero: a
  // branch with no target has not missed it, and the scoreboard prints
  // "Not set" rather than a red 0%.
  const clearing = raw === "" || raw === null || raw === undefined;
  const targetValue = Number(raw);
  if (!clearing && (!Number.isFinite(targetValue) || targetValue < 0 || targetValue > 1e14)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  await withTenant(session.tenantId, async (tx) => {
    // `annual_targets` carries no unique constraint over
    // (tenant, metric, fy, scope_type, scope_id), so ON CONFLICT is not
    // available. Select-then-write, the same pattern sif-status.ts and
    // equity/service.ts already use for this table.
    const existing = await tx
      .select({ id: annualTargets.id })
      .from(annualTargets)
      .where(
        and(
          eq(annualTargets.metricKey, metricKey),
          eq(annualTargets.fiscalYear, fiscalYear),
          eq(annualTargets.scopeType, "branch"),
          eq(annualTargets.scopeId, branchId)
        )
      )
      .limit(1);

    if (clearing) {
      if (existing[0]) {
        await tx.delete(annualTargets).where(eq(annualTargets.id, existing[0].id));
      }
      return;
    }

    if (existing[0]) {
      await tx
        .update(annualTargets)
        .set({ targetValue: String(targetValue), updatedAt: new Date() })
        .where(eq(annualTargets.id, existing[0].id));
    } else {
      await tx.insert(annualTargets).values({
        tenantId: session.tenantId,
        metricKey,
        fiscalYear,
        scopeType: "branch",
        scopeId: branchId,
        targetValue: String(targetValue),
      });
    }
  });

  return NextResponse.json({ ok: true });
}
