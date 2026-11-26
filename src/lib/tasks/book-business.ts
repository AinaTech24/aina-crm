/**
 * A financial task books its business: when a task is created for a request
 * with a `business` mapping (lib/tasks/request-types) — a purchase, SIP,
 * switch, redemption… — the same scheme rows become a Business entry, one line
 * per row, so Operations never keys the transaction a second time.
 *
 * The entry is a DRAFT credited to the client's RM (the business is theirs,
 * whoever raised the task); lib/business/create-entry syncTaskBusinessEntry
 * confirms it when the task is completed and cancels it with the task.
 * SERVER-ONLY.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { investors } from "@/db/schema";
import { EntryInput } from "@/lib/business/entry-input";
import { insertBusinessEntry } from "@/lib/business/create-entry";
import { istToday } from "@/lib/dashboard/ops/params";
import { REQUEST_TYPE_BY_KEY, type RequestRow } from "./request-types";
import type { RequestLine } from "./request-lines";

/** Roles that may book business (the Business entries API's own rule). */
const BOOK_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
export const canBookBusiness = (roles: string[]) => roles.some((r) => BOOK_ROLES.includes(r));

const RECURRING = new Set(["sip", "stp", "swp"]);

export type BookOutcome =
  | { booked: true; entryId: string }
  | { booked: false; reason: "not_business" | "no_rows" | "no_client" | "not_allowed" };

export async function bookBusinessFromTask(
  tx: Tx,
  ctx: { tenantId: string; userId: string; roles: string[]; clientMeta?: Record<string, unknown> },
  t: { taskId: string; type: string; title: string; investorId: string | null | undefined; rows: RequestRow[] | undefined; mode?: string | null },
): Promise<BookOutcome> {
  const req = REQUEST_TYPE_BY_KEY[t.type];
  if (!req?.business) return { booked: false, reason: "not_business" };
  const rows = (t.rows ?? []).filter((r) => r.schemeName?.trim());
  if (!rows.length) return { booked: false, reason: "no_rows" };
  if (!t.investorId) return { booked: false, reason: "no_client" };
  if (!canBookBusiness(ctx.roles)) return { booked: false, reason: "not_allowed" };

  const [inv] = await tx
    .select({ id: investors.id, name: investors.name, rmId: investors.rmId })
    .from(investors)
    .where(and(eq(investors.id, t.investorId), eq(investors.tenantId, ctx.tenantId), isNull(investors.deletedAt)))
    .limit(1);
  if (!inv) return { booked: false, reason: "no_client" };

  const { txnType, productType } = req.business;
  const recurring = RECURRING.has(txnType);
  const input = EntryInput.parse({
    investorId: inv.id,
    clientName: inv.name,
    productType,
    businessDate: istToday(new Date()),
    status: "draft",
    rmId: inv.rmId ?? ctx.userId,
    amcName: rows.find((r) => r.amcName)?.amcName ?? null,
    folioNo: rows.find((r) => r.folio)?.folio ?? null,
    notes: [`Booked from task: ${t.title}`, t.mode ? `Mode: ${t.mode === "online" ? "Online" : "Offline"}` : null]
      .filter(Boolean)
      .join(" · "),
    lines: rows.map((r) => ({
      schemeCode: r.schemeCode ?? null,
      schemeName: r.schemeName.trim(),
      amcName: r.amcName ?? null,
      assetCategory: r.assetCategory ?? null,
      txnType,
      amount: r.amount ?? 0,
      units: r.units ?? null,
      frequency: recurring ? ((r.frequency as any) ?? "monthly") : "one_time",
      sipDate: recurring && r.sipDay ? r.sipDay : null,
      fromSchemeCode: r.fromSchemeCode ?? null,
      fromSchemeName: r.fromSchemeName ?? null,
      folioNo: r.folio ?? null,
      notes: r.allUnits ? "All units" : null,
    })),
  });
  const { entryId } = await insertBusinessEntry(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId, clientMeta: ctx.clientMeta },
    input,
    { registerSips: false, source: { taskId: t.taskId } },
  );
  return { booked: true, entryId };
}

/**
 * The request table (lib/tasks/request-lines): rows may be for different
 * family members and different requests. Each member's rows that book business
 * become ONE draft entry per product (mutual fund / PMS / AIF), every line
 * carrying its own transaction type — a SIP and a lumpsum for the same client
 * sit in one entry, as Operations would key them. Credited to each member's RM.
 */
export async function bookBusinessFromLines(
  tx: Tx,
  ctx: { tenantId: string; userId: string; roles: string[]; clientMeta?: Record<string, unknown> },
  t: { taskId: string; title: string; lines: RequestLine[] },
): Promise<{ entryIds: string[]; reason?: "not_allowed" }> {
  const rows = t.lines.filter((l) => REQUEST_TYPE_BY_KEY[l.requestKey]?.business && l.schemeName?.trim() && l.investorId);
  if (!rows.length) return { entryIds: [] };
  if (!canBookBusiness(ctx.roles)) return { entryIds: [], reason: "not_allowed" };

  const groups = new Map<string, RequestLine[]>();
  for (const l of rows) {
    const k = `${l.investorId}|${REQUEST_TYPE_BY_KEY[l.requestKey].business!.productType}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const ids = [...new Set(rows.map((l) => l.investorId))];
  const invs = await tx
    .select({ id: investors.id, name: investors.name, rmId: investors.rmId })
    .from(investors)
    .where(and(eq(investors.tenantId, ctx.tenantId), inArray(investors.id, ids), isNull(investors.deletedAt)));
  const byId = new Map(invs.map((i) => [i.id, i]));

  const entryIds: string[] = [];
  for (const [k, lines] of groups) {
    const [investorId, productType] = k.split("|") as [string, "mutual_fund" | "pms" | "aif"];
    const inv = byId.get(investorId);
    if (!inv) continue;
    const modes = [...new Set(lines.map((l) => l.mode).filter((m) => m === "online" || m === "offline"))];
    const input = EntryInput.parse({
      investorId: inv.id,
      clientName: inv.name,
      productType,
      businessDate: istToday(new Date()),
      status: "draft",
      rmId: inv.rmId ?? ctx.userId,
      amcName: lines.find((r) => r.amcName)?.amcName ?? null,
      folioNo: lines.find((r) => r.folio)?.folio ?? null,
      notes: [`Booked from task: ${t.title}`, modes.length === 1 ? `Mode: ${modes[0] === "online" ? "Online" : "Offline"}` : null]
        .filter(Boolean)
        .join(" · "),
      lines: lines.map((r) => {
        const { txnType } = REQUEST_TYPE_BY_KEY[r.requestKey].business!;
        const recurring = RECURRING.has(txnType);
        return {
          schemeCode: r.schemeCode ?? null,
          schemeName: r.schemeName!.trim(),
          amcName: r.amcName ?? null,
          assetCategory: r.assetCategory ?? null,
          txnType,
          amount: r.amount ?? 0,
          units: r.units ?? null,
          frequency: recurring ? (r.frequency ?? "monthly") : "one_time",
          sipDate: recurring && r.sipDay ? r.sipDay : null,
          fromSchemeCode: r.fromSchemeCode ?? null,
          fromSchemeName: r.fromSchemeName ?? null,
          folioNo: r.folio ?? null,
          notes: [r.allUnits ? "All units" : null, r.note ?? null].filter(Boolean).join(" · ") || null,
        };
      }),
    });
    const { entryId } = await insertBusinessEntry(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId, clientMeta: ctx.clientMeta },
      input,
      { registerSips: false, source: { taskId: t.taskId } },
    );
    entryIds.push(entryId);
  }
  return { entryIds };
}
