import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/support/feedback/send
 *
 * Email the NPS survey to chosen clients, or to everyone in a client segment,
 * using the `feedback_nps` template. Its body carries {{link.feedback}}, so
 * dispatch() mints each client's own /f/<token> form (reusing a live unused
 * one, so a reminder never kills the link in the first mail).
 *
 * Body: { investorIds?: string[], segmentId?: string, dryRun?: boolean }
 *   exactly one of investorIds / segmentId.
 *   dryRun → counts only: how many will get it, how many have no email.
 *
 * Same shape as /api/risk-profiles/bulk-notify: one transaction per recipient
 * (one bad address never rolls back the rest), consent + compliance through
 * the pipeline, one audit row for the batch. The idempotency key is per client
 * per month, so a retried batch — or a second click — does not survey anyone
 * twice in a month.
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

const TEMPLATE_KEY = "feedback_nps";
const MAX_PER_CALL = 300;

const Body = z
  .object({
    investorIds: z.array(z.string().uuid()).min(1).max(2000).optional(),
    segmentId: z.string().uuid().optional(),
    dryRun: z.boolean().optional(),
  })
  .refine((b) => !!b.investorIds !== !!b.segmentId, { message: "Pick clients or a segment" });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    }
    const { investorIds, segmentId, dryRun } = parsed.data;
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);
    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };

    // ── Who gets it: active clients in scope, from the pick or the segment ──
    const audience = await withTenant(
      session.tenantId,
      async (tx) => {
        const pick = investorIds
          ? sql` AND i.id IN (${sql.join(investorIds.map((x) => sql`${x}::uuid`), sql`, `)})`
          : sql` AND i.id IN (
              SELECT m.subject_id FROM segment_memberships m
                JOIN segments s ON s.id = m.segment_id
               WHERE m.segment_id = ${segmentId}::uuid
                 AND s.tenant_id = ${session.tenantId}::uuid
                 AND s.subject_type = 'investor')`;
        // An RM surveys their own book; only someone who sees every client can
        // send to clients outside it.
        const rmScope = seesAll ? sql`` : sql` AND i.rm_id = ${session.userId}::uuid`;
        const rows = (await tx.execute(sql`
          SELECT i.id, i.name, i.email
            FROM investors i
           WHERE i.tenant_id = ${session.tenantId}::uuid
             AND i.status = 'active' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
             ${pick}${rmScope}
           ORDER BY i.name ASC
        `)).rows as Array<{ id: string; name: string; email: string | null }>;
        return rows.map((r) => ({ id: String(r.id), name: r.name ?? "", email: (r.email ?? "").trim() || null }));
      },
      ctx
    );

    const sendable = audience.filter((a) => a.email);
    const noEmail = audience.filter((a) => !a.email);

    if (dryRun) {
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

    // The template ships as a designer starter; installing is idempotent and
    // never overwrites a firm's own edits.
    await withTenant(session.tenantId, (tx) => installClientEmailTemplates(tx, session.tenantId, session.userId), ctx);

    const month = new Date().toISOString().slice(0, 7);
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
              // A utility template: it needs the client's transactional consent.
              category: "transactional",
              investorId: c.id,
              idempotencyKey: `nps:${c.id}:${month}`,
            }),
          ctx
        );
        // Consent / compliance skips come back as a "skipped" result, not a throw.
        if (res.status === "skipped") skipped++;
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
          action: "feedback.nps_survey_sent",
          entityType: segmentId ? "segment" : "investor",
          entityId: segmentId ?? null,
          after: { attempted: batch.length, sent, skipped, failed: failed.length, noEmail: noEmail.length },
          ...meta,
        }),
      ctx
    );

    return NextResponse.json({
      dryRun: false,
      attempted: batch.length,
      sent,
      skipped,
      failed,
      noEmail: noEmail.length,
      remaining: Math.max(0, sendable.length - batch.length),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
