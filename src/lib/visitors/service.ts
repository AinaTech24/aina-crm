/**
 * Visitor Register — reads and writes. Every function runs inside the caller's
 * `withTenant` transaction and also names the tenant in its WHERE. The firm
 * switch and the permission are the caller's (lib/visitors/access.ts).
 */

import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db } from "@/db/client";
import { users, visitorEntries } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  EXIT_BEFORE_ENTRY, VISITOR_PAGE_SIZE, exitBeforeEntry, toHhMm,
  type VisitorFilter, type VisitorInput, type VisitorPatch,
} from "./entry";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { tenantId: string; userId: string };

export type VisitorRow = {
  id: string;
  visitorName: string;
  email: string | null;
  mobile: string | null;
  companyName: string | null;
  visitDate: string;
  entryTime: string | null;
  exitTime: string | null;
  purpose: string | null;
  meetingWithUserId: string | null;
  meetingWithName: string | null;
  remarks: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type MeetingUser = { id: string; name: string };

const refuse = (message: string, status = 400) => Object.assign(new Error(message), { status });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const meetingWith = alias(users, "meeting_with");
const recordedBy = alias(users, "recorded_by");

const columns = {
  id: visitorEntries.id,
  visitorName: visitorEntries.visitorName,
  email: visitorEntries.email,
  mobile: visitorEntries.mobile,
  companyName: visitorEntries.companyName,
  visitDate: visitorEntries.visitDate,
  entryTime: visitorEntries.entryTime,
  exitTime: visitorEntries.exitTime,
  purpose: visitorEntries.purpose,
  meetingWithUserId: visitorEntries.meetingWithUserId,
  meetingWithName: meetingWith.name,
  remarks: visitorEntries.remarks,
  createdByName: recordedBy.name,
  createdAt: visitorEntries.createdAt,
};

type Selected = Omit<VisitorRow, "createdAt"> & { createdAt: Date };

const toRow = (r: Selected): VisitorRow => ({
  ...r,
  entryTime: r.entryTime ? toHhMm(r.entryTime) : null,
  exitTime: r.exitTime ? toHhMm(r.exitTime) : null,
  createdAt: r.createdAt.toISOString(),
});

/** This firm's visits that have not been deleted. */
const live = (tenantId: string) => [eq(visitorEntries.tenantId, tenantId), isNull(visitorEntries.deletedAt)];

/** `%` and `_` typed in the search box are text, not wildcards. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function conditions(tenantId: string, f: VisitorFilter): SQL[] {
  const where: SQL[] = live(tenantId);
  if (f.from) where.push(gte(visitorEntries.visitDate, f.from));
  if (f.to) where.push(lte(visitorEntries.visitDate, f.to));
  if (f.q) {
    const term = like(f.q);
    const any: SQL[] = [
      ilike(visitorEntries.visitorName, term),
      ilike(visitorEntries.companyName, term),
      ilike(visitorEntries.email, term),
      ilike(visitorEntries.mobile, term),
      ilike(visitorEntries.purpose, term),
      ilike(visitorEntries.remarks, term),
      ilike(meetingWith.name, term),
    ];
    // A phone number matches however it was spaced when it was typed in.
    const digits = f.q.replace(/\D/g, "");
    if (digits.length >= 4 && /^[+0-9 ()-]+$/.test(f.q)) {
      any.push(sql`regexp_replace(coalesce(${visitorEntries.mobile}, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`);
    }
    where.push(or(...any)!);
  }
  return where;
}

export async function listVisitors(
  tx: Tx,
  tenantId: string,
  filter: VisitorFilter,
): Promise<{ rows: VisitorRow[]; total: number; page: number; totalPages: number; hasAny: boolean }> {
  const where = and(...conditions(tenantId, filter));
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(visitorEntries)
    .leftJoin(meetingWith, eq(meetingWith.id, visitorEntries.meetingWithUserId))
    .where(where);
  const total = Number(count?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / VISITOR_PAGE_SIZE));
  // A page past the end (the last row of it was just deleted) shows the last page.
  const page = Math.min(filter.page, totalPages);

  const rows = await tx
    .select(columns)
    .from(visitorEntries)
    .leftJoin(meetingWith, eq(meetingWith.id, visitorEntries.meetingWithUserId))
    .leftJoin(recordedBy, eq(recordedBy.id, visitorEntries.createdBy))
    .where(where)
    .orderBy(
      desc(visitorEntries.visitDate),
      sql`${visitorEntries.entryTime} DESC NULLS LAST`,
      desc(visitorEntries.createdAt),
      asc(visitorEntries.id),
    )
    .limit(VISITOR_PAGE_SIZE)
    .offset((page - 1) * VISITOR_PAGE_SIZE);

  let hasAny = total > 0;
  if (!hasAny && (filter.q || filter.from || filter.to)) {
    const some = await tx.select({ id: visitorEntries.id }).from(visitorEntries).where(and(...live(tenantId))).limit(1);
    hasAny = some.length > 0;
  }
  return { rows: rows.map(toRow), total, page, totalPages, hasAny };
}

export async function getVisitor(tx: Tx, tenantId: string, id: string): Promise<VisitorRow | null> {
  if (!UUID.test(id)) return null;
  const [row] = await tx
    .select(columns)
    .from(visitorEntries)
    .leftJoin(meetingWith, eq(meetingWith.id, visitorEntries.meetingWithUserId))
    .leftJoin(recordedBy, eq(recordedBy.id, visitorEntries.createdBy))
    .where(and(...live(tenantId), eq(visitorEntries.id, id)))
    .limit(1);
  return row ? toRow(row) : null;
}

/** The firm's active team members — who a visitor can be meeting. */
export async function listMeetingUsers(tx: Tx, tenantId: string): Promise<MeetingUser[]> {
  return tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt), eq(users.status, "active")))
    .orderBy(asc(users.name));
}

async function assertMeetingUser(tx: Tx, tenantId: string, userId: string): Promise<void> {
  const [found] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isNull(users.deletedAt), eq(users.status, "active")))
    .limit(1);
  if (!found) throw refuse("Meeting with must be an active team member of your firm.");
}

const audit = (tx: Tx, actor: Actor, action: string, id: string, visitorName: string, visitDate: string) =>
  recordAudit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action,
    entityType: "visitor_entry",
    entityId: id,
    // The name and date identify the entry; contact details are not copied into the log.
    meta: { visitorName, visitDate },
  });

export async function createVisitor(tx: Tx, actor: Actor, input: VisitorInput): Promise<VisitorRow> {
  if (exitBeforeEntry(input.entryTime, input.exitTime)) throw refuse(EXIT_BEFORE_ENTRY);
  if (input.meetingWithUserId) await assertMeetingUser(tx, actor.tenantId, input.meetingWithUserId);
  const [created] = await tx
    .insert(visitorEntries)
    .values({ ...input, tenantId: actor.tenantId, createdBy: actor.userId })
    .returning({ id: visitorEntries.id });
  await audit(tx, actor, "visitor.create", created.id, input.visitorName, input.visitDate);
  return (await getVisitor(tx, actor.tenantId, created.id))!;
}

export async function updateVisitor(tx: Tx, actor: Actor, id: string, patch: VisitorPatch): Promise<VisitorRow> {
  const current = await getVisitor(tx, actor.tenantId, id);
  if (!current) throw refuse("Visitor entry not found", 404);

  const entry = patch.entryTime === undefined ? current.entryTime : patch.entryTime;
  const exit = patch.exitTime === undefined ? current.exitTime : patch.exitTime;
  if (exitBeforeEntry(entry, exit)) throw refuse(EXIT_BEFORE_ENTRY);
  // Only a NEW choice is checked: an old visit keeps a colleague who has since left.
  if (patch.meetingWithUserId && patch.meetingWithUserId !== current.meetingWithUserId) {
    await assertMeetingUser(tx, actor.tenantId, patch.meetingWithUserId);
  }

  await tx
    .update(visitorEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(...live(actor.tenantId), eq(visitorEntries.id, id)));
  await audit(tx, actor, "visitor.update", id, patch.visitorName ?? current.visitorName, patch.visitDate ?? current.visitDate);
  return (await getVisitor(tx, actor.tenantId, id))!;
}

/** Soft delete: the entry leaves the register; the row stays for the record. */
export async function deleteVisitor(tx: Tx, actor: Actor, id: string): Promise<void> {
  const current = await getVisitor(tx, actor.tenantId, id);
  if (!current) throw refuse("Visitor entry not found", 404);
  await tx
    .update(visitorEntries)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(...live(actor.tenantId), eq(visitorEntries.id, id)));
  await audit(tx, actor, "visitor.delete", id, current.visitorName, current.visitDate);
}
