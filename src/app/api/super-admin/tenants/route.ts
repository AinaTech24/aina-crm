import { handleApiError } from "@/lib/api/error-handler";
/**
 * AINA tenant management — create new MFD tenant + owner user + subscription
 * in one transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { packages, subscriptions, subscriptionEvents } from "@/db/schema";
import { MASTER_SEEDS } from "@/lib/masters/seeds";

export const dynamic = "force-dynamic";

const Body = z.object({
  firmName: z.string().min(2),
  arn: z.string().min(2),
  ownerName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),
  packageKey: z.string().min(2),
  billingCycle: z.enum(["monthly", "yearly", "custom"]).default("yearly"),
  trialDays: z.number().int().nonnegative().default(14),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.create");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const tenantId = uuid();
    const branchId = uuid();
    const userId = uuid();
    const subId = uuid();
    const passwordHash = await bcrypt.hash(body.ownerPassword, 12);
    const trialEnds = new Date(Date.now() + body.trialDays * 24 * 60 * 60 * 1000);

    await withPlatformAdmin(session.userId, async (tx) => {
      // Resolve package
      const pkg = (await tx.select().from(packages).where(eq(packages.key, body.packageKey)).limit(1))[0];
      if (!pkg) throw Object.assign(new Error(`unknown package: ${body.packageKey}`), { status: 400 });

      // Tenant
      await tx.execute(sql`
        INSERT INTO tenants (id, legal_name, display_name, arn, plan, status, trial_ends_at, created_at, updated_at)
        VALUES (${tenantId}, ${body.firmName}, ${body.firmName}, ${body.arn}, 'starter', 'trial', ${trialEnds}, now(), now())
      `);

      // Branch
      await tx.execute(sql`
        INSERT INTO branches (id, tenant_id, name, code, is_hq, created_at, updated_at)
        VALUES (${branchId}, ${tenantId}, 'Head Office', 'HQ', 'true', now(), now())
      `);

      // Owner user
      await tx.execute(sql`
        INSERT INTO users (id, tenant_id, branch_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at)
        VALUES (${userId}, ${tenantId}, ${branchId}, ${body.ownerEmail.toLowerCase()}, ${body.ownerName},
                ${passwordHash}, ARRAY['owner','rm','compliance']::text[], 'active', now(), now(), now())
      `);

      // Subscription
      await tx.insert(subscriptions).values({
        id: subId,
        tenantId,
        packageId: pkg.id,
        packageKey: pkg.key,
        status: "trial",
        billingCycle: body.billingCycle,
        licenseStartAt: new Date(),
        trialEndsAt: trialEnds,
      } as any);

      // Subscription event
      await tx.insert(subscriptionEvents).values({
        subscriptionId: subId,
        tenantId,
        eventType: "created",
        actor: `aina_admin:${session.userId}`,
        toStatus: "trial",
        toPackage: pkg.key,
        notes: "Tenant created by AINA",
      } as any);

      // Seed masters for this tenant
      for (const [masterType, rows] of Object.entries(MASTER_SEEDS)) {
        for (const r of rows) {
          await tx.execute(sql`
            INSERT INTO master_values (id, tenant_id, master_type, key, label, sort_order,
              is_active, is_system_default, meta, created_at, updated_at)
            VALUES (gen_random_uuid(), ${tenantId}, ${masterType}, ${r.key}, ${r.label},
              ${r.sortOrder ?? 0}, true, true,
              ${r.meta ? JSON.stringify(r.meta) : null}::jsonb, now(), now())
            ON CONFLICT (tenant_id, master_type, key) DO NOTHING
          `);
        }
      }

      // Audit (append-only): who provisioned this tenant + on what plan.
      await tx.insert(subscriptionEvents).values({
        subscriptionId: subId,
        tenantId,
        eventType: "created" as any,
        actor: `aina_admin:${session.userId}`,
        toStatus: "trial",
        notes: `Provisioned '${body.firmName}' (ARN ${body.arn}) on '${body.packageKey}' — ${body.trialDays}-day trial.`,
      } as any);
    });

    return NextResponse.json({ tenantId, userId, subscriptionId: subId }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("tenants_arn_unique")) {
      return NextResponse.json({ error: "ARN already registered" }, { status: 409 });
    }
    if (String(err?.message ?? "").includes("users_tenant_email_unique")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    console.error("[create-tenant]", err);
    return handleApiError(err);
  }
}
