import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/risk-profiles/bulk-notify
 *
 * Email the clients who carry a PROVISIONAL risk category: "here is the profile
 * we've suggested — confirm it or change it", with a personal questionnaire
 * link. The link is minted per recipient inside dispatch() because the
 * `risk_profile_assigned` template body references {{link.risk_profile}}.
 *
 * Body: { investorIds?: string[], dryRun?: boolean }
 *   investorIds → exactly these (what the bulk-assign dialog passes back).
 *   omitted     → every client currently holding a provisional profile.
 *
 * Each send is its own transaction, mirroring the campaign dispatcher: one
 * bounced address must not roll back the rest, and the external call must not
 * sit inside a long-held transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { dispatch } from "@/lib/comms/pipeline";
import { installClientEmailTemplates } from "@/lib/templates/install-client-emails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEMPLATE_KEY = "risk_profile_assigned";
const MAX_PER_CALL = 300;

const Body = z.object({
  investorIds: z.array(z.string().uuid()).max(2000).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);
    const ids = parsed.data.investorIds ?? null;

    // ── Who gets the mail (and who can't) ────────────────────────────────
    const audience = await withTenant(
      session.tenantId,
      async (tx) => {
        const idScope = ids && ids.length
          ? sql` AND i.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})`
          : sql``;
        const rmScope = seesAll ? sql`` : sql` AND i.rm_id = ${session.userId}::uuid`;
        const rows = (await tx.execute(sql`
          SELECT i.id, i.name, i.email
            FROM investors i
           WHERE i.tenant_id = ${session.tenantId}::uuid
             AND i.status = 'active' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
             AND i.risk_profile_provisional = true${idScope}${rmScope}
           ORDER BY i.name ASC
        `)).rows as Array<{ id: string; name: string; email: string | null }>;
        return rows.map((r) => ({ id: String(r.id), name: r.name ?? "", email: (r.email ?? "").trim() || null }));
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const sendable = audience.filter((a) => a.email);
    const noEmail = audience.filter((a) => !a.email);

    if (parsed.data.dryRun) {
      return NextResponse.json({
        dryRun: true,
        total: audience.length,
        sendable: sendable.length,
        noEmail: noEmail.length,
        noEmailSample: noEmail.slice(0, 8).map((a) => a.name),
        capped: sendable.length > MAX_PER_CALL,
        limit: MAX_PER_CALL,
      });
    }

    // The template ships as a designer starter; a firm created before it
    // existed has no row for it. Installing is idempotent and never overwrites
    // a firm's own edits.
    await withTenant(
      session.tenantId,
      (tx) => installClientEmailTemplates(tx, session.tenantId, session.userId),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    // ── Send, one transaction per recipient ──────────────────────────────
    const batch = sendable.slice(0, MAX_PER_CALL);
    let sent = 0;
    let skipped = 0;
    const failed: Array<{ investorId: string; name: string; error: string }> = [];

    for (const c of batch) {
      try {
        const res = await withTenant(
          session.tenantId,
          (tx) =>
            dispatch(tx, {
              tenantId: session.tenantId,
              channel: "email",
              templateKey: TEMPLATE_KEY,
              recipient: c.email!,
              variables: { name: c.name },
              category: "transactional",
              investorId: c.id,
              // Stable per (client, purpose): a retried batch re-sends the same
              // key, so the provider dedupes instead of mailing twice.
              idempotencyKey: `risk-provisional:${c.id}`,
            } as any),
          { userId: session.userId, branchId: session.branchId, roles: session.roles }
        );
        // dispatch records consent / compliance skips as communications rows
        // with a skipped_* status rather than throwing — count them honestly.
        if (String((res as any)?.status ?? "").startsWith("skipped")) skipped++;
        else sent++;
      } catch (e: any) {
        failed.push({ investorId: c.id, name: c.name, error: String(e?.message ?? "send failed") });
      }
    }

    await withTenant(
      session.tenantId,
      (tx) =>
        recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "risk_profile.bulk_notify_provisional",
          entityType: "investor",
          entityId: null,
          after: { attempted: batch.length, sent, skipped, failed: failed.length, noEmail: noEmail.length } as any,
          ...meta,
        }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({
      dryRun: false,
      attempted: batch.length,
      sent,
      skipped,
      failed,
      noEmail: noEmail.length,
      noEmailSample: noEmail.slice(0, 8).map((a) => a.name),
      remaining: Math.max(0, sendable.length - batch.length),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
