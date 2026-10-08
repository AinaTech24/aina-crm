import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/rta-submission — the physical route's "Submitted to RTA".
 *
 * Body: { rta, amcName?, centre?, ackNo, submittedOn, includes[], amount?, notes? }
 *
 * Records where and when the signed forms went in (leads.rta_submission; a
 * resubmission keeps the earlier ones in `history`), moves the journey to
 * "Submitted to RTA", and gives the submitter a "check RTA processing" task due
 * when the firm's RTA wait is over. The registrar's feed then settles it
 * (lib/blueprints/rta-route.ts) — or Ops marks Processed / Rejected by hand.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { loadEditableLead } from "@/lib/leads/access";
import { transitionTo } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

const RTA_WAIT_DAYS = 7;
const FROM_STAGES = ["rta_forms_ready", "rta_client_signed", "rta_rejected", "rta_submitted"];

const Body = z.object({
  rta: z.enum(["CAMS", "KFintech", "AMC"]),
  amcName: z.string().trim().max(200).optional(),
  centre: z.string().trim().max(200).optional(),
  ackNo: z.string().trim().min(1, "Enter the acknowledgement / inward no.").max(100),
  submittedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the submission date"),
  includes: z.array(z.enum(["lumpsum", "sip", "nach", "cheque"])).max(4).default([]),
  amount: z.number().nonnegative().max(1e12).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    const b = parse.data;
    if (b.rta === "AMC" && !b.amcName) return NextResponse.json({ error: "Which AMC was it submitted to?" }, { status: 400 });
    const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    if (b.submittedOn > todayIst) return NextResponse.json({ error: "The submission date can't be in the future." }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, id);
      const stage = ((await tx.execute(sql`
        SELECT current_stage_key FROM lead_blueprint_instances WHERE tenant_id = ${session.tenantId}::uuid AND lead_id = ${id}::uuid
      `)).rows[0] as { current_stage_key?: string } | undefined)?.current_stage_key;
      if (!stage || !FROM_STAGES.includes(stage)) {
        return { status: 409, error: "This client is not on the physical RTA route at a submission step." };
      }

      const prev = (lead as any).rtaSubmission as Record<string, any> | null;
      const { history: prevHistory, ...prevCurrent } = prev ?? {};
      const submission = {
        ...b,
        by: session.userId,
        at: new Date().toISOString(),
        history: [...(Array.isArray(prevHistory) ? prevHistory : []), ...(prev ? [prevCurrent] : [])],
      };
      await tx.execute(sql`
        UPDATE leads SET rta_submission = ${JSON.stringify(submission)}::jsonb, updated_at = now()
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
      `);

      const where = b.rta === "AMC" ? b.amcName : b.rta;
      if (stage !== "rta_submitted") {
        const t = await transitionTo(tx, session.tenantId, id, "rta_submitted", {
          actorUserId: session.userId,
          actorRoles: session.roles,
          remarks: `Submitted to ${where}${b.centre ? ` (${b.centre})` : ""} on ${b.submittedOn}, acknowledgement ${b.ackNo}.`,
        });
        if (!t.ok) return { status: 409, error: t.reason ?? "Couldn't move the journey to Submitted to RTA." };
      }

      // The follow-up: due when the RTA should have processed it.
      const investorId = (lead as any).convertedInvestorId as string | null;
      const due = new Date(`${b.submittedOn}T10:00:00+05:30`);
      due.setDate(due.getDate() + RTA_WAIT_DAYS);
      await tx.execute(sql`
        INSERT INTO tasks (tenant_id, title, description, type, priority, status, assignee_id, created_by_id,
                           subject_type, subject_id, related_investor_id, due_at, meta)
        VALUES (${session.tenantId}::uuid,
                ${`Check RTA processing — ${lead.name}`},
                ${`Forms submitted to ${where}${b.centre ? `, ${b.centre}` : ""} on ${b.submittedOn} (acknowledgement ${b.ackNo}). If the RTA feed has not shown it processed, follow up with the registrar.`},
                'follow_up', 'normal', 'open', ${session.userId}::uuid, ${session.userId}::uuid,
                ${investorId ? "investor" : "lead"}, ${(investorId ?? id)}::uuid, ${investorId}::uuid,
                ${due.toISOString()}::timestamptz,
                ${JSON.stringify({ rtaSubmission: { leadId: id, ackNo: b.ackNo } })}::jsonb)
      `);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.rta_submitted",
        entityType: "lead",
        entityId: id,
        after: { rta: b.rta, ackNo: b.ackNo, submittedOn: b.submittedOn, resubmission: !!prev } as any,
        ...clientMeta,
      });
      return { status: 200 };
    });

    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
