import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/status
 * Body: { action: 'suspend' | 'activate' | 'extend' | 'cancel', reason?: string, extendDays?: number }
 *
 * Changes a tenant's subscription status. Every action is recorded in
 * subscription_events for audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform, type PlatformCapability } from "@/lib/auth/rbac";
import { subscriptions, subscriptionEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["suspend", "activate", "extend", "cancel"]),
  reason: z.string().optional(),
  extendDays: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action, reason, extendDays } = parse.data;

    // Match the action to a specific platform capability (the spec
    // distinguishes "Suspend license" vs "Activate license" etc.)
    const capForAction: Record<typeof action, PlatformCapability> = {
      suspend: "platform.tenant.suspend",
      activate: "platform.tenant.activate",
      extend: "platform.license.assign",
      cancel: "platform.tenant.suspend",
    };
    requirePlatform(session.roles, capForAction[action]);

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const sub = (
        await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1)
      )[0];
      if (!sub) throw Object.assign(new Error("subscription not found"), { status: 404 });

      const fromStatus = sub.status;
      const patch: any = { updatedAt: new Date() };
      let eventType: string = "";

      switch (action) {
        case "suspend":
          patch.status = "suspended";
          patch.suspendedAt = new Date();
          patch.suspendedReason = reason ?? "Suspended by AINA";
          eventType = "suspended";
          break;
        case "activate":
          patch.status = "active";
          patch.suspendedAt = null;
          patch.suspendedReason = null;
          patch.cancelledAt = null;
          patch.cancelledReason = null;
          eventType = "reactivated";
          break;
        case "extend": {
          if (!extendDays) throw new Error("extendDays required");
          const cur = sub.licenseEndAt ?? new Date();
          patch.licenseEndAt = new Date(new Date(cur).getTime() + extendDays * 24 * 60 * 60 * 1000);
          patch.nextRenewalAt = patch.licenseEndAt;
          eventType = "license_extended";
          break;
        }
        case "cancel":
          patch.status = "cancelled";
          patch.cancelledAt = new Date();
          patch.cancelledReason = reason ?? "Cancelled by AINA";
          eventType = "cancelled";
          break;
      }

      await tx.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        subscriptionId: sub.id,
        tenantId,
        eventType: eventType as any,
        actor: `aina_admin:${session.userId}`,
        fromStatus,
        toStatus: patch.status ?? fromStatus,
        notes: reason,
        meta: extendDays ? { extendDays } : undefined,
      } as any);

      return { ok: true, action, newStatus: patch.status ?? fromStatus };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
