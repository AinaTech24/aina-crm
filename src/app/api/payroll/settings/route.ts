/**
 * PUT /api/payroll/settings — the firm's payroll settings (lib/payroll/settings.ts):
 * payable-days method, Basic and HRA shares, PF wage mode, default state, pay day.
 * Needs `payroll.manage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { PayrollSettingsSchema, readPayrollSettings } from "@/lib/payroll/settings";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const parse = PayrollSettingsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the settings" }, { status: 400 });
    await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx.select({ s: tenants.payrollSettings }).from(tenants).where(eq(tenants.id, session.tenantId));
      await tx.update(tenants).set({ payrollSettings: parse.data as Record<string, unknown>, updatedAt: new Date() }).where(eq(tenants.id, session.tenantId));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.settings",
        entityType: "tenant", entityId: session.tenantId, before: readPayrollSettings(t?.s), after: parse.data,
      });
    });
    return NextResponse.json({ ok: true, settings: parse.data });
  } catch (err) {
    return handleApiError(err);
  }
}
