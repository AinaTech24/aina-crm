import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/risk-profiles/send-link
 *
 * The Risk Profiles bulk action: email clients their personal questionnaire
 * link. Two templates, chosen per client, never by the caller:
 *
 *   risk_profile_assigned  a category was SUGGESTED (Awaiting confirmation):
 *                          "here is what we suggested, confirm or change it"
 *   risk_profile_request   everyone else: "please complete your risk profile"
 *
 * Body: { investorIds?: string[], audience?: "not_profiled", dryRun?: boolean }
 *   exactly one of investorIds / audience.
 *   dryRun → who would get it, under which template, and who would not (no
 *            email, or already emailed a link in the last 14 days). Also returns
 *            the sendable ids, which the page posts back in small batches.
 *   send   → investorIds only, at most MAX_PER_CALL. The page batches, so no
 *            single request runs long enough to hit a proxy timeout.
 *
 * Eligibility is re-checked on every call, so a batch sent after a pause does
 * not mail someone who was emailed meanwhile. Each send is its own
 * transaction: one bounced address never rolls back the rest.
 *
 * The link: dispatch() fills {{link.risk_profile}} itself, reusing a live
 * unused token. A firm whose risk_profile_request row predates that token uses
 * {{risk_profile_link}} or {{share_link}} instead (the workflow-rule version),
 * so the same URL is passed under those names too. A firm template with no
 * client link at all (an old copy pointing at the firm's login page) is refused
 * up front rather than mailed to hundreds of clients.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { dispatch } from "@/lib/comms/pipeline";
import { loadClientLinkTokens } from "@/lib/comms/client-links";
import { installClientEmailTemplates } from "@/lib/templates/install-client-emails";
import { STARTER_TEMPLATES } from "@/lib/email-designer/starters";
import { riskBucketSql } from "@/lib/risk-profile/buckets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PER_CALL = 50;
const RECENT_DAYS = 14;
const TEMPLATE_KEYS = ["risk_profile_request", "risk_profile_assigned"] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];
/** Tokens that carry the client's personal link, in any version of the template. */
const LINK_TOKENS = ["link.risk_profile", "risk_profile_link", "share_link"];

const Body = z
  .object({
    investorIds: z.array(z.string().uuid()).min(1).max(5000).optional(),
    audience: z.literal("not_profiled").optional(),
    dryRun: z.boolean().optional(),
  })
  .refine((b) => !!b.investorIds !== !!b.audience, { message: "Pick clients or an audience" })
  .refine((b) => b.dryRun || !b.audience, { message: "Preview the audience first, then send by id" })
  .refine((b) => b.dryRun || (b.investorIds?.length ?? 0) <= MAX_PER_CALL, {
    message: `Send at most ${MAX_PER_CALL} clients per request`,
  });

type Recipient = { id: string; name: string; email: string | null; provisional: boolean; recent: boolean };
type TemplateInfo = { key: TemplateKey; name: string; subject: string | null; installed: boolean; problem: string | null };

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same gate as the per-row link and the provisional bulk mail.
    requireCap(session.roles, "risk_profile.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    }
    const { investorIds, audience, dryRun } = parsed.data;
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);
    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };

    const { recipients, templates } = await withTenant(
      session.tenantId,
      async (tx) => {
        const pick = investorIds
          ? sql` AND i.id IN (${sql.join(investorIds.map((x) => sql`${x}::uuid`), sql`, `)})`
          : sql` AND ${riskBucketSql("not_profiled")}`;
        // An RM mails their own book; only someone who sees every client can
        // mail outside it.
        const rmScope = seesAll ? sql`` : sql` AND i.rm_id = ${session.userId}::uuid`;
        // Plus the shared client data scope (branch / own book).
        const dataScope = await investorScopeSql(tx, session, "i");
        const rows = (await tx.execute(sql`
          SELECT i.id, i.name, i.email, i.risk_profile_provisional AS provisional,
                 EXISTS (
                   SELECT 1 FROM communications c
                    WHERE c.tenant_id = i.tenant_id AND c.investor_id = i.id AND c.channel = 'email'
                      AND c.template_key IN ('risk_profile_request', 'risk_profile_assigned')
                      AND c.status IN ('scheduled', 'queued', 'sent', 'delivered', 'read', 'replied')
                      AND c.created_at > now() - make_interval(days => ${RECENT_DAYS})
                 ) AS recent
            FROM investors i
           WHERE i.tenant_id = ${session.tenantId}::uuid
             AND i.status = 'active' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
             ${pick}${rmScope}
             AND ${dataScope}
           ORDER BY i.name ASC
        `)).rows as Array<{ id: string; name: string | null; email: string | null; provisional: boolean | null; recent: boolean | null }>;

        const tpl = (await tx.execute(sql`
          SELECT DISTINCT ON (t.key) t.key, t.name, t.status, v.body
            FROM templates t
            LEFT JOIN template_versions v ON v.id = t.current_version_id
           WHERE t.tenant_id = ${session.tenantId}::uuid AND t.channel = 'email'
             AND t.key IN ('risk_profile_request', 'risk_profile_assigned')
           ORDER BY t.key, (t.locale = 'en-IN') DESC
        `)).rows as Array<{ key: string; name: string | null; status: string | null; body: unknown }>;

        return {
          recipients: rows.map<Recipient>((r) => ({
            id: String(r.id),
            name: r.name ?? "",
            email: (r.email ?? "").trim() || null,
            provisional: r.provisional === true,
            recent: r.recent === true,
          })),
          templates: TEMPLATE_KEYS.map((key) => describeTemplate(key, tpl.find((t) => t.key === key))),
        };
      },
      ctx
    );

    const templateFor = (r: Recipient): TemplateInfo =>
      templates.find((t) => t.key === (r.provisional ? "risk_profile_assigned" : "risk_profile_request"))!;
    const noEmail = recipients.filter((r) => !r.email);
    const recent = recipients.filter((r) => r.email && r.recent);
    const eligible = recipients.filter((r) => r.email && !r.recent);
    const blocked = eligible.filter((r) => templateFor(r).problem);
    const sendable = eligible.filter((r) => !templateFor(r).problem);

    if (dryRun) {
      // Every template this audience maps to, even when no one under it can be
      // sent to right now: the dialog always names what would go out.
      const used = templates
        .map((t) => ({
          ...t,
          audience: recipients.filter((r) => templateFor(r).key === t.key).length,
          sending: sendable.filter((r) => templateFor(r).key === t.key).length,
          blocked: blocked.filter((r) => templateFor(r).key === t.key).length,
        }))
        .filter((t) => t.audience > 0);
      return NextResponse.json({
        dryRun: true,
        channel: "email",
        total: recipients.length,
        sendable: sendable.length,
        noEmail: noEmail.length,
        noEmailSample: noEmail.slice(0, 6).map((r) => r.name),
        recent: recent.length,
        recentDays: RECENT_DAYS,
        blocked: blocked.length,
        templates: used,
        ids: sendable.map((r) => r.id),
        batchSize: MAX_PER_CALL,
      });
    }

    // Starters ship as gallery entries; installing is idempotent and never
    // overwrites a firm's own edits.
    await withTenant(session.tenantId, (tx) => installClientEmailTemplates(tx, session.tenantId, session.userId), ctx);

    const day = new Date().toISOString().slice(0, 10);
    let sent = 0;
    let skipped = 0;
    const failed: Array<{ investorId: string; name: string; error: string }> = [];

    for (const c of sendable) {
      const templateKey = templateFor(c).key;
      try {
        const res = await withTenant(
          session.tenantId,
          async (tx) => {
            const links = await loadClientLinkTokens(tx, {
              tenantId: session.tenantId,
              subjectType: "investor",
              subjectId: c.id,
              want: { risk: false, suitability: false, riskLink: true, feedbackLink: false },
              createdBy: session.userId,
            });
            const url = links["link.risk_profile"];
            return dispatch(tx, {
              tenantId: session.tenantId,
              channel: "email",
              templateKey,
              recipient: c.email!,
              variables: { name: c.name, risk_profile_link: url, share_link: url },
              // A utility template: it needs the client's transactional consent.
              category: "transactional",
              investorId: c.id,
              // Per client per day: a retried batch or a double click dedupes at
              // the provider. The 14-day "recent" rule above stops a re-send.
              idempotencyKey: `risk-link:${c.id}:${day}`,
            });
          },
          ctx
        );
        // Consent / compliance skips come back as a "skipped" result, not a throw.
        if (res.status === "skipped") skipped++;
        else if (res.status === "failed") failed.push({ investorId: c.id, name: c.name, error: res.error ?? "send failed" });
        else sent++;
      } catch (e: unknown) {
        failed.push({ investorId: c.id, name: c.name, error: e instanceof Error ? e.message : "send failed" });
      }
    }

    await withTenant(
      session.tenantId,
      (tx) =>
        recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "risk_profile.bulk_send_link",
          entityType: "investor",
          entityId: null,
          after: {
            requested: recipients.length,
            attempted: sendable.length,
            sent,
            skipped,
            failed: failed.length,
            noEmail: noEmail.length,
            recent: recent.length,
            blocked: blocked.length,
          },
          ...meta,
        }),
      ctx
    );

    return NextResponse.json({
      dryRun: false,
      attempted: sendable.length,
      sent,
      skipped,
      failed,
      notSent: recipients.length - sendable.length,
    });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}

/** The firm's copy of a template if it has one, else the starter it will get. */
function describeTemplate(
  key: TemplateKey,
  row: { name: string | null; status: string | null; body: unknown } | undefined
): TemplateInfo {
  if (!row) {
    const starter = STARTER_TEMPLATES.find((s) => s.key === key);
    return { key, name: starter?.name ?? key, subject: starter?.body.subject ?? null, installed: false, problem: null };
  }
  const body = (row.body ?? null) as { subject?: unknown } | null;
  const bodyText = JSON.stringify(row.body ?? "");
  const name = row.name ?? key;
  let problem: string | null = null;
  if (row.status !== "approved") {
    problem = `"${name}" is not approved, so nothing can be sent with it. Approve it under Templates first.`;
  } else if (!LINK_TOKENS.some((t) => bodyText.includes(t))) {
    problem = `"${name}" has no client link in it, so clients would get an email with nothing to fill. Add {{link.risk_profile}} to its button under Templates.`;
  }
  return { key, name, subject: typeof body?.subject === "string" ? body.subject : null, installed: true, problem };
}
