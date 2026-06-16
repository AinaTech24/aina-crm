import { handleApiError } from "@/lib/api/error-handler";
/**
 * Platform-admin tenant administration.
 *
 *   PATCH  /api/super-admin/tenants/[id]   — update the contact email
 *   DELETE /api/super-admin/tenants/[id]   — soft delete (deleted_at), guarded
 *           by a typed-ARN confirmation. Also cancels the live subscription.
 *
 * Soft (not hard) delete on purpose: domain `tenant_id` columns carry no FK to
 * tenants and domain tables have inter-table FKs, so a blind purge would orphan
 * or FK-fail. Soft delete hides the tenant + blocks its logins, and is
 * reversible (clear deleted_at).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { tenants, subscriptions, subscriptionEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  // A real email to set, or "" to clear it.
  email: z.union([z.string().email(), z.literal("")]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.edit");
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid email" }, { status: 400 });
    const email = parse.data.email.trim().toLowerCase();

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const t = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
      if (!t) throw Object.assign(new Error("tenant not found"), { status: 404 });
      await tx
        .update(tenants)
        .set({ email: email || null, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      return { ok: true, email: email || null };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Del = z.object({ confirmArn: z.string().min(1) });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.delete");
    const parse = Del.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "confirmArn required" }, { status: 400 });
    const confirmArn = parse.data.confirmArn.trim();

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const t = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
      if (!t) throw Object.assign(new Error("tenant not found"), { status: 404 });
      // Typed-confirmation guard: the ARN must match (case-insensitive).
      if (confirmArn.toLowerCase() !== (t.arn ?? "").toLowerCase()) {
        throw Object.assign(new Error("ARN confirmation does not match"), { status: 400 });
      }
      if ((t as any).deletedAt) return { ok: true, alreadyDeleted: true };

      // Soft delete AND free the ARN (suffix it) so the same ARN can be used to
      // create a fresh tenant later — the unique index would otherwise keep it
      // reserved forever by the hidden row.
      await tx.execute(sql`
        UPDATE tenants
        SET deleted_at = now(),
            deleted_by = ${session.userId}::uuid,
            arn = arn || '_deleted_' || to_char(now(), 'YYYYMMDDHH24MISS'),
            updated_at = now()
        WHERE id = ${tenantId}::uuid
      `);

      // Cancel the live subscription too, so billing/cron stop touching it.
      const sub = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1))[0];
      if (sub && sub.status !== "cancelled") {
        const fromStatus = sub.status;
        await tx
          .update(subscriptions)
          .set({ status: "cancelled", cancelledAt: new Date(), cancelledReason: "Tenant deleted by AINA", updatedAt: new Date() } as any)
          .where(eq(subscriptions.id, sub.id));
        await tx.insert(subscriptionEvents).values({
          subscriptionId: sub.id,
          tenantId,
          eventType: "cancelled" as any,
          actor: `aina_admin:${session.userId}`,
          fromStatus,
          toStatus: "cancelled",
          notes: "Tenant deleted (soft) by AINA",
        } as any);
      }
      return { ok: true };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
