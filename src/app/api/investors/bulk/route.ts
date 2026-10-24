import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/bulk — apply one action to many clients at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"   value = rmId (uuid) | null      → reassign RM
 *   action = "purge"    ids OR scope:"trash"            → PERMANENT erase
 *          = "review"   value = ISO date string         → set next review date
 *          = "tier"     value = "A" | "B" | "C"          → set service tier
 *          = "segment"  value = segment tag              → set segment
 *          = "category" value = "A" | "B" | "C" | "D"    → set client category
 *          = "field"    field = a key of lib/investors/bulk-fields, value =
 *                       the new value (null clears)          → "Update a field"
 *
 * Tenant isolation is enforced by RLS (withTenant sets app.tenant_id) — we
 * scope by id only, exactly like the single-investor and leads/bulk routes.
 * Audited as a single bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { investors, users } from "@/db/schema";
import { setFamilyRmFromClient } from "@/lib/families/head-rm";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { purgeInvestorsChunk, PURGE_REQUEST_MAX, PURGE_TX_CHUNK } from "@/lib/investors/purge";
import { applyBulkField, BulkFieldError } from "@/lib/investors/bulk-update";
import { investorScopeCondition } from "@/lib/investors/access";
import { clientsHoldingMoney, holdersMessage, type MoneyHolder } from "@/lib/investors/holds-money";

export const dynamic = "force-dynamic";

const Body = z.object({
  // `ids` is optional for purge, which can instead target everything currently
  // in the Trash — a firm emptying 25,000 clients should not have to send
  // 25,000 ids the browser had to list first.
  ids: z.array(z.string().uuid()).max(20000).optional(),
  action: z.enum(["assign", "review", "tier", "segment", "category", "delete", "purge", "field"]),
  /** field only: which registry field to set (lib/investors/bulk-fields). */
  field: z.string().max(40).optional(),
  /** purge only: "trash" targets every soft-deleted client in the firm. */
  scope: z.literal("trash").optional(),
  value: z.string().nullable().optional(),
});

const TIERS = new Set(["A", "B", "C"]);
const SEGMENTS = new Set(["HNI", "Affluent", "Retail", "NRI", "Corporate"]);
const CATEGORIES = new Set(["A", "B", "C", "D"]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Bulk reassign/retier/segment the book is a privileged mutation — gate it
    // exactly like the single-investor PATCH (investor.edit.all) instead of
    // letting any authenticated session through.
    requireCap(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value, scope: bodyScope } = parsed.data;

    // Permanent erasure and soft-delete are far more dangerous than a re-tag, so
    // both are gated on the narrow delete capability rather than the broad
    // edit.all this route otherwise runs on. This MUST sit above the purge
    // branch below, which returns before reaching the later checks.
    if (action === "delete" || action === "purge") {
      requireCap(session.roles, "investor.delete", session.permissions);
    }

    if (action !== "purge" && (!ids || ids.length === 0)) {
      return NextResponse.json({ error: "ids required" }, { status: 400 });
    }

    // Data scope: only clients in the viewer's book (branch / own book) are
    // touched — edit.all is a capability, not a licence to act outside it.
    const inScope = async (tx: any, list: string[]): Promise<string[]> => {
      const dataScope = await investorScopeCondition(tx, session);
      if (!dataScope || list.length === 0) return list;
      const rows = await tx
        .select({ id: investors.id })
        .from(investors)
        .where(and(inArray(investors.id, list), dataScope));
      return rows.map((r: { id: string }) => r.id);
    };

    // ── Permanent erasure ────────────────────────────────────────────────
    // Bounded per request and chunked per transaction, so emptying a Trash of
    // any size is a handful of set-based statements per batch rather than one
    // request (and ~15 statements) per client.
    if (action === "purge") {
      const result = await withTenant(session.tenantId, async (tx) => {
        let targets: string[];
        if (bodyScope === "trash") {
          const dataScope = await investorScopeCondition(tx, session);
          const rows = await tx
            .select({ id: investors.id })
            .from(investors)
            .where(and(eq(investors.tenantId, session.tenantId), isNotNull(investors.deletedAt), dataScope))
            .limit(PURGE_REQUEST_MAX + 1);
          targets = rows.map((r) => r.id);
        } else {
          targets = await inScope(tx, (ids ?? []).slice(0, PURGE_REQUEST_MAX + 1));
        }

        // One more than the cap tells us work remains without a second count.
        const more = targets.length > PURGE_REQUEST_MAX;
        const batch = more ? targets.slice(0, PURGE_REQUEST_MAX) : targets;

        let purged = 0;
        for (let i = 0; i < batch.length; i += PURGE_TX_CHUNK) {
          purged += await purgeInvestorsChunk(tx, session.tenantId, batch.slice(i, i + PURGE_TX_CHUNK));
        }
        return { purged, more };
      });

      // `remaining` is "there is more to do", not an exact count — the caller
      // loops until it is false.
      return NextResponse.json({ ok: true, purged: result.purged, remaining: result.more });
    }

    const meta = clientMetaFromHeaders(req.headers);

    // ── "Update a field": any registry field, validated there ────────────
    if (action === "field") {
      if (!parsed.data.field) return NextResponse.json({ error: "field required" }, { status: 400 });
      try {
        const result = await withTenant(session.tenantId, async (tx) => {
          const visible = await inScope(tx, ids ?? []);
          if (visible.length === 0) throw new BulkFieldError("None of the selected clients are in your book.");
          const r = await applyBulkField(tx, { tenantId: session.tenantId, ids: visible, field: parsed.data.field!, value });
          await recordAudit(tx, {
            tenantId: session.tenantId,
            actorUserId: session.userId,
            action: "investor.bulk_field",
            entityType: "investor",
            entityId: session.tenantId,
            // Every client's previous value, so a mistaken mass update can be
            // traced and put back.
            before: { field: parsed.data.field, values: r.before },
            after: { field: parsed.data.field, value: r.value, count: r.updated, ids: ids ?? [] },
            ...meta,
          });
          return r;
        });
        return NextResponse.json({ ok: true, updated: result.updated });
      } catch (e) {
        if (e instanceof BulkFieldError) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
      }
    }

    const patch: Record<string, any> = { updatedAt: new Date() };
    switch (action) {
      case "assign":
        // Assigning to a stranger's uuid would orphan the clients under an RM
        // who can't see them — verify the target is a user in this firm.
        if (value && value.length > 0) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
            return NextResponse.json({ error: "assign value must be a user id" }, { status: 400 });
          }
          const exists = await withTenant(session.tenantId, async (tx) => {
            const [u] = await tx
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.id, value), eq(users.tenantId, session.tenantId)))
              .limit(1);
            return !!u;
          });
          if (!exists) return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
          patch.rmId = value;
        } else {
          patch.rmId = null;
        }
        break;
      case "review":
        if (!value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
        patch.nextReviewAt = new Date(value);
        break;
      case "tier":
        if (!value || !TIERS.has(value)) {
          return NextResponse.json({ error: "value must be A, B or C" }, { status: 400 });
        }
        patch.serviceTier = value;
        break;
      case "segment":
        if (!value || !SEGMENTS.has(value)) {
          return NextResponse.json({ error: "invalid segment" }, { status: 400 });
        }
        patch.segmentTag = value;
        break;
      case "category":
        if (!value || !CATEGORIES.has(value)) {
          return NextResponse.json({ error: "value must be A, B, C or D" }, { status: 400 });
        }
        patch.clientCategory = value;
        break;
      case "delete":
        // Soft delete → Trash bin (recoverable). Stamped in the tx below; the
        // owned-data subgraph is preserved until the retention window elapses,
        // when daily-ops permanently purges it.
        break;
    }

    let kept: MoneyHolder[] = [];
    const count = await withTenant(session.tenantId, async (tx) => {
      // A client who still holds money with the registrar is not deleted
      // (lib/investors/holds-money.ts) — the rest of the selection is.
      let targets = ids ?? [];
      if (action === "delete") {
        kept = await clientsHoldingMoney(tx, session.tenantId, await inScope(tx, targets));
        const keep = new Set(kept.map((k) => k.id));
        targets = targets.filter((id) => !keep.has(id));
      }
      // Tenant predicate (defense-in-depth) — a destructive bulk op must never
      // touch another firm's clients even if RLS is bypassed (superuser role).
      const scope = and(eq(investors.tenantId, session.tenantId), inArray(investors.id, targets), await investorScopeCondition(tx, session));
      let updated: { id: string }[];
      if (action === "delete") {
        // Soft delete into the Trash bin — preserves all related data.
        updated = await tx
          .update(investors)
          .set({ deletedAt: new Date(), deletedBy: session.userId, updatedAt: new Date() } as any)
          .where(scope)
          .returning({ id: investors.id });
      } else {
        updated = await tx.update(investors).set(patch as any).where(scope).returning({ id: investors.id });
      }
      // A family has one RM: assigning an RM to any member assigns it to the whole family.
      if (action === "assign" && patch.rmId) {
        for (const u of updated) {
          await setFamilyRmFromClient(tx, {
            tenantId: session.tenantId, investorId: u.id, rmId: patch.rmId, actorUserId: session.userId,
          });
        }
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `investor.bulk_${action}`,
        entityType: "investor",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, ids: targets, ...(kept.length ? { keptHoldingMoney: kept.map((k) => k.id) } : {}) } as any,
        ...meta,
      });
      return updated.length;
    });

    return NextResponse.json({
      ok: true,
      updated: count,
      ...(kept.length ? { kept: kept.map((k) => ({ id: k.id, name: k.name })), keptMessage: holdersMessage(kept) } : {}),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
