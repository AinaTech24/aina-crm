/**
 * Import a Zoho CRM Meetings export as review meetings. Preview and import are
 * the same code; a preview rolls back (see run-contacts.ts).
 *
 *  - The meeting's client is the one whose Zoho Record Id is the meeting's
 *    Contact Name.id; a client without one is matched by exact unique name
 *    (client-match.ts) and keeps that Zoho id afterwards. A meeting with no
 *    contact (a lead's or a deal's) is skipped, as agreed.
 *  - Meetings are saved 500 at a time; a batch that fails is retried row by
 *    row, so one bad row never loses the rest.
 *  - Host is the RM and must be a user of the firm (or the person chose to
 *    take those meetings themselves).
 *  - A meeting already in the CRM for the same client, time and title is
 *    skipped, so a second run adds only what is new.
 *  - Unlike booking a meeting in the CRM, nothing is triggered: no reminder
 *    task, no notification, no event for a workflow. A completed meeting moves
 *    the client's last meeting date forward when it is later.
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { reviewMeetings } from "@/db/schema";
import { ownerKey } from "./contacts";
import { loadClientMatcher, stampZohoIds } from "./client-match";
import { mapZohoMeeting } from "./meetings";
import type { ImportActor, OwnerLine } from "./run-contacts";
import { ZohoFileError } from "./workbook";

export type MeetingImportResult = {
  dryRun: boolean;
  totalRows: number;
  created: number;
  closedAsPast: number;
  hosts: Array<Omit<OwnerLine, "clients"> & { meetings: number }>;
  skippedByReason: Array<{ reason: string; count: number }>;
  skipped: Array<{ row: number; name: string; reason: string }>;
  types: Array<{ value: string; to: string; count: number }>;
  statuses: Array<{ value: string; to: string; count: number }>;
  modes: Array<{ value: string; count: number }>;
  clientsLastMeetingMoved: number;
  /** Clients found by Zoho Record ID / by exact unique name. */
  matchedById: number;
  matchedByName: number;
};

class Rollback extends Error {
  constructor(public result: MeetingImportResult) {
    super("dry run");
  }
}

const TYPE_LABEL = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export async function importZohoMeetings(
  actor: ImportActor,
  rows: Record<string, unknown>[],
  opts: { dryRun: boolean; unmatchedHostsToMe: boolean; now?: Date; /** Run inside this transaction (tenant already set) — tests. */ tx?: Tx }
): Promise<MeetingImportResult> {
  const now = opts.now ?? new Date();
  const mapped = rows.map((r) => mapZohoMeeting(r, now));

  const run = async (tx: Tx): Promise<MeetingImportResult> => {
    const result: MeetingImportResult = {
      dryRun: opts.dryRun,
      totalRows: rows.length,
      created: 0,
      closedAsPast: 0,
      hosts: [],
      skippedByReason: [],
      skipped: [],
      // Only the rows that can come in — a lead meeting skipped anyway would read as a mapping.
      types: tally(mapped.filter((m) => !m.skip).map((m) => [m.zohoType || "(blank)", TYPE_LABEL(m.meetingType)])),
      statuses: tally(mapped.filter((m) => !m.skip).map((m) => [m.zohoStatus || "(blank)", m.closedAsPast ? "Completed (date has passed)" : TYPE_LABEL(m.status)])),
      modes: [],
      clientsLastMeetingMoved: 0,
      matchedById: 0,
      matchedByName: 0,
    };

    const users = (await tx.execute(sql`
      SELECT id, name, email FROM users WHERE tenant_id = ${actor.tenantId}::uuid AND status <> 'offboarded'
    `)).rows as Array<{ id: string; name: string; email: string }>;
    const userByKey = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.name) userByKey.set(ownerKey(u.name), u);
      if (u.email) userByKey.set(ownerKey(u.email), u);
    }

    // Zoho contact id → its name in the file (the first one seen), for the name fallback.
    const fileNames = new Map<string, string>();
    for (const m of mapped) if (m.contactZohoId && m.contactName && !fileNames.has(m.contactZohoId)) fileNames.set(m.contactZohoId, m.contactName);
    const matcher = await loadClientMatcher(tx, actor.tenantId, fileNames);

    // Meetings already in the CRM, so a second run adds only the new ones.
    const already = new Set(
      ((await tx.execute(sql`
        SELECT investor_id, meeting_date, COALESCE(subject, '') AS subject FROM review_meetings
         WHERE tenant_id = ${actor.tenantId}::uuid AND investor_id IS NOT NULL
      `)).rows as Array<{ investor_id: string; meeting_date: string | Date; subject: string }>).map(
        (r) => `${r.investor_id}|${new Date(r.meeting_date).getTime()}|${r.subject}`
      )
    );

    // Hosts: only for the meetings that would be imported.
    const hostCounts = new Map<string, number>();
    for (const m of mapped) if (!m.skip) hostCounts.set(m.hostText, (hostCounts.get(m.hostText) ?? 0) + 1);
    result.hosts = [...hostCounts.entries()]
      .map(([owner, meetings]) => {
        const u = owner ? userByKey.get(ownerKey(owner)) : undefined;
        return { owner, meetings, user: u ? { id: u.id, name: u.name } : null };
      })
      .sort((a, b) => b.meetings - a.meetings);
    const unmatched = result.hosts.filter((h) => h.owner && !h.user);
    if (unmatched.length && !opts.dryRun && !opts.unmatchedHostsToMe) {
      throw new ZohoFileError(`Create these users first (or choose to take their meetings yourself): ${unmatched.map((h) => h.owner).join(", ")}.`);
    }

    const skip = (row: number, name: string, reason: string) => {
      result.skipped.push({ row, name, reason });
    };
    const seen = new Set<string>();
    const modeCounts = new Map<string, number>();
    const lastMet = new Map<string, number>();

    type Pending = { rowNo: number; label: string; m: (typeof mapped)[number]; clientId: string; values: typeof reviewMeetings.$inferInsert };
    let pending: Pending[] = [];
    const saved = (p: Pending) => {
      result.created++;
      if (p.m.closedAsPast) result.closedAsPast++;
      modeCounts.set(p.m.meetingMode, (modeCounts.get(p.m.meetingMode) ?? 0) + 1);
      if (p.m.status === "completed") lastMet.set(p.clientId, Math.max(lastMet.get(p.clientId) ?? 0, p.m.start!.getTime()));
    };
    // 500 at a time; a batch that fails is retried row by row so one bad row loses only itself.
    const flush = async () => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      try {
        await tx.transaction(async (sp) => {
          await sp.insert(reviewMeetings).values(batch.map((p) => p.values));
        });
        batch.forEach(saved);
      } catch {
        for (const p of batch) {
          try {
            await tx.transaction(async (sp) => {
              await sp.insert(reviewMeetings).values(p.values);
            });
            saved(p);
          } catch (err: any) {
            skip(p.rowNo, p.label, `Could not be saved: ${String(err?.message ?? err).slice(0, 200)}`);
          }
        }
      }
    };

    for (let i = 0; i < mapped.length; i++) {
      const m = mapped[i];
      const rowNo = i + 2;
      const label = m.subject || m.contactName || m.zohoId || "(no title)";
      if (m.skip) {
        skip(rowNo, label, m.skip);
        continue;
      }
      if (m.zohoId && seen.has(m.zohoId)) {
        skip(rowNo, label, "Same Record Id as an earlier row");
        continue;
      }
      if (m.zohoId) seen.add(m.zohoId);
      const client = matcher.resolve(m.contactZohoId);
      if (!client) {
        skip(rowNo, label, `Client not matched: ${matcher.why(m.contactZohoId)}`);
        continue;
      }
      const key = `${client.id}|${m.start!.getTime()}|${m.subject ?? ""}`;
      if (already.has(key)) {
        skip(rowNo, label, "Already imported");
        continue;
      }
      already.add(key);

      const host = m.hostText ? userByKey.get(ownerKey(m.hostText)) : undefined;
      const rmId = host?.id ?? (m.hostText ? actor.userId : client.rm_id ?? actor.userId);
      pending.push({
        rowNo,
        label,
        m,
        clientId: client.id,
        values: {
          id: uuid(),
          tenantId: actor.tenantId,
          investorId: client.id,
          leadId: null,
          rmId,
          category: m.category,
          meetingType: m.meetingType,
          subject: m.subject,
          meetingDate: m.start!,
          durationMinutes: String(m.durationMinutes),
          meetingMode: m.meetingMode,
          locationOrLink: m.locationOrLink,
          discussionPoints: m.discussionPoints,
          status: m.status,
          attendees: [],
        },
      });
      if (pending.length >= 500) await flush();
    }
    await flush();
    await stampZohoIds(tx, actor.tenantId, actor.userId, matcher.stamps());
    result.matchedById = matcher.matchedById();
    result.matchedByName = matcher.matchedByName();

    for (const [investorId, t] of lastMet) {
      const r = await tx.execute(sql`
        UPDATE investors SET last_review_at = ${new Date(t).toISOString()}::timestamptz, updated_at = now()
         WHERE id = ${investorId}::uuid AND tenant_id = ${actor.tenantId}::uuid
           AND (last_review_at IS NULL OR last_review_at < ${new Date(t).toISOString()}::timestamptz)
        RETURNING id
      `);
      if (r.rows.length) result.clientsLastMeetingMoved++;
    }

    result.modes = [...modeCounts.entries()].map(([value, count]) => ({ value: TYPE_LABEL(value), count })).sort((a, b) => b.count - a.count);
    const byReason = new Map<string, number>();
    for (const s of result.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    result.skippedByReason = [...byReason.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    result.skipped = result.skipped.slice(0, 500);

    await recordAudit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "review_meeting.bulk_import",
      entityType: "review_meeting",
      entityId: null,
      meta: { source: "zoho_meetings", totalRows: rows.length, created: result.created, closedAsPast: result.closedAsPast, matchedById: result.matchedById, matchedByName: result.matchedByName, skipped: result.skippedByReason },
    });

    if (opts.dryRun) throw new Rollback(result);
    return result;
  };

  try {
    if (opts.tx) return await opts.tx.transaction((sp) => run(sp as unknown as Tx));
    return await withTenant(actor.tenantId, run, { userId: actor.userId, branchId: actor.branchId ?? undefined, roles: actor.roles });
  } catch (err) {
    if (err instanceof Rollback) return err.result;
    throw err;
  }
}

function tally(pairs: Array<[string, string]>): Array<{ value: string; to: string; count: number }> {
  const m = new Map<string, { to: string; count: number }>();
  for (const [value, to] of pairs) {
    const k = `${value}\u0000${to}`;
    const cur = m.get(k) ?? { to, count: 0 };
    cur.count++;
    m.set(k, cur);
  }
  return [...m.entries()].map(([k, v]) => ({ value: k.split("\u0000")[0], ...v })).sort((a, b) => b.count - a.count).slice(0, 40);
}
