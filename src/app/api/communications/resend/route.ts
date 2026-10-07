import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/communications/resend — send a client-action email again.
 *
 * Body: { communicationIds: string[] }  (max 200)
 *
 * Re-sends the SAME template to the SAME client, for the nudge list on the
 * follow-through page ("opened the link but never finished" / "never opened
 * it"). Deliberately narrow: it only re-sends the templates that ask the client
 * to do something, so this can never become a way to blast arbitrary mail.
 *
 * A fresh idempotency key per attempt — the original send used a stable key so
 * a retried batch would not double-send, and a deliberate reminder must not be
 * swallowed by that same guard. The compliance gate, consent check and
 * frequency cap all still run inside dispatch(); a reminder that trips the cap
 * is recorded as skipped, exactly like any other send.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { dispatch } from "@/lib/comms/pipeline";
import { ACTION_TEMPLATE_KEYS } from "@/lib/comms/follow-through";
import { commsScopeSql } from "@/lib/comms/inbox-scope";
import { dataWallApplies, investorScopeSql } from "@/lib/investors/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PER_CALL = 200;
const Body = z.object({ communicationIds: z.array(z.string().uuid()).min(1).max(MAX_PER_CALL) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["communication.send", "investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const ids = parsed.data.communicationIds;
    const meta = clientMetaFromHeaders(req.headers);

    // Resolve the originals, restricted to action templates and live clients.
    const targets = await withTenant(
      session.tenantId,
      async (tx) => {
        const keyList = sql.join(ACTION_TEMPLATE_KEYS.map((k) => sql`${k}`), sql`, `);
        const idList = sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `);
        // Under the data wall: only messages the caller may see, about a client
        // in their scope. Without it, any of these messages, as before.
        const wallOn = await dataWallApplies(tx, session);
        const scope = wallOn ? await commsScopeSql(tx, session, "c") : sql`TRUE`;
        const clientScope = !wallOn ? sql`TRUE`
          : can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "investor.view.assigned", session.permissions)
            ? await investorScopeSql(tx, session, "i") : sql`FALSE`;
        return (await tx.execute(sql`
          SELECT c.id, c.template_key, c.investor_id, i.name, i.email
            FROM communications c
            JOIN investors i ON i.id = c.investor_id
                            AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status = 'active'
           WHERE c.tenant_id = ${session.tenantId}::uuid
             AND c.id IN (${idList})
             AND c.template_key IN (${keyList})
             AND c.channel = 'email'
             AND ${scope} AND ${clientScope}
        `)).rows as Array<{ id: string; template_key: string; investor_id: string; name: string; email: string | null }>;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const stamp = Date.now();
    let sent = 0;
    let skipped = 0;
    const failed: Array<{ name: string; error: string }> = [];
    const noEmail = targets.filter((t) => !t.email?.trim()).map((t) => t.name);

    // One transaction per recipient — a bounce must not roll back the rest, and
    // the provider call must not sit inside a long-held transaction.
    for (const t of targets) {
      if (!t.email?.trim()) continue;
      try {
        const res = await withTenant(
          session.tenantId,
          (tx) =>
            dispatch(tx, {
              tenantId: session.tenantId,
              channel: "email",
              templateKey: t.template_key,
              recipient: t.email!.trim(),
              variables: { name: t.name },
              category: "transactional",
              investorId: String(t.investor_id),
              idempotencyKey: `resend:${t.id}:${stamp}`,
            } as any),
          { userId: session.userId, branchId: session.branchId, roles: session.roles }
        );
        if (String((res as any)?.status ?? "").startsWith("skipped")) skipped++;
        else sent++;
      } catch (e: any) {
        failed.push({ name: t.name, error: String(e?.message ?? "send failed") });
      }
    }

    await withTenant(
      session.tenantId,
      (tx) =>
        recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "communications.resend_action_email",
          entityType: "communication",
          entityId: null,
          after: { requested: ids.length, matched: targets.length, sent, skipped, failed: failed.length } as any,
          ...meta,
        }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({
      requested: ids.length,
      matched: targets.length,
      sent,
      skipped,
      failed,
      noEmail: noEmail.length,
      noEmailSample: noEmail.slice(0, 5),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
