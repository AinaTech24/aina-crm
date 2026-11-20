import { handleApiError } from "@/lib/api/error-handler";
/**
 * Custom reports collection.
 *   GET  /api/reports/saved            — reports visible to the caller
 *   GET  /api/reports/saved?deleted=1  — the caller's "Recently deleted" (30 days)
 *   POST /api/reports/saved            — create a report
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { savedReports, users, REPORT_SUBJECTS, REPORT_TYPES, REPORT_SHARE_SCOPES } from "@/db/schema";
import { FilterASTSchema } from "@/lib/filter/ast";
import { assertValidReport } from "@/lib/reports/run";
import { assertValidCategories } from "@/lib/reports/categories";
import { ChartOptionsSchema, ChartTypeSchema, MatrixSchema, ScheduleSchema, SummarySchema, categoryColumnsSchema } from "@/lib/reports/definition";
import { RECENTLY_DELETED_DAYS } from "@/lib/reports/trash";
import { zohoImportEnabled } from "@/lib/imports/zoho/access";

export const dynamic = "force-dynamic";

const ReportBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  subject: z.enum(REPORT_SUBJECTS),
  reportType: z.enum(REPORT_TYPES).default("detailed"),
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
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const deleted = new URL(req.url).searchParams.get("deleted") === "1";
    const isOwner = session.roles.includes("owner");
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({ report: savedReports, createdByName: users.name })
        .from(savedReports)
        .leftJoin(users, eq(users.id, savedReports.createdById))
        .where(
          deleted
            ? // Recently deleted: what the caller deleted (the owner sees every one), inside the window.
              and(
                isNotNull(savedReports.deletedAt),
                sql`${savedReports.deletedAt} > now() - make_interval(days => ${RECENTLY_DELETED_DAYS})`,
                isOwner ? sql`TRUE` : eq(savedReports.createdById, session.userId),
              )
            : and(
                isNull(savedReports.deletedAt),
                or(
                  eq(savedReports.createdById, session.userId),
                  // team/tenant-shared reports are visible to all (RLS already scopes
                  // to the tenant; finer branch scoping is a follow-on).
                  eq(savedReports.sharedScope, "tenant"),
                  eq(savedReports.sharedScope, "team"),
                  // The owner sees every report, as on GET [id].
                  isOwner ? sql`TRUE` : sql`FALSE`,
                ),
              ),
        )
        .orderBy(desc(savedReports.updatedAt))
        .limit(500)
    );
    // Per viewer: star, ownership, when they last opened it, whether it is scheduled.
    const reports = rows.map(({ report: r, createdByName }) => {
      const sched = r.schedule as { enabled?: boolean } | null;
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        subject: r.subject,
        reportType: r.reportType,
        sharedScope: r.sharedScope,
        folder: r.folder,
        updatedAt: r.updatedAt,
        deletedAt: r.deletedAt,
        createdByName: createdByName ?? null,
        starred: ((r.starredBy as string[] | null) ?? []).includes(session.userId),
        isMine: r.createdById === session.userId,
        viewedAt: ((r.viewedBy as Record<string, string> | null) ?? {})[session.userId] ?? null,
        scheduled: !!sched?.enabled,
      };
    });
    return NextResponse.json({ reports });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = ReportBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    // Meetings / Business Entry line reports: only a firm with the Zoho import flag (We Care, 2026-11-19).
    if ((body.subject === "review_meeting" || body.subject === "business_line" || body.subject === "equity_brokerage" || body.subject === "equity_dmat" || body.subject === "new_client") && !(await zohoImportEnabled(session.tenantId, session.roles))) {
      return NextResponse.json({ error: "This report module is not available for this firm." }, { status: 403 });
    }

    // Catalog validation — every referenced field must exist (no injection,
    // no broken reports). Throws a clean message the client can show.
    try {
      assertValidCategories(body.subject, body.categories);
      assertValidReport(body);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "invalid report definition" }, { status: 400 });
    }

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(savedReports).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        name: body.name,
        description: body.description ?? null,
        subject: body.subject,
        reportType: body.reportType,
        ast: (body.ast ?? null) as any,
        columns: body.columns ?? [],
        sort: body.sort ?? null,
        matrix: body.matrix ?? null,
        summary: body.summary ?? null,
        categories: (body.categories ?? null) as any,
        folder: body.folder ?? null,
        chartType: body.chartType ?? "none",
        chartOptions: body.chartOptions ?? null,
        sharedScope: body.sharedScope ?? "private",
        schedule: (body.schedule ?? null) as any,
        createdById: session.userId,
        starredBy: [],
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "report.create",
        entityType: "saved_report",
        entityId: id,
        after: { name: body.name, subject: body.subject, reportType: body.reportType },
        ...clientMeta,
      });
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
