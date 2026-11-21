import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/reset-password   body: { userId? }
 *
 * Platform-admin action: send a password-reset link to one of the firm's team
 * members (`userId`, from the firm page's Team list), or — with no userId — to
 * the firm's owner (else the oldest active user with an email). Same one-hour
 * emailed link as Forgot password (lib/auth/admin-reset.ts); the admin never
 * sees the link or the password, and setting it signs the user out everywhere.
 * Audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { createResetLink, maskEmail, resetBlocker, sendResetEmail } from "@/lib/auth/admin-reset";

export const dynamic = "force-dynamic";

const Body = z.object({ userId: z.string().uuid().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.edit");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const targetId = parse.data.userId ?? null;

    const built = await withPlatformAdmin(session.userId, async (tx) => {
      // A named team member of THIS firm; else the owner, else the oldest active user with an email.
      const userRows = targetId
        ? await tx.execute(sql`
            SELECT id, email, name, status
            FROM users
            WHERE tenant_id = ${tenantId}::uuid AND id = ${targetId}::uuid AND deleted_at IS NULL
          `)
        : await tx.execute(sql`
            SELECT id, email, name, status
            FROM users
            WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND email IS NOT NULL AND email <> ''
            ORDER BY (roles::text ILIKE '%owner%') DESC, created_at ASC
            LIMIT 1
          `);
      const user = (userRows.rows[0] as { id: string; email: string | null; name: string | null; status: string } | undefined) ?? null;
      if (!user) return { error: targetId ? "That team member is not in this firm." : "No active user with an email to reset for this tenant.", status: 404 } as const;
      const blocked = resetBlocker(user, "from the firm's Team Members page");
      if (blocked) return { error: blocked, status: 409 } as const;

      const email = String(user.email).toLowerCase();
      const resetUrl = await createResetLink(tx, { id: user.id, tenantId, email }, req, "aina-admin");
      await recordAudit(tx, {
        tenantId: PLATFORM_TENANT_ID,
        actorUserId: session.userId,
        action: "tenant.user_password_reset_sent",
        entityType: "user",
        entityId: user.id,
        after: { tenantId, email: maskEmail(email) },
      });
      return { resetUrl, email, name: user.name ?? null };
    });

    if ("error" in built) return NextResponse.json({ error: built.error }, { status: built.status });

    const sent = await sendResetEmail({ tenantId, email: built.email, name: built.name, resetUrl: built.resetUrl, by: "An administrator" });
    return NextResponse.json({
      ok: true,
      sentTo: maskEmail(built.email),
      emailSent: sent.sent,
      // Why the email did not go — Aina Admin only (it names the platform's mail problem).
      ...(sent.sent ? {} : { emailError: sent.detail ?? "The mail server did not accept the email." }),
      // Dev convenience only — never leak the live link in production.
      ...(process.env.NODE_ENV !== "production" ? { devResetUrl: built.resetUrl } : {}),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
