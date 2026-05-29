import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH /api/tenant
 * Body: partial tenant fields (owner-only).
 *
 * Allows the MFD owner to update their organisation profile — branding,
 * contact info, address, business profile. ARN/EUIN/GST/plan stay locked
 * to AINA (must be edited from the super-admin side).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { tenants } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  displayName: z.string().min(1).optional(),
  legalName: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().url().optional().or(z.literal("")),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  aumRange: z.string().optional(),
  sipBookRange: z.string().optional(),
  teamSize: z.string().optional(),
  currentSoftwareUsed: z.string().optional(),
  address: z
    .object({
      line1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  // Network FP "Firm Details" expansion (migration 0023)
  legalStructure: z
    .enum([
      "sole_proprietorship",
      "partnership",
      "llp",
      "private_limited",
      "public_limited",
      "huf",
      "one_person_company",
      "other",
    ])
    .nullable()
    .optional(),
  incorporationDate: z.string().nullable().optional(),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/i, "PAN format: ABCDE1234F")
    .nullable()
    .optional()
    .or(z.literal("")),
  tan: z
    .string()
    .regex(/^[A-Z]{4}\d{5}[A-Z]$/i, "TAN format: ABCD12345E")
    .nullable()
    .optional()
    .or(z.literal("")),
  gstNumber: z.string().max(20).nullable().optional().or(z.literal("")),
  nationalDistributorCode: z.string().max(40).nullable().optional(),
  primaryDin: z
    .string()
    .regex(/^\d{8}$/, "DIN format: 8 digits")
    .nullable()
    .optional()
    .or(z.literal("")),
  auditorName: z.string().max(200).nullable().optional(),
  auditorFrn: z.string().max(40).nullable().optional(),
  bankAccount: z
    .object({
      bankName: z.string().optional(),
      accountHolder: z.string().optional(),
      accountNumber: z.string().optional(),
      ifsc: z.string().optional(),
      branch: z.string().optional(),
      accountType: z.enum(["current", "savings", "od", "cc"]).optional(),
    })
    .nullable()
    .optional(),
  authorizedSignatory: z
    .object({
      name: z.string().optional(),
      designation: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      panNumber: z.string().optional(),
      din: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    // Org-profile edits are owner-only. settings.users is owner-only in
    // the matrix; we use that as the umbrella tenant-admin capability.
    requireCap(session.roles, "settings.users");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      const r = await tx
        .update(tenants)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(eq(tenants.id, session.tenantId))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "tenant.profile_update",
        entityType: "tenant",
        entityId: session.tenantId,
        before: before
          ? {
              displayName: before.displayName,
              email: before.email,
              phone: before.phone,
              logoUrl: before.logoUrl,
              primaryColor: before.primaryColor,
              aumRange: before.aumRange,
            }
          : null,
        after: parse.data,
        ...clientMeta,
      });

      return r[0];
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const result = await withTenant(session.tenantId, async (tx) => {
      const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      const license = await loadTenantLicense(session.tenantId, session.roles);
      return { tenant, license };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
