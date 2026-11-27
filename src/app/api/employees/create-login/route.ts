/**
 * POST /api/employees/create-login
 * Body: { name, username, password, roles[], phone?, branchId? }
 *
 * A team member without an email address (lib/auth/username-login.ts): the admin creates the login
 * at once with a username and password and hands both over — there is no invite to accept. Same
 * rules as inviting: `settings.users`, the plan's seat limit, assignable roles, a branch of this
 * firm; only an owner creates another owner. A username is unique across the whole platform,
 * because the sign-in screen does not ask for the firm. The password is never logged.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem, withTenant } from "@/db/client";
import { branches } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, areAssignableRoles } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { passwordProblem } from "@/lib/auth/password-gen";
import { loginLabel, usernameAddress, usernameProblem } from "@/lib/auth/username-login";
import { autoEnrol } from "@/lib/induction/engine";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(2, "Enter the person's name.").max(120),
  username: z.string().trim().min(1, "Enter a username.").max(60),
  password: z.string().min(1, "Enter a password.").max(128),
  roles: z.array(z.string()).min(1, "Pick at least one role."),
  phone: z.string().trim().max(20).optional(),
  branchId: z.string().uuid().optional(),
});

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    const b = parse.data;
    const problem = usernameProblem(b.username) ?? passwordProblem(b.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (!areAssignableRoles(b.roles)) return NextResponse.json({ error: "one or more roles are not assignable" }, { status: 400 });
    if (b.roles.includes("owner") && !session.roles.includes("owner")) {
      return NextResponse.json({ error: "Only an owner can create another owner." }, { status: 403 });
    }

    // The plan's seat limit, counted as the invite route counts it.
    const license = await loadTenantLicense(session.tenantId, session.roles);
    if (license.maxUsers && license.maxUsers < 1e9) {
      const used = await withTenant(session.tenantId, async (tx) => {
        const r = (await tx.execute(sql`
          SELECT (SELECT count(*) FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status <> 'suspended')
               + (SELECT count(*) FROM user_invites WHERE tenant_id = ${session.tenantId}::uuid AND accepted_at IS NULL AND revoked_at IS NULL) AS c
        `)).rows[0] as { c: string | number } | undefined;
        return Number(r?.c ?? 0);
      });
      if (used >= license.maxUsers) {
        return NextResponse.json(
          { error: `Your plan includes ${license.maxUsers} seats (${used} in use). Upgrade your plan to add more team members.` },
          { status: 402 },
        );
      }
    }

    const branchId = b.branchId ?? session.branchId ?? null;
    if (b.branchId) {
      const found = await withTenant(session.tenantId, (tx) =>
        tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, b.branchId!), eq(branches.tenantId, session.tenantId))).limit(1),
      );
      if (!found.length) return NextResponse.json({ error: "That branch doesn't belong to your firm." }, { status: 400 });
    }

    const address = usernameAddress(b.username);
    const username = loginLabel(address);
    const passwordHash = await bcrypt.hash(b.password, 12);
    const userId = uuid();
    const roles = sql`ARRAY[${sql.join(b.roles.map((r) => sql`${r}`), sql`, `)}]::text[]`;

    // System context: "is this username taken?" has to look across every firm. The lock stops two
    // requests taking the same one at the same moment.
    await withSystem(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${address}))`);
      const taken = (await tx.execute(sql`SELECT 1 FROM users WHERE lower(email) = ${address} OR lower(login_username) = ${username} LIMIT 1`)).rows.length;
      if (taken) throw fail("That username is already taken. Try another.", 409);
      await tx.execute(sql`
        INSERT INTO users (id, tenant_id, branch_id, email, login_username, name, phone, password_hash, roles, status,
                           email_verified_at, activated_at, created_at, updated_at)
        VALUES (${userId}::uuid, ${session.tenantId}::uuid, ${branchId}, ${address}, ${username}, ${b.name},
                ${b.phone || null}, ${passwordHash}, ${roles}, 'active', now(), now(), now(), now())
      `);
    });

    await withTenant(session.tenantId, async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.create_login",
        entityType: "user",
        entityId: userId,
        after: { name: b.name, username: b.username.toLowerCase(), roles: b.roles, branchId },
        ...clientMetaFromHeaders(req.headers),
      } as never);
    });

    // Induction training for the new joiner — never blocks creating the login.
    try {
      await withTenant(session.tenantId, (tx) => autoEnrol(tx, session.tenantId, userId, b.roles));
    } catch {
      /* an admin can enrol them by hand */
    }

    return NextResponse.json({ id: userId, username: b.username.toLowerCase() }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
