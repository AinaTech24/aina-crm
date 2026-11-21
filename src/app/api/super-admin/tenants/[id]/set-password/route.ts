import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/set-password   body: { userId, password }
 *
 * Platform-admin action (Aina Admin → firm → Team → "Set password"): give one
 * of the firm's team members a NEW password directly, for when the emailed
 * reset link cannot reach them (the firm's mail settings are broken, the inbox
 * is not theirs any more). Whatever password they had — or one AINA set here
 * earlier — is replaced; setting it again replaces it again.
 *
 * Setting it:
 *  - signs the user out of every device (sessions_invalid_after), as a reset does;
 *  - cancels every reset link still waiting for them, so an older emailed link
 *    can never put back a password after this one;
 *  - is audited as tenant.user_password_set — WHO set it for WHOM, never the
 *    password. The password is not stored anywhere but as its bcrypt hash.
 * Their two-factor sign-in, when on, still applies.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { maskEmail } from "@/lib/auth/admin-reset";
import { clearSessionRevocationCache } from "@/lib/auth/revocation";

export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.edit");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    }
    const { userId, password } = parse.data;
    if (!password.trim()) return NextResponse.json({ error: "The password cannot be only spaces." }, { status: 400 });

    const hash = await bcrypt.hash(password, 12);

    const done = await withPlatformAdmin(session.userId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, email, name, status, (two_fa_enabled IS TRUE) AS has_2fa
        FROM users
        WHERE tenant_id = ${tenantId}::uuid AND id = ${userId}::uuid AND deleted_at IS NULL
      `);
      const user = r.rows[0] as { id: string; email: string | null; name: string | null; status: string; has_2fa: boolean } | undefined;
      if (!user) return { error: "That team member is not in this firm.", status: 404 } as const;

      // Truncated to the second, like /api/auth/reset: every session issued
      // before now is dead, and nothing issued after is caught by it.
      await tx.execute(sql`
        UPDATE users
           SET password_hash = ${hash},
               sessions_invalid_after = date_trunc('second', now()),
               updated_at = now()
         WHERE id = ${user.id}::uuid
      `);
      const cancelled = await tx.execute(sql`
        UPDATE password_resets SET consumed_at = now(), updated_at = now()
         WHERE user_id = ${user.id}::uuid AND consumed_at IS NULL
        RETURNING id
      `);
      await recordAudit(tx, {
        tenantId: PLATFORM_TENANT_ID,
        actorUserId: session.userId,
        action: "tenant.user_password_set",
        entityType: "user",
        entityId: user.id,
        after: {
          tenantId,
          email: user.email ? maskEmail(user.email) : null,
          resetLinksCancelled: cancelled.rows.length,
        },
      });
      return { ok: true as const, loginStatus: user.status, has2fa: !!user.has_2fa };
    });

    if (!("ok" in done)) return NextResponse.json({ error: done.error }, { status: done.status });
    clearSessionRevocationCache(userId);
    return NextResponse.json({ ok: true, status: done.loginStatus, has2fa: done.has2fa });
  } catch (err) {
    return handleApiError(err);
  }
}
