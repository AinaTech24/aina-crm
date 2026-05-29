import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { subscriptions, subscriptionEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  modulesOverride: z.array(z.string()).nullable(),
  allowedFields: z.array(z.string()).nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { modulesOverride, allowedFields } = parse.data;

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const sub = (
        await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1)
      )[0];
      if (!sub) throw Object.assign(new Error("subscription not found"), { status: 404 });

      const patch = {
        modulesOverride: modulesOverride,
        allowedFields: allowedFields,
        updatedAt: new Date(),
      };

      await tx.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        subscriptionId: sub.id,
        tenantId,
        eventType: "upgraded",
        actor: `aina_admin:${session.userId}`,
        notes: "AINA Platform Admin customized module & field overrides",
        meta: { modulesOverride, allowedFields } as any,
      } as any);

      return { ok: true };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
