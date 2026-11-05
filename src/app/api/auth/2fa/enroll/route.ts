import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/2fa/enroll — set up two-factor sign-in AT SIGN-IN, for a
 * member of a firm that requires it (tenants.require_2fa) who has none yet.
 *
 *   { challenge }        → { otpauthUri, qrDataUrl, secret } — starts enrolment
 *   { challenge, code }  → verifies the first code, switches 2FA on, returns
 *                          the backup codes ONCE and sets the session cookie
 *
 * Pre-auth: the challenge from the password step (/api/auth/login, which
 * answered `enroll2fa`) is the credential. It is refused for anyone who
 * already has 2FA (they use /api/auth/2fa/verify) or whose firm does not
 * require it (they enrol from Settings → Security with a session).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { verify2faChallenge } from "@/lib/auth/jwt";
import { attachSessionCookie } from "@/lib/auth/issue-session";
import { decryptSecret, encryptSecret, generateBackupCodes, generateSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { recordAudit } from "@/lib/audit";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ challenge: z.string().min(10), code: z.string().min(6).max(10).optional() });

type Row = {
  id: string; tenant_id: string; branch_id: string | null; email: string; name: string; roles: string[];
  status: string; permissions: string[] | null; two_fa_enabled: boolean | null; two_fa_secret: string | null;
  require_2fa: boolean | null;
};

export async function POST(req: NextRequest) {
  try {
    const limited = enforce(req, "auth.2fa", { limit: 10, windowSec: 15 * 60 });
    if (limited) return limited;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "challenge required" }, { status: 400 });

    const claim = await verify2faChallenge(parse.data.challenge);
    if (!claim) return NextResponse.json({ error: "This sign-in has expired — sign in again." }, { status: 401 });

    const user = await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT u.id, u.tenant_id, u.branch_id, u.email, u.name, u.roles, u.status, u.permissions,
               u.two_fa_enabled, u.two_fa_secret, t.require_2fa
          FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE u.id = ${claim.userId} LIMIT 1`);
      return (r.rows[0] ?? null) as Row | null;
    });
    if (!user || user.two_fa_enabled || !user.require_2fa) {
      return NextResponse.json({ error: "invalid challenge" }, { status: 401 });
    }
    if (user.status !== "active") return NextResponse.json({ error: "account inactive" }, { status: 403 });

    // Step 1 — a fresh secret, stored encrypted and pending.
    if (!parse.data.code) {
      const secret = generateSecret();
      await withSystem((tx) =>
        tx.execute(sql`UPDATE users SET two_fa_secret = ${encryptSecret(secret)}, updated_at = now()
                        WHERE id = ${user.id} AND two_fa_enabled IS NOT TRUE`)
      );
      const uri = otpauthUri(secret, user.email || user.id);
      const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      return NextResponse.json({ otpauthUri: uri, qrDataUrl, secret });
    }

    // Step 2 — the first code proves the authenticator works.
    if (!user.two_fa_secret || !verifyTotp(decryptSecret(user.two_fa_secret), parse.data.code.trim())) {
      return NextResponse.json({ error: "That code didn't match. Check the time on your phone and try the next code." }, { status: 401 });
    }
    const backupCodes = generateBackupCodes(8);
    const hashed = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));
    await withSystem(async (tx) => {
      const changed = await tx.execute(sql`
        UPDATE users SET two_fa_enabled = true, two_fa_backup_codes = ${JSON.stringify(hashed)}::jsonb,
                         last_login_at = now(), updated_at = now()
         WHERE id = ${user.id} AND two_fa_enabled IS NOT TRUE AND two_fa_secret = ${user.two_fa_secret}
         RETURNING id`);
      if (!changed.rows.length) throw Object.assign(new Error("Enrolment changed — sign in again."), { status: 409 });
      await recordAudit(tx, {
        tenantId: user.tenant_id, actorUserId: user.id, action: "user.2fa_enabled",
        entityType: "user", entityId: user.id, before: { twoFaEnabled: false }, after: { twoFaEnabled: true, atSignIn: true },
      });
    });

    const res = NextResponse.json({ ok: true, backupCodes, user: { id: user.id, name: user.name, email: user.email, roles: user.roles } });
    return attachSessionCookie(res, {
      userId: user.id,
      tenantId: user.tenant_id,
      branchId: user.branch_id,
      roles: user.roles,
      email: user.email,
      name: user.name,
      permissions: user.permissions,
    } as Parameters<typeof attachSessionCookie>[1]);
  } catch (err) {
    return handleApiError(err);
  }
}
