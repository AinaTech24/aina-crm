/**
 * Couriers — reads and writes. Every function runs inside the caller's
 * `withTenant` transaction and also names the tenant in its WHERE. The firm
 * switch and the permission are the caller's (lib/couriers/access.ts).
 */

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { db } from "@/db/client";
import { courierEntries, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  COURIER_LABELS, COURIER_PAGE_SIZE, CourierBody, isCourierFiltered, isUuid,
  type CourierField, type CourierFilter, type CourierInput, type CourierPatch, type CourierType,
} from "./entry";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { tenantId: string; userId: string };

export type CourierRow = Omit<CourierInput, "courierType"> & {
  id: string;
  courierType: CourierType;
  createdByName: string | null;
  createdAt: string;
};

const refuse = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** The courier's own fields, one column each. */
const fields = Object.fromEntries(
  (Object.keys(COURIER_LABELS) as CourierField[]).map((k) => [k, courierEntries[k]]),
) as { [K in CourierField]: (typeof courierEntries)[K] };

const columns = {
  id: courierEntries.id,
  ...fields,
  createdByName: users.name,
  createdAt: courierEntries.createdAt,
};

/** This firm's couriers that have not been deleted. */
const live = (tenantId: string) => [eq(courierEntries.tenantId, tenantId), isNull(courierEntries.deletedAt)];

/** `%` and `_` typed in the search box are text, not wildcards. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** What the list shows under a filter — and so what its Export file holds (lib/export/modules/couriers.ts). */
export function courierConditions(tenantId: string, f: CourierFilter): SQL[] {
  const where: SQL[] = live(tenantId);
  if (f.type) where.push(eq(courierEntries.courierType, f.type));
  if (f.statuses.length) where.push(inArray(courierEntries.status, f.statuses));
  if (f.categories.length) where.push(inArray(courierEntries.category, f.categories));
  if (f.from) where.push(gte(courierEntries.courierDate, f.from));
  if (f.to) where.push(lte(courierEntries.courierDate, f.to));
  if (f.company) where.push(ilike(courierEntries.courierCompany, like(f.company)));
  if (f.q) {
    const term = like(f.q);
    const any: SQL[] = [
      courierEntries.courierCompany, courierEntries.trackingNumber, courierEntries.categoryOther,
      courierEntries.description, courierEntries.remarks,
      courierEntries.senderName, courierEntries.senderCompany, courierEntries.senderMobile, courierEntries.senderEmail,
      courierEntries.recipientName, courierEntries.recipientCompany, courierEntries.recipientMobile, courierEntries.recipientEmail,
    ].map((column) => ilike(column, term));
    // A phone number matches however it was spaced when it was typed in.
    const digits = f.q.replace(/\D/g, "");
    if (digits.length >= 4 && /^[+0-9 ()-]+$/.test(f.q)) {
      const pattern = `%${digits}%`;
      for (const column of [courierEntries.senderMobile, courierEntries.recipientMobile]) {
        any.push(sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g') LIKE ${pattern}`);
      }
    }
    where.push(or(...any)!);
  }
  return where;
}

const toRow = (r: { createdAt: Date } & Record<string, unknown>): CourierRow =>
  ({ ...r, createdAt: r.createdAt.toISOString() }) as unknown as CourierRow;

export async function listCouriers(
  tx: Tx,
  tenantId: string,
  filter: CourierFilter,
): Promise<{ rows: CourierRow[]; total: number; page: number; totalPages: number; hasAny: boolean }> {
  const where = and(...courierConditions(tenantId, filter));
  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(courierEntries).where(where);
  const total = Number(count?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / COURIER_PAGE_SIZE));
  // A page past the end (the last row of it was just deleted) shows the last page.
  const page = Math.min(filter.page, totalPages);

  const rows = await tx
    .select(columns)
    .from(courierEntries)
    .leftJoin(users, eq(users.id, courierEntries.createdBy))
    .where(where)
    .orderBy(desc(courierEntries.courierDate), desc(courierEntries.createdAt), asc(courierEntries.id))
    .limit(COURIER_PAGE_SIZE)
    .offset((page - 1) * COURIER_PAGE_SIZE);

  let hasAny = total > 0;
  if (!hasAny && isCourierFiltered(filter)) {
    const some = await tx.select({ id: courierEntries.id }).from(courierEntries).where(and(...live(tenantId))).limit(1);
    hasAny = some.length > 0;
  }
  return { rows: rows.map(toRow), total, page, totalPages, hasAny };
}

export async function getCourier(tx: Tx, tenantId: string, id: string): Promise<CourierRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select(columns)
    .from(courierEntries)
    .leftJoin(users, eq(users.id, courierEntries.createdBy))
    .where(and(...live(tenantId), eq(courierEntries.id, id)))
    .limit(1);
  return row ? toRow(row) : null;
}

const audit = (tx: Tx, actor: Actor, action: string, id: string, c: Pick<CourierRow, "courierType" | "courierDate" | "trackingNumber">) =>
  recordAudit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action,
    entityType: "courier_entry",
    entityId: id,
    // Enough to identify the courier; names, contacts and addresses are not copied into the log.
    meta: { courierType: c.courierType, courierDate: c.courierDate, trackingNumber: c.trackingNumber },
  });

export async function createCourier(tx: Tx, actor: Actor, input: CourierInput): Promise<CourierRow> {
  const [created] = await tx
    .insert(courierEntries)
    .values({ ...input, tenantId: actor.tenantId, createdBy: actor.userId })
    .returning({ id: courierEntries.id });
  await audit(tx, actor, "courier.create", created.id, input);
  return (await getCourier(tx, actor.tenantId, created.id))!;
}

export async function updateCourier(tx: Tx, actor: Actor, id: string, patch: CourierPatch): Promise<CourierRow> {
  const current = await getCourier(tx, actor.tenantId, id);
  if (!current) throw refuse("Courier not found", 404);

  // The rules run across fields (status and details follow the type), so the whole courier is checked.
  const sent = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next = CourierBody.safeParse({ ...current, ...sent });
  if (!next.success) throw refuse(next.error.issues[0]?.message ?? "Invalid courier");

  await tx
    .update(courierEntries)
    .set({ ...next.data, updatedAt: new Date() })
    .where(and(...live(actor.tenantId), eq(courierEntries.id, id)));
  await audit(tx, actor, "courier.update", id, next.data);
  return (await getCourier(tx, actor.tenantId, id))!;
}

/** Soft delete: the courier leaves the list; the row stays for the record. */
export async function deleteCourier(tx: Tx, actor: Actor, id: string): Promise<void> {
  const current = await getCourier(tx, actor.tenantId, id);
  if (!current) throw refuse("Courier not found", 404);
  await tx
    .update(courierEntries)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(...live(actor.tenantId), eq(courierEntries.id, id)));
  await audit(tx, actor, "courier.delete", id, current);
}
