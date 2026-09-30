/**
 * POST /api/insurance/targets — set or clear one firm-level FY insurance
 * target (annual_targets, scope 'firm') for the Insurance Business Command
 * Centre: total, Personal / Commercial Lines, new, renewal, new clients,
 * policies, corporate clients.
 *
 * Gated by settings.dashboard (owner through the hard-case in can(); grant it
 * to an Insurance Head who sets the vertical's targets). An empty value CLEARS
 * the target — "no target" and "a target of zero" are different statements.
 */

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { annualTargets } from "@/db/schema";
import { currentFiscalYear } from "@/lib/business/sif-status";
import { INS_TARGET_KEYS } from "@/lib/dashboard/insurance/targets";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!can(session.roles, "settings.dashboard", session.permissions)) {
    return NextResponse.json({ error: "You cannot set insurance targets." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const metricKey = String(body.metricKey ?? "");
  const fiscalYear = /^\d{4}-\d{2}$/.test(String(body.fiscalYear ?? "")) ? String(body.fiscalYear) : currentFiscalYear();
  if (!INS_TARGET_KEYS.has(metricKey)) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  const raw = body.targetValue;
  const clearing = raw === "" || raw === null || raw === undefined;
  const value = Number(raw);
  if (!clearing && (!Number.isFinite(value) || value < 0 || value > 1e14)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  await withTenant(session.tenantId, async (tx) => {
    // No unique constraint to upsert on (see api/branch-targets): select, then write.
    const [existing] = await tx
      .select({ id: annualTargets.id, v: annualTargets.targetValue })
      .from(annualTargets)
      .where(and(
        eq(annualTargets.tenantId, session.tenantId),
        eq(annualTargets.metricKey, metricKey),
        eq(annualTargets.fiscalYear, fiscalYear),
        eq(annualTargets.scopeType, "firm"),
        isNull(annualTargets.scopeId),
      ))
      .limit(1);
    let entityId = existing?.id ?? null;
    if (clearing) {
      if (!existing) return; // nothing was set, nothing changed — no audit row
      await tx.delete(annualTargets).where(eq(annualTargets.id, existing.id));
    } else if (existing) {
      if (Number(existing.v) === value) return;
      await tx.update(annualTargets).set({ targetValue: String(value), updatedAt: new Date() }).where(eq(annualTargets.id, existing.id));
    } else {
      const [row] = await tx.insert(annualTargets)
        .values({ tenantId: session.tenantId, metricKey, fiscalYear, scopeType: "firm", scopeId: null, targetValue: String(value) })
        .returning({ id: annualTargets.id });
      entityId = row?.id ?? null;
    }
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "insurance_target.set",
      entityType: "annual_target",
      entityId,
      before: existing ? { metricKey, fiscalYear, value: Number(existing.v) } : null,
      after: clearing ? null : { metricKey, fiscalYear, value },
      ...clientMetaFromHeaders(req.headers),
    });
  });
  return NextResponse.json({ ok: true });
}
