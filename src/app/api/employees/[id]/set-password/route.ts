/**
 * POST /api/employees/:id/set-password   body: { password }
 *
 * The firm's admin sets a team member's password directly (Team Members →
 * Set password) — for when the reset email cannot reach them. Same rules as
 * the reset link: `settings.users`, an active login of this firm, not one's
 * own, and only an owner sets another owner's. Signs the member out
 * everywhere and voids open reset links; they are emailed a notice
 * (best-effort). The password is never logged; the change is audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { clearSessionRevocationCache } from "@/lib/auth/revocation";
import { maskEmail, sendPasswordChangedNotice, setPasswordDirect } from "@/lib/auth/admin-reset";
import { passwordProblem } from "@/lib/auth/password-gen";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(128) });
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (id === session.userId) {
      return NextResponse.json({ error: "To change your own password, use Settings → Profile." }, { status: 409 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const problem = passwordProblem(parse.data.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const out = await withTenant(session.tenantId, async (tx) => {
      const u = (await tx.execute(sql`
        SELECT id::text, name, email, status, roles FROM users
         WHERE tenant_id = ${session.tenantId}::uuid AND id = ${id}::uuid AND deleted_at IS NULL
           AND NOT (roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])`)).rows[0] as
        | { id: string; name: string | null; email: string | null; status: string; roles: string[] | null }
        | undefined;
      if (!u) throw fail("Team member not found.", 404);
      if ((u.roles ?? []).includes("owner") && !session.roles.includes("owner")) throw fail("Only an owner can set another owner's password.", 403);
      if (u.status !== "active") {
        throw fail(u.status === "invited" ? "This team member has not accepted their invite yet — resend the invite instead." : `This login is ${u.status}; reactivate it first.`, 409);
      }
      await setPasswordDirect(tx, u.id, parse.data.password);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "user.password_set_by_admin",
        entityType: "user",
        entityId: u.id,
        after: { email: u.email ? maskEmail(u.email) : null },
      });
      return { name: u.name, email: u.email?.toLowerCase() ?? null, id: u.id };
    });
    clearSessionRevocationCache(out.id);
    const noticed = out.email ? await sendPasswordChangedNotice({ tenantId: session.tenantId, email: out.email, name: out.name, by: "Your firm's admin" }).catch(() => false) : false;
    return NextResponse.json({ ok: true, noticeSent: noticed });
  } catch (err) {
    return handleApiError(err);
  }
}
