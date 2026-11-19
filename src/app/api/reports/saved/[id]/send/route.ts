import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/reports/saved/[id]/send — email this report now (Zoho "Send Email").
 * Body: { emails?: string[], userIds?: string[], attach?: boolean } — if no
 * recipient is given, falls back to the report's saved schedule recipients. Recipients are INTERNAL staff (the firm's own team), so
 * delivery goes straight through the email adapter (same path as scheduled
 * delivery). No client-consent gate applies.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { savedReports } from "@/db/schema";
import { deliverReport, reportRecipients } from "@/lib/reports/deliver";
import { canSeeSavedReport } from "@/lib/reports/visibility";

export const dynamic = "force-dynamic";

const Body = z.object({
  emails: z.array(z.string().email()).max(50).optional(),
  userIds: z.array(z.string().uuid()).max(50).optional(),
  attach: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const picked = !!(parse.data.emails?.length || parse.data.userIds?.length);
    const found = await withTenant(session.tenantId, async (tx) => {
      const report = (
        await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId), isNull(savedReports.deletedAt))).limit(1)
      )[0];
      if (!report || !canSeeSavedReport(session, report)) return null;
      // deliverReport reads the schedule's recipients — graft the chosen ones on.
      const schedule = {
        freq: "daily" as const,
        hour: 0,
        enabled: true,
        ...(report.schedule ?? {}),
        emails: picked ? (parse.data.emails ?? []) : (report.schedule?.emails ?? []),
        userIds: picked ? (parse.data.userIds ?? []) : (report.schedule?.userIds ?? []),
        ...(parse.data.attach !== undefined ? { attach: parse.data.attach } : {}),
      };
      const emails = await reportRecipients(tx, { tenantId: report.tenantId, schedule });
      return { report: { ...report, schedule }, emails };
    });
    if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { report, emails } = found;
    if (!emails.length) {
      return NextResponse.json({ error: "No recipients. Pick team members or type emails, or set up a schedule first." }, { status: 400 });
    }

    const result = await deliverReport(report as any);

    await withTenant(session.tenantId, async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "report.send",
        entityType: "saved_report",
        entityId: id,
        after: { recipients: emails.length, sent: result.sent },
        ...clientMeta,
      });
    });

    if (result.sent === 0) {
      return NextResponse.json({ error: result.errors[0] ?? "delivery failed", sent: 0 }, { status: 502 });
    }
    return NextResponse.json({ sent: result.sent, errors: result.errors });
  } catch (err: any) {
    return handleApiError(err);
  }
}
