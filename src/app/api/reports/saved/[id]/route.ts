import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single custom report.
 *   GET    /api/reports/saved/[id]
 *   PATCH  /api/reports/saved/[id]   — full update, or { star: boolean } toggle
 *   DELETE /api/reports/saved/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { savedReports, REPORT_SUBJECTS, REPORT_TYPES, REPORT_SHARE_SCOPES } from "@/db/schema";
import { FilterASTSchema } from "@/lib/filter/ast";
import { assertValidReport } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

const UpdateBody = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).nullable().optional(),
  subject: z.enum(REPORT_SUBJECTS).optional(),
  reportType: z.enum(REPORT_TYPES).optional(),
  ast: FilterASTSchema.nullable().optional(),
  columns: z.array(z.string().max(60)).max(40).optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
  matrix: z
    .object({ groupBy: z.string(), pivot: z.string().optional(), aggregate: z.enum(["count", "sum"]), measure: z.string().optional() })
    .nullable()
    .optional(),
  chartType: z.enum(["none", "bar", "pie", "line"]).optional(),
  sharedScope: z.enum(REPORT_SHARE_SCOPES).optional(),
  schedule: z
    .object({
      freq: z.enum(["daily", "weekly", "monthly"]),
      hour: z.number().int().min(0).max(23),
      day: z.number().int().min(0).max(31).optional(),
      emails: z.array(z.string().email()).max(20),
      enabled: z.boolean(),
    })
    .nullable()
    .optional(),
  /** Star toggle — when present, ONLY the star is changed. */
  star: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage");
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(savedReports).where(eq(savedReports.id, id)).limit(1))[0]
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = UpdateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(savedReports).where(eq(savedReports.id, id)).limit(1))[0];
      if (!before) return null;

      // Star toggle — anyone with reports.manage can favourite any visible report.
      if (typeof body.star === "boolean") {
        const set = new Set<string>((before.starredBy as string[] | null) ?? []);
        if (body.star) set.add(session.userId);
        else set.delete(session.userId);
        await tx
          .update(savedReports)
          .set({ starredBy: [...set] as any, updatedAt: new Date() })
          .where(eq(savedReports.id, id));
        return { ...before, starredBy: [...set] };
      }

      // Full edit — restricted to the creator (owner always passes via cap).
      const isOwnerRole = session.roles.includes("owner");
      if (before.createdById && before.createdById !== session.userId && !isOwnerRole) {
        throw Object.assign(new Error("only the report's creator can edit it"), { status: 403 });
      }

      // Validate the merged definition against the catalog before saving.
      const merged = {
        subject: body.subject ?? before.subject,
        reportType: body.reportType ?? before.reportType,
        columns: body.columns ?? (before.columns as string[] | null),
        sort: body.sort !== undefined ? body.sort : (before.sort as any),
        matrix: body.matrix !== undefined ? body.matrix : (before.matrix as any),
      };
      try {
        assertValidReport(merged as any);
      } catch (e: any) {
        throw Object.assign(new Error(e?.message ?? "invalid report definition"), { status: 400 });
      }

      const patch: any = { updatedAt: new Date() };
      for (const k of ["name", "description", "subject", "reportType", "ast", "columns", "sort", "matrix", "chartType", "sharedScope", "schedule"] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const r = await tx.update(savedReports).set(patch).where(eq(savedReports.id, id)).returning();
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
    requireCap(session.roles, "reports.manage");
    const clientMeta = clientMetaFromHeaders(req.headers);
    const ok = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(savedReports).where(eq(savedReports.id, id)).limit(1))[0];
      if (!before) return false;
      const isOwnerRole = session.roles.includes("owner");
      if (before.createdById && before.createdById !== session.userId && !isOwnerRole) {
        throw Object.assign(new Error("only the report's creator can delete it"), { status: 403 });
      }
      await tx.delete(savedReports).where(eq(savedReports.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "report.delete",
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
