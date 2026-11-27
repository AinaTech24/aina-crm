/**
 * POST /api/employees/:id/email   body: { email }
 *
 * Add (or correct) the email address of a team member whose login was created with a username
 * (lib/auth/username-login.ts). The address becomes their `users.email`, so password reset and CRM
 * emails reach them; the username is kept in `users.login_username` and still signs them in.
 *
 * `settings.users`, a login of this firm, only an owner for another owner, and only username
 * logins: changing the address of an ordinary email login is not offered here. The address must be
 * unused on the whole platform (sign-in looks a person up by it) and have no pending invite
 * (accepting one would take this login over). It starts unverified, and open reset links are voided.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem, withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { maskEmail } from "@/lib/auth/admin-reset";
import { isUsernameLogin, loginLabel } from "@/lib/auth/username-login";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200)
    .refine((e) => !isUsernameLogin(e), "That is not an email address."),
});
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    const email = parse.data.email;

    // System context: "is this address taken?" has to look across every firm. Every read and write
    // of the person themselves still names this firm.
    const username = await withSystem(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}))`);
      const u = (await tx.execute(sql`
        SELECT email, login_username, roles FROM users
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
           AND NOT (roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])`)).rows[0] as
        | { email: string; login_username: string | null; roles: string[] | null }
        | undefined;
      if (!u) throw fail("Team member not found.", 404);
      if ((u.roles ?? []).includes("owner") && !session.roles.includes("owner")) throw fail("Only an owner can change another owner's email.", 403);
      if (!u.login_username && !isUsernameLogin(u.email)) throw fail("This team member already signs in with an email address.", 409);
      const taken = (await tx.execute(sql`SELECT 1 FROM users WHERE lower(email) = ${email} AND id <> ${id}::uuid LIMIT 1`)).rows.length;
      if (taken) throw fail("That email address already has a login.", 409);
      const invited = (await tx.execute(sql`
        SELECT 1 FROM user_invites WHERE lower(email) = ${email} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() LIMIT 1`)).rows.length;
      if (invited) throw fail("There is a pending invite for that address. Revoke it first.", 409);

      const name = u.login_username ?? loginLabel(u.email).toLowerCase();
      await tx.execute(sql`
        UPDATE users
           SET email = ${email}, login_username = ${name}, email_verified_at = NULL, updated_at = now()
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid`);
      await tx.execute(sql`UPDATE password_resets SET consumed_at = now() WHERE user_id = ${id}::uuid AND consumed_at IS NULL`);
      return name;
    });

    await withTenant(session.tenantId, async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.email_added",
        entityType: "user",
        entityId: id,
        after: { email: maskEmail(email), username },
        ...clientMetaFromHeaders(req.headers),
      } as never);
    });

    return NextResponse.json({ ok: true, username });
  } catch (err) {
    return handleApiError(err);
  }
}
