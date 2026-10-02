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

import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { investors } from "@/db/schema";
import { EntryInput } from "@/lib/business/entry-input";
import { insertBusinessEntry } from "@/lib/business/create-entry";
import { istToday } from "@/lib/dashboard/ops/params";
import { REQUEST_TYPE_BY_KEY, type RequestRow } from "./request-types";

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
