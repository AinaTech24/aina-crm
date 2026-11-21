/**
 * POST /api/employees/:id/reset-password — the firm's admin sends a team
 * member a password-reset link (Team Members → the key on the row).
 *
 * Needs `settings.users` (who already manages the firm's logins). The member
 * must be an active login of the same firm with an email; nobody resets their
 * own this way (Forgot password / Settings → Profile), and only an owner may
 * send one to another owner. The link is emailed to the member, valid one
 * hour; the admin never sees it or the password (lib/auth/admin-reset.ts).
 * Audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { createResetLink, maskEmail, resetBlocker, sendResetEmail } from "@/lib/auth/admin-reset";

export const dynamic = "force-dynamic";

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (id === session.userId) {
      return NextResponse.json({ error: "To change your own password, use Settings → Profile, or Forgot password on the sign-in page." }, { status: 409 });
    }

    const built = await withTenant(session.tenantId, async (tx) => {
      const u = (await tx.execute(sql`
        SELECT id::text, name, email, status, roles FROM users
         WHERE tenant_id = ${session.tenantId}::uuid AND id = ${id}::uuid AND deleted_at IS NULL
           AND NOT (roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])`)).rows[0] as
        | { id: string; name: string | null; email: string | null; status: string; roles: string[] | null }
        | undefined;
      if (!u) throw fail("Team member not found.", 404);
      if ((u.roles ?? []).includes("owner") && !session.roles.includes("owner")) {
        throw fail("Only an owner can send another owner a reset link.", 403);
      }
      const blocked = resetBlocker(u, "from this page");
      if (blocked) throw fail(blocked, 409);
      const email = u.email!.toLowerCase();
      const resetUrl = await createResetLink(tx, { id: u.id, tenantId: session.tenantId, email }, req, "firm-admin");
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "user.password_reset_sent",
        entityType: "user",
        entityId: u.id,
        after: { email: maskEmail(email) },
      });
      return { email, name: u.name, resetUrl };
    });

    const sent = await sendResetEmail({ tenantId: session.tenantId, email: built.email, name: built.name, resetUrl: built.resetUrl, by: "Your firm's admin" });
    return NextResponse.json({
      ok: true,
      sentTo: maskEmail(built.email),
      emailSent: sent,
      ...(process.env.NODE_ENV !== "production" ? { devResetUrl: built.resetUrl } : {}),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
