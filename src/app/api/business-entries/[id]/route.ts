import { handleApiError } from "@/lib/api/error-handler";
/**
 *   GET    /api/business-entries/[id]   — header + scheme sub-form lines
 *   PATCH  /api/business-entries/[id]   — update header + (optionally) replace lines
 *   DELETE /api/business-entries/[id]   — delete (cascades lines)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, businessEntryLines } from "@/db/schema";
import {
  PRODUCT_TYPES,
  BUSINESS_ENTRY_STATUSES,
} from "@/db/schema/business_entries";
import { LineInput, normalizeLine, computeTotals } from "@/lib/business/entry-input";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const canManage = (roles: string[]) => roles.some((r) => MANAGE_ROLES.includes(r));

const PatchInput = z.object({
  investorId: z.string().uuid().nullish(),
  clientName: z.string().min(1).max(200).optional(),
  productType: z.enum(PRODUCT_TYPES).optional(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(BUSINESS_ENTRY_STATUSES).optional(),
  rmId: z.string().uuid().nullish(),
  amcName: z.string().max(150).nullish(),
  folioNo: z.string().max(60).nullish(),
  notes: z.string().max(4000).nullish(),
  lines: z.array(LineInput).min(1).max(100).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const data = await withTenant(session.tenantId, async (tx) => {
      const [entry] = await tx
        .select()
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!entry) return null;
      const lines = await tx
        .select()
        .from(businessEntryLines)
        .where(eq(businessEntryLines.entryId, id))
        .orderBy(asc(businessEntryLines.sortOrder));
      return { entry, lines };
    });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = PatchInput.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return "not_found" as const;

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (b.investorId !== undefined) set.investorId = b.investorId;
      if (b.clientName !== undefined) set.clientName = b.clientName;
      if (b.productType !== undefined) set.productType = b.productType;
      if (b.businessDate !== undefined) set.businessDate = b.businessDate;
      if (b.status !== undefined) set.status = b.status;
      if (b.rmId !== undefined) set.rmId = b.rmId;
      if (b.amcName !== undefined) set.amcName = b.amcName;
      if (b.folioNo !== undefined) set.folioNo = b.folioNo;
      if (b.notes !== undefined) set.notes = b.notes;

      // If a new line set is supplied, replace all lines + recompute totals.
      if (b.lines) {
        const lines = b.lines.map(normalizeLine);
        const totals = computeTotals(lines);
        set.totalAmount = String(totals.total);
        set.assetBreakup = totals.assetBreakup;
        set.liquidNet = String(totals.liquidNet);
        await tx.delete(businessEntryLines).where(eq(businessEntryLines.entryId, id));
        await tx.insert(businessEntryLines).values(
          lines.map((l, i) => ({
            id: uuid(),
            tenantId: session.tenantId,
            entryId: id,
            schemeCode: l.schemeCode ?? null,
            schemeName: l.schemeName,
            amcName: l.amcName ?? null,
            assetCategory: l.assetCategory ?? null,
            assetClass: l.assetClass,
            txnType: l.txnType,
            amount: String(l.amount),
            units: l.units != null ? String(l.units) : null,
            frequency: l.frequency ?? null,
            fromSchemeCode: l.fromSchemeCode ?? null,
            fromSchemeName: l.fromSchemeName ?? null,
            fromAssetClass: l.fromAssetClass ?? null,
            folioNo: l.folioNo ?? null,
            notes: l.notes ?? null,
            sortOrder: i,
          })) as any
        );
      }

      await tx.update(businessEntries).set(set as any).where(eq(businessEntries.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_entry.update",
        entityType: "business_entry",
        entityId: id,
        before: { status: before.status, total: before.totalAmount } as any,
        after: { ...b, lines: b.lines?.length } as any,
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const meta = clientMetaFromHeaders(req.headers);
    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select({ id: businessEntries.id, clientName: businessEntries.clientName })
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return "not_found" as const;
      await tx.delete(businessEntries).where(eq(businessEntries.id, id)); // lines cascade
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_entry.delete",
        entityType: "business_entry",
        entityId: id,
        before: { clientName: before.clientName } as any,
        ...meta,
      });
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
