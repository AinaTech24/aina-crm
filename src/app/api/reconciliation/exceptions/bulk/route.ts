import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/reconciliation/exceptions/bulk
 *   Apply one action to many breaks at once.
 *     action = "status"  value = open|investigating|resolved|ignored
 *            = "sync"    → post opening-balance txns for every additive break
 *                          (feed > CRM) and resolve it; non-additive are skipped.
 *
 *   Either for `ids` (the rows ticked on the page), or — "Sync all to CRM" —
 *   for `all: true` + the page's `filter` (status / severity / type): every
 *   open or investigating additive break with a client that the filter shows,
 *   SYNC_BATCH per call. The response says how many are `remaining`, and the
 *   page calls again until none are, so a firm with thousands of breaks never
 *   holds one request open for minutes.
 *
 *   Every break goes through checkSyncable first: one the CRM already holds
 *   under another scheme code, or with no single folio, is `refused`, the
 *   reason written on it, and "Sync all" never picks it again.
 */

import { assertRtaWritesAllowed } from "@/lib/rta/write-guard";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reconciliationExceptions, transactions } from "@/db/schema";
import { RECON_TOLERANCE as TOLERANCE, SYNC_REFUSED, checkSyncable, syncableWhere } from "@/lib/reconciliation/syncable";

export const dynamic = "force-dynamic";

const SYNC_BATCH = 500;
const STATUSES = ["open", "investigating", "resolved", "ignored"] as const;

const Body = z.union([
  z.object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    action: z.enum(["status", "sync"]),
    value: z.enum(STATUSES).optional(),
  }),
  z.object({
    all: z.literal(true),
    action: z.literal("sync"),
    filter: z
      .object({
        status: z.array(z.string()).max(4).optional(),
        severity: z.array(z.string()).max(3).optional(),
        type: z.array(z.string()).max(4).optional(),
      })
      .default({}),
  }),
]);


export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;
    const action = body.action;
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        if (action === "sync") await assertRtaWritesAllowed(tx, session.tenantId, "bypass");
        // "Sync all": the next batch of syncable breaks the page's filter shows.
        const ids =
          "all" in body
            ? ((await tx.execute(sql`
                SELECT e.id FROM reconciliation_exceptions e
                 WHERE ${syncableWhere(session.tenantId, body.filter)}
                 ORDER BY (e.severity = 'high') DESC, ABS(COALESCE(e.delta_value, 0)) DESC
                 LIMIT ${SYNC_BATCH}
              `)).rows as Array<{ id: string }>).map((r) => r.id)
            : body.ids;
        if (!ids.length) return { updated: 0, skipped: 0, refused: 0, remaining: 0 };
        const scope = and(
          eq(reconciliationExceptions.tenantId, session.tenantId),
          inArray(reconciliationExceptions.id, ids)
        );

        if (action === "status" && !("all" in body)) {
          const value = body.value;
          if (!value) throw Object.assign(new Error("value required"), { status: 400 });
          const patch: any = { status: value, updatedAt: new Date() };
          if (value === "resolved") {
            patch.resolvedAt = new Date();
            patch.resolvedBy = session.userId;
          } else {
            patch.resolvedAt = null;
            patch.resolvedBy = null;
          }
          const updated = await tx.update(reconciliationExceptions).set(patch).where(scope).returning({ id: reconciliationExceptions.id });
          await recordAudit(tx, {
            tenantId: session.tenantId,
            actorUserId: session.userId,
            action: "reconciliation.exception.bulk_status",
            entityType: "reconciliation_exception",
            entityId: session.tenantId,
            after: { value, count: updated.length } as any,
            ...meta,
          });
          return { updated: updated.length, skipped: 0 };
        }

        // action === "sync": post an additive opening-balance txn per break.
        const exs = await tx.select().from(reconciliationExceptions).where(scope);
        const today = new Date().toISOString().slice(0, 10);
        let synced = 0;
        let skipped = 0;
        let refused = 0;
        for (const ex of exs) {
          const crmUnits = Number(ex.crmUnits ?? 0);
          const feedUnits = Number(ex.feedUnits ?? 0);
          const addUnits = Math.round((feedUnits - crmUnits) * 10000) / 10000;
          if (!ex.investorId || addUnits <= TOLERANCE) {
            skipped++;
            continue;
          }
          const check = await checkSyncable(tx, session.tenantId, ex);
          if (!check.ok) {
            await tx
              .update(reconciliationExceptions)
              .set({ notes: `${ex.notes ? ex.notes + " " : ""}${SYNC_REFUSED} ${check.reason}]`, updatedAt: new Date() } as any)
              .where(eq(reconciliationExceptions.id, ex.id));
            refused++;
            continue;
          }
          const feedValue = ex.feedValue != null ? Number(ex.feedValue) : null;
          const nav = feedUnits > 0 && feedValue != null ? feedValue / feedUnits : null;
          const amount = nav != null ? Math.round(addUnits * nav * 100) / 100 : null;
          await tx
            .insert(transactions)
            .values({
              tenantId: session.tenantId,
              investorId: ex.investorId,
              folioNumber: check.folioNumber,
              schemeCode: ex.schemeCode ?? null,
              schemeName: ex.schemeName ?? null,
              type: "purchase",
              direction: "inflow",
              status: "processed",
              units: String(addUnits) as any,
              nav: nav != null ? (String(Math.round(nav * 10000) / 10000) as any) : null,
              amount: amount != null ? (String(amount) as any) : null,
              orderDate: today as any,
              sourceFeed: "other",
              remarks: "Reconciliation sync — opening balance from RTA/CAS feed",
              executedByUserId: session.userId,
              dedupKey: `recon-sync:${ex.id}`,
            } as any)
            .onConflictDoNothing({ target: [transactions.tenantId, transactions.dedupKey] });
          await tx
            .update(reconciliationExceptions)
            .set({
              status: "resolved",
              resolvedAt: new Date(),
              resolvedBy: session.userId,
              notes: `${ex.notes ? ex.notes + " " : ""}[synced to CRM: +${addUnits} units]`,
              updatedAt: new Date(),
            } as any)
            .where(eq(reconciliationExceptions.id, ex.id));
          synced++;
        }
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "reconciliation.exception.bulk_sync",
          entityType: "reconciliation_exception",
          entityId: session.tenantId,
          after: { synced, skipped, refused, all: "all" in body } as any,
          ...meta,
        });
        const remaining =
          "all" in body
            ? Number(((await tx.execute(sql`
                SELECT COUNT(*)::int AS c FROM reconciliation_exceptions e
                 WHERE ${syncableWhere(session.tenantId, body.filter)}
              `)).rows[0] as any)?.c ?? 0)
            : 0;
        return { updated: synced, skipped, refused, remaining };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    return handleApiError(err);
  }
}
