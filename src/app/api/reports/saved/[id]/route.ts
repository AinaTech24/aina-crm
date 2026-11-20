import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single custom report.
 *   GET    /api/reports/saved/[id]
 *   PATCH  /api/reports/saved/[id]   — full update, { star: boolean } toggle, or { restore: true }
 *   DELETE /api/reports/saved/[id]   — to Recently deleted (30 days); ?permanent=1 from there
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { savedReports, REPORT_SUBJECTS, REPORT_TYPES, REPORT_SHARE_SCOPES } from "@/db/schema";
import { FilterASTSchema } from "@/lib/filter/ast";
import { assertValidReport } from "@/lib/reports/run";
import { assertValidCategories, type CategoryColumn } from "@/lib/reports/categories";
import { ChartOptionsSchema, ChartTypeSchema, MatrixSchema, ScheduleSchema, SummarySchema, categoryColumnsSchema } from "@/lib/reports/definition";
import { canSeeSavedReport } from "@/lib/reports/visibility";
import { zohoImportEnabled } from "@/lib/imports/zoho/access";

export const dynamic = "force-dynamic";

const UpdateBody = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).nullable().optional(),
  subject: z.enum(REPORT_SUBJECTS).optional(),
  reportType: z.enum(REPORT_TYPES).optional(),
  ast: FilterASTSchema.nullable().optional(),
  columns: z.array(z.string().max(80)).max(40).optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
  matrix: MatrixSchema.nullable().optional(),
  summary: SummarySchema.nullable().optional(),
  categories: categoryColumnsSchema.nullable().optional(),
  folder: z.string().max(80).nullable().optional(),
  chartType: ChartTypeSchema.optional(),
  chartOptions: ChartOptionsSchema.nullable().optional(),
  sharedScope: z.enum(REPORT_SHARE_SCOPES).optional(),
  schedule: ScheduleSchema.nullable().optional(),
  /** Star toggle — when present, ONLY the star is changed. */
  star: z.boolean().optional(),
  /** Bring a report back from Recently deleted. */
  restore: z.literal(true).optional(),
});

/** Only the creator edits, deletes or restores a report; the owner always may. */
function mayChange(session: { userId: string; roles: string[] }, row: { createdById: string | null }) {
  return !row.createdById || row.createdById === session.userId || session.roles.includes("owner");
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0]
    );
    if (!row || !canSeeSavedReport(session, row)) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      ...row,
      isMine: mayChange(session, row),
      starred: ((row.starredBy as string[] | null) ?? []).includes(session.userId),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = UpdateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;
    // Meetings / Business Entry line reports: only a firm with the Zoho import flag (We Care, 2026-11-19).
    if ((body.subject === "review_meeting" || body.subject === "business_line" || body.subject === "equity_brokerage" || body.subject === "equity_dmat" || body.subject === "new_client") && !(await zohoImportEnabled(session.tenantId, session.roles))) {
      return NextResponse.json({ error: "This report module is not available for this firm." }, { status: 403 });
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0];
      if (!before || !canSeeSavedReport(session, before)) return null;

      if (body.restore) {
        if (!mayChange(session, before)) throw Object.assign(new Error("only the report's creator can restore it"), { status: 403 });
        const r = await tx
          .update(savedReports)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId)))
          .returning();
        await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "report.restore", entityType: "saved_report", entityId: id, ...clientMeta });
        return r[0];
      }
      if (before.deletedAt) throw Object.assign(new Error("this report is in Recently deleted — restore it first"), { status: 409 });

      // Star toggle — anyone with reports.manage can favourite any visible report.
      if (typeof body.star === "boolean") {
        const set = new Set<string>((before.starredBy as string[] | null) ?? []);
        if (body.star) set.add(session.userId);
        else set.delete(session.userId);
        await tx
          .update(savedReports)
          .set({ starredBy: [...set] as any })
          .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId)));
        return { ...before, starredBy: [...set] };
      }

      // Full edit — restricted to the creator (owner always passes).
      if (!mayChange(session, before)) {
        throw Object.assign(new Error("only the report's creator can edit it"), { status: 403 });
      }

      // Validate the merged definition against the catalog before saving.
      const subject = body.subject ?? before.subject;
      const categories = body.categories !== undefined ? body.categories : (before.categories as CategoryColumn[] | null);
      const merged = {
        subject,
        reportType: body.reportType ?? before.reportType,
        columns: body.columns ?? (before.columns as string[] | null),
        sort: body.sort !== undefined ? body.sort : (before.sort as any),
        matrix: body.matrix !== undefined ? body.matrix : (before.matrix as any),
        summary: body.summary !== undefined ? body.summary : (before.summary as any),
        categories,
      };
      try {
        assertValidCategories(subject, categories);
        assertValidReport(merged as any);
      } catch (e: any) {
        throw Object.assign(new Error(e?.message ?? "invalid report definition"), { status: 400 });
      }

      const patch: any = { updatedAt: new Date() };
      for (const k of ["name", "description", "subject", "reportType", "ast", "columns", "sort", "matrix", "summary", "categories", "folder", "chartType", "chartOptions", "sharedScope", "schedule"] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const r = await tx.update(savedReports).set(patch).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "report.update",
        entityType: "saved_report",
        entityId: id,
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const permanent = new URL(req.url).searchParams.get("permanent") === "1";
    const clientMeta = clientMetaFromHeaders(req.headers);
    const ok = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0];
      if (!before || !canSeeSavedReport(session, before)) return false;
      if (!mayChange(session, before)) {
        throw Object.assign(new Error("only the report's creator can delete it"), { status: 403 });
      }
      if (permanent) {
        // Only from Recently deleted, so one click never erases a live report.
        if (!before.deletedAt) throw Object.assign(new Error("delete the report first; it can be erased from Recently deleted"), { status: 409 });
        await tx.delete(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId)));
      } else {
        await tx
          .update(savedReports)
          .set({ deletedAt: new Date() })
          .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId)));
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: permanent ? "report.purge" : "report.delete",
        entityType: "saved_report",
        entityId: id,
        before: { name: before.name },
        ...clientMeta,
      });
      return true;
    });
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
