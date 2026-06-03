import { handleApiError } from "@/lib/api/error-handler";
/**
 * Investors collection.
 *
 *   GET  /api/investors?q=&segment=&page=&limit=  — list with search + filter
 *   POST /api/investors                            — create new investor
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { healthFields } from "@/lib/investors/health";
import { investors, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(200),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "invalid PAN"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  alternatePhone: z.string().optional(),
  whatsappPhone: z.string().optional(),
  dob: z.string().optional(),
  gender: z.enum(["M", "F", "O"]).optional(),
  occupation: z.string().optional(),
  incomeRange: z.string().optional(),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  investorCategory: z
    .enum(["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"])
    .default("individual"),
  rmId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  bseUccCode: z.string().optional(),
  nseCanCode: z.string().optional(),
  mandateStatus: z
    .enum(["none", "pending", "active", "expired", "rejected", "cancelled"])
    .optional(),
  mandateRefNo: z.string().optional(),
  status: z
    .enum(["active", "dormant", "inactive", "redemption_risk", "closed"])
    .default("active"),
  notes: z.string().optional(),
  address: z
    .object({
      line1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
    })
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Block roles with no investor visibility (e.g. marketing per spec § 3)
    const seesAll = can(session.roles, "investor.view.all");
    const seesAssigned = can(session.roles, "investor.view.assigned");
    if (!seesAll && !seesAssigned) {
      return NextResponse.json({ error: "forbidden: missing investor.view" }, { status: 403 });
    }

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const segment = url.searchParams.get("segment") ?? "";
    const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
    const offset = page * limit;

    const result = await withTenant(session.tenantId, async (tx) => {
      const conditions = [];
      // RMs see only their assigned investors
      if (!seesAll && seesAssigned) {
        conditions.push(eq(investors.rmId, session.userId));
      }
      if (q) {
        conditions.push(
          or(
            ilike(investors.name, `%${q}%`),
            ilike(investors.pan, `%${q.toUpperCase()}%`),
            ilike(investors.phone ?? sql`''`, `%${q}%`),
            ilike(investors.email ?? sql`''`, `%${q}%`)
          )!
        );
      }
      if (segment) {
        conditions.push(eq(investors.segmentTag, segment as any));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await tx
        .select()
        .from(investors)
        .where(where as any)
        .orderBy(desc(investors.updatedAt))
        .limit(limit)
        .offset(offset);

      const countRes = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(investors)
        .where(where as any);

      return { rows, total: Number(countRes[0]?.c ?? 0), page, limit };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const inserted = await tx
        .insert(investors)
        .values({
          id,
          tenantId: session.tenantId,
          branchId: session.branchId,
          name: body.name,
          pan: body.pan,
          email: body.email || null,
          phone: body.phone || null,
          whatsappPhone: body.whatsappPhone || null,
          dob: body.dob || null,
          segmentTag: body.segmentTag,
          investorCategory: body.investorCategory,
          rmId: body.rmId ?? session.userId,
          address: body.address,
          notes: body.notes,
          onboardedAt: new Date(),
          status: "active",
          // Deterministic initial health from the captured fields.
          ...healthFields({
            status: "active",
            kycStatus: "pending",
            riskProfile: null,
            riskProfileSignedAt: null,
          }),
        } as any)
        .returning();

      // Emit outbox event so subscribed workflows can react
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "investor.created",
        entityType: "investor",
        entityId: id,
        after: inserted[0] as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.create",
        entityType: "investor",
        entityId: id,
        after: { name: body.name, pan: body.pan, segmentTag: body.segmentTag },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("investors_tenant_pan_unique")) {
      return NextResponse.json({ error: "investor with this PAN already exists" }, { status: 409 });
    }
    return handleApiError(err);
  }
}
