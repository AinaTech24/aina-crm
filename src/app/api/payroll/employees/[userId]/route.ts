/**
 * PUT /api/payroll/employees/:userId — one person's payroll profile and, when
 * `salary` is sent, a new salary revision (a new row; history is never edited).
 *
 * PAN and bank account are encrypted at rest; a blank value keeps what is on
 * file, `null` clears it. The audit records WHAT changed, never the values.
 * Needs `payroll.manage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { employeeSalaries, payrollProfiles, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const opt = z.string().trim().max(60).optional();
const Body = z.object({
  profile: z
    .object({
      pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN looks wrong").or(z.literal("")).nullable().optional(),
      uan: opt,
      pfNumber: opt,
      esiNumber: opt,
      bankName: opt,
      bankAccount: z.string().trim().regex(/^\d{6,20}$/, "Bank account number should be 6–20 digits").or(z.literal("")).nullable().optional(),
      ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks wrong").or(z.literal("")).optional(),
      paymentMode: z.enum(["bank", "cheque", "cash"]).optional(),
      workState: z.string().trim().max(3).optional(),
      gender: z.enum(["male", "female", "other", ""]).optional(),
      pfEnabled: z.boolean().optional(),
      esiMode: z.enum(["auto", "off"]).optional(),
      exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).nullable().optional(),
      /** Pay before CRM payroll this financial year (TDS needs the whole year). */
      opening: z
        .object({
          fyStart: z.string().regex(/^\d{4}-04-01$/),
          taxableGross: z.number().min(0).max(100_000_000),
          tds: z.number().min(0).max(100_000_000),
        })
        .nullable()
        .optional(),
    })
    .optional(),
  salary: z
    .object({
      monthlyGross: z.number().min(0).max(10_000_000),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date the salary applies from"),
      basicOverride: z.number().min(0).nullable().optional(),
      hraOverride: z.number().min(0).nullable().optional(),
      note: z.string().trim().max(300).optional(),
    })
    .optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { userId } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
    const { profile, salary } = parse.data;

    await withTenant(session.tenantId, async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, session.tenantId), eq(users.id, userId)));
      if (!u) throw Object.assign(new Error("Team member not found"), { status: 404 });
      const changed: string[] = [];

      if (profile) {
        const set: Partial<typeof payrollProfiles.$inferInsert> = { updatedAt: new Date() };
        if (profile.pan !== undefined && profile.pan !== "") {
          set.panEnc = profile.pan ? encrypt(profile.pan) : null;
          set.panLast4 = profile.pan ? profile.pan.slice(-4) : null;
          changed.push("pan");
        }
        if (profile.bankAccount !== undefined && profile.bankAccount !== "") {
          set.bankAccountEnc = profile.bankAccount ? encrypt(profile.bankAccount) : null;
          set.bankAccountLast4 = profile.bankAccount ? profile.bankAccount.slice(-4) : null;
          changed.push("bank_account");
        }
        const plain = { uan: profile.uan, pfNumber: profile.pfNumber, esiNumber: profile.esiNumber, bankName: profile.bankName, ifsc: profile.ifsc, workState: profile.workState, gender: profile.gender };
        for (const [k, v] of Object.entries(plain)) {
          if (v !== undefined) { (set as Record<string, unknown>)[k] = v || null; changed.push(k); }
        }
        if (profile.paymentMode) { set.paymentMode = profile.paymentMode; changed.push("paymentMode"); }
        if (profile.pfEnabled !== undefined) { set.pfEnabled = profile.pfEnabled; changed.push("pfEnabled"); }
        if (profile.esiMode) { set.esiMode = profile.esiMode; changed.push("esiMode"); }
        if (profile.exitDate !== undefined) { set.exitDate = profile.exitDate || null; changed.push("exitDate"); }
        if (profile.opening !== undefined) {
          set.openingFyStart = profile.opening?.fyStart ?? null;
          set.openingTaxableGross = profile.opening ? String(profile.opening.taxableGross) : null;
          set.openingTds = profile.opening ? String(profile.opening.tds) : null;
          changed.push("opening");
        }

        const [existing] = await tx.select({ id: payrollProfiles.id }).from(payrollProfiles)
          .where(and(eq(payrollProfiles.tenantId, session.tenantId), eq(payrollProfiles.userId, userId)));
        if (existing) await tx.update(payrollProfiles).set(set).where(eq(payrollProfiles.id, existing.id));
        else await tx.insert(payrollProfiles).values({ tenantId: session.tenantId, userId, ...set });
      }

      if (salary) {
        await tx.insert(employeeSalaries).values({
          tenantId: session.tenantId,
          userId,
          effectiveFrom: salary.effectiveFrom,
          monthlyGross: String(salary.monthlyGross),
          basicOverride: salary.basicOverride != null ? String(salary.basicOverride) : null,
          hraOverride: salary.hraOverride != null ? String(salary.hraOverride) : null,
          note: salary.note || null,
          createdBy: session.userId,
        });
        changed.push("salary");
      }

      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.employee_updated",
        entityType: "user", entityId: userId, after: { fields: changed, salaryFrom: salary?.effectiveFrom ?? null },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
