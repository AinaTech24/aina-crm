/**
 * PUT /api/settings/firm-security { require2fa?: boolean, aiEnabled?: boolean }
 *
 * The firm's two DPDP safeguards (migration 0258), on Settings → Security:
 * - require2fa: everyone signs in with a second factor; someone without one
 *   sets it up at their next sign-in (/api/auth/2fa/enroll) and is sent to
 *   set it up now if already signed in (app/dashboard/layout.tsx).
 * - aiEnabled: off = none of the firm's data goes to the AI provider
 *   (lib/ai/firm-switch.ts); every AI feature says it is switched off.
 * Needs `settings.users`.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { forgetAiSwitch } from "@/lib/ai/firm-switch";

export const dynamic = "force-dynamic";

const Body = z.object({ require2fa: z.boolean().optional(), aiEnabled: z.boolean().optional() })
  .refine((b) => b.require2fa !== undefined || b.aiEnabled !== undefined, "Nothing to change");

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Nothing to change" }, { status: 400 });
    const b = parse.data;

    const out = await withTenant(session.tenantId, async (tx) => {
      // Requiring 2FA would lock the owner out of the settings that switch it
      // back off if they have none — set it up first.
      if (b.require2fa) {
        const me = (await tx.execute(sql`SELECT two_fa_enabled FROM users WHERE id = ${session.userId}::uuid`)).rows[0] as
          | { two_fa_enabled: boolean }
          | undefined;
        if (!me?.two_fa_enabled) {
          throw Object.assign(new Error("Turn on two-factor sign-in for your own account first (above), then require it for the firm."), { status: 409 });
        }
      }
      const [before] = await tx.select({ require2fa: tenants.require2fa, aiEnabled: tenants.aiEnabled }).from(tenants).where(eq(tenants.id, session.tenantId));
      const patch = { ...(b.require2fa !== undefined ? { require2fa: b.require2fa } : {}), ...(b.aiEnabled !== undefined ? { aiEnabled: b.aiEnabled } : {}) };
      await tx.update(tenants).set({ ...patch, updatedAt: new Date() }).where(eq(tenants.id, session.tenantId));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "settings.firm_security",
        entityType: "tenant", entityId: session.tenantId, before, after: patch,
      });
      return patch;
    });
    forgetAiSwitch(session.tenantId);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return handleApiError(err);
  }
}

