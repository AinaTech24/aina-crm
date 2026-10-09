/**
 * POST /api/super-admin/step-up   Body: { code }
 *
 * Administrative re-authentication (migration 0244). A platform operator whose
 * current session is NOT MFA-verified — it came from a password reset, was
 * created before two-factor was enrolled, was re-issued, was downgraded by a
 * security change, or its verification is older than the operator window —
 * proves the second factor again with a TOTP (or one-time backup) code.
 *
 * The current session is REVOKED and a NEW session is issued, created by the
 * completed challenge (auth_method step_up_totp / step_up_backup_code), so a
 * session's MFA is only ever set when the session is created — never raised on
 * an existing row (the database refuses that).
 *
 * Audited: success (`auth.session.created`, method step_up_*) and failure
 * (`auth.2fa.failed`). Neither row records the code, a password or a token.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { attachSessionCookie } from "@/lib/auth/issue-session";
import { verifyTotp, decryptSecret } from "@/lib/auth/totp";
import { enforce } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(6).max(12) }).strict();

export async function POST(req: NextRequest) {
  try {
    const limited = enforce(req, "auth.stepup", { limit: 10, windowSec: 15 * 60 });
    if (limited) return limited;
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    if (!session.sid) return NextResponse.json({ error: "sign in again" }, { status: 401 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "code required" }, { status: 400 });

    const user = await withSystem(async (tx) => (await tx.execute(sql`
      SELECT id, tenant_id, branch_id, email, name, roles, status, permissions, two_fa_enabled, two_fa_secret, two_fa_backup_codes
        FROM users WHERE id = ${session.userId}::uuid LIMIT 1`)).rows[0] as any);
    if (!user || user.status !== "active") return NextResponse.json({ error: "account inactive" }, { status: 403 });
    if (!user.two_fa_enabled || !user.two_fa_secret) {
      return NextResponse.json({ error: "two-factor authentication is not enrolled for this operator — enrol it first" }, { status: 403 });
    }

    const code = parse.data.code;
    let method: "step_up_totp" | "step_up_backup_code" = "step_up_totp";
    let authed = verifyTotp(decryptSecret(user.two_fa_secret), code);
    if (!authed && Array.isArray(user.two_fa_backup_codes)) {
      const hashes: string[] = user.two_fa_backup_codes;
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(code, hashes[i])) {
          authed = true;
          method = "step_up_backup_code";
          await withSystem((tx) => tx.execute(sql`UPDATE users SET two_fa_backup_codes = ${JSON.stringify(hashes.filter((_, k) => k !== i))}::jsonb WHERE id = ${user.id}::uuid`));
          break;
        }
      }
    }
    if (!authed) {
      await withSystem((tx) => tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
        VALUES (${user.tenant_id}::uuid, ${user.id}::uuid, 'user', 'auth.2fa.failed', 'user', ${user.id}::uuid, ${JSON.stringify({ via: "step_up" })}::jsonb)`)).catch(() => {});
      return NextResponse.json({ error: "invalid code" }, { status: 401 });
    }

    // The old session ends; the new one is created by this challenge.
    await withSystem((tx) => tx.execute(sql`UPDATE user_sessions SET revoked_at = now(), updated_at = now() WHERE session_id = ${session.sid} AND user_id = ${user.id}::uuid AND revoked_at IS NULL`));
    const res = NextResponse.json({ ok: true, mfaVerified: true });
    return attachSessionCookie(res, {
      auth: method, userId: user.id, tenantId: user.tenant_id, branchId: user.branch_id, roles: user.roles,
      email: user.email, name: user.name, permissions: user.permissions,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
