import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/employees/invite
 * Body: { email, name, roles[], branchId? }
 *
 * Owner / branch_head invites a new team member. Generates a signed token,
 * stores its hash, and (TODO) emails the invite link. Returns the link in
 * the response so the owner can also share it manually.
 *
 *   GET /api/employees/invite       — list pending invites for this tenant
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import crypto from "node:crypto";
import { desc, eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { userInvites, tenants } from "@/db/schema";
import { require as requireCap, areAssignableRoles } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  roles: z.array(z.string()).min(1),
  branchId: z.string().uuid().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    // Pending invites expose invitee emails + roles-to-grant — admin-only.
    requireCap(session.roles, "settings.users");
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(userInvites)
        .where(and(eq(userInvites.tenantId, session.tenantId), isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt)))
        .orderBy(desc(userInvites.createdAt));
    });
    return NextResponse.json({ invites: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    // Only tenant-assignable roles may be granted — never a platform role.
    if (!areAssignableRoles(body.roles)) {
      return NextResponse.json({ error: "one or more roles are not assignable" }, { status: 400 });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    const firmName = await withTenant(session.tenantId, async (tx) => {
      await tx.insert(userInvites).values({
        id,
        tenantId: session.tenantId,
        email: body.email.toLowerCase(),
        name: body.name,
        rolesToGrant: body.roles,
        branchId: body.branchId ?? session.branchId,
        invitedByUserId: session.userId,
        tokenHash,
        expiresAt,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.invite",
        entityType: "user_invite",
        entityId: id,
        after: { email: body.email, roles: body.roles, branchId: body.branchId ?? session.branchId },
        ...clientMeta,
      });

      const t = (await tx.select({ displayName: tenants.displayName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      return t?.displayName ?? "your firm";
    });

    const inviteUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/accept-invite?token=${token}`;

    // Email the invite (best-effort — the link is still returned so the owner
    // can share it manually if email isn't configured).
    const emailRes = await sendSystemEmail({
      tenantId: session.tenantId,
      to: body.email,
      subject: `You're invited to join ${firmName} on AINA`,
      text:
        `${session.name} has invited you to join ${firmName}'s CRM workspace as ${body.roles.join(", ")}.\n\n` +
        `Accept your invite (valid for 7 days):\n${inviteUrl}`,
      html: actionEmailHtml({
        heading: `Join ${firmName} on AINA`,
        intro: `${session.name} has invited you to join ${firmName}'s workspace as ${body.roles.join(", ")}. This invite is valid for 7 days.`,
        buttonLabel: "Accept invite",
        buttonUrl: inviteUrl,
      }),
      idempotencyKey: `invite:${id}`,
    });

    return NextResponse.json({ id, inviteUrl, expiresAt, emailSent: emailRes.sent }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
