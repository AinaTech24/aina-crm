/**
 * Service requests — the Excel import (2026-11-24). Columns are specs/service-requests.ts.
 *
 * Opening a ticket in the CRM (openServiceRequest) sends the client an
 * acknowledgement and emits the event that starts the firm's automations. An
 * imported ticket is a RECORD of one that already exists, so neither happens. It
 * keeps the rest: the ticket number series, the two SLA clocks (from the Created
 * Date, by the service type) and the first timeline entry.
 */
import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { serviceRequests } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { SLA_HOURS_BY_TYPE } from "@/lib/service-requests/open";
import { loadClients, loadUsers, type ClientLookup, type UserLookup } from "./lookups";
import type { ImportModule, Problem } from "./run";
import {
  COMPLAINT_SOURCE_OPTIONS, SEBI_CATEGORY_OPTIONS, SR_CHANNEL_OPTIONS, SR_PRIORITY_OPTIONS, SR_STATUS_OPTIONS,
  SR_TYPE_OPTIONS, serviceRequestsSpec,
} from "./specs/service-requests";
import { istInstant, parseDayTime, parseEnum } from "./values";

type Prep = {
  users: UserLookup;
  clients: ClientLookup;
  /** Ticket numbers already in the firm's register (upper case). */
  taken: Set<string>;
  /** Ticket numbers asked for in this file, to catch a repeat inside it. */
  inFile: Set<string>;
  /** Highest generated number per year, so the next one follows it. */
  counters: Map<string, number>;
};
type Item = {
  ticketNo: string | null; type: string; subject: string; description: string | null; priority: string; status: string;
  channel: string | null; investorId: string | null; requesterName: string | null; assignedToUserId: string;
  createdAt: Date; resolvedAt: Date | null; resolutionNotes: string | null; remarks: string | null;
  sebiCategory: string | null; sebiSubCategory: string | null; complaintSource: string | null; scoresRefNo: string | null;
};

const CLOSED = new Set(["resolved", "closed"]);
const TICKET = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{1,39}$/;
const pad5 = (n: number) => String(n).padStart(5, "0");
const istYear = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(d);

export const serviceRequestsImport: ImportModule<Prep, Item> = {
  spec: serviceRequestsSpec,

  authorize(session) {
    requireCap(session.roles, "service_request.manage", session.permissions);
  },

  async prepare(tx, session, rows) {
    const asked = [...new Set(rows.map((r) => r.get("ticketNo").trim().toUpperCase()).filter(Boolean))];
    const taken = new Set<string>();
    if (asked.length) {
      const r = await tx.execute(sql`
        SELECT upper(ticket_no) AS t FROM service_requests
         WHERE tenant_id = ${session.tenantId}::uuid
           AND upper(ticket_no) IN (${sql.join(asked.map((a) => sql`${a}`), sql`, `)})
      `);
      for (const x of r.rows as Array<{ t: string }>) taken.add(x.t);
    }
    const counters = new Map<string, number>();
    const c = await tx.execute(sql`
      SELECT substring(ticket_no from '^SR-(\\d{4})-') AS yr,
             max(substring(ticket_no from '^SR-\\d{4}-(\\d+)$')::int) AS n
        FROM service_requests
       WHERE tenant_id = ${session.tenantId}::uuid AND ticket_no ~ '^SR-\\d{4}-\\d+$'
       GROUP BY 1
    `);
    for (const x of c.rows as Array<{ yr: string; n: number }>) counters.set(x.yr, Number(x.n));
    return {
      users: await loadUsers(tx, session.tenantId),
      clients: await loadClients(tx, session, rows.map((r) => ({ pan: r.get("clientPan"), name: r.get("clientName") }))),
      taken,
      inFile: new Set(),
      counters,
    };
  },

  parse(row, prep, session) {
    const choice = (key: string, options: Array<{ value: string; label: string }>, fallback: string | null, required = false) => {
      const raw = row.get(key);
      if (!raw) { if (required) row.fail(key, "Required"); return fallback; }
      const p = parseEnum(raw, options);
      if (p.ok) return p.value;
      row.fail(key, p.error);
      return fallback;
    };
    const type = choice("type", SR_TYPE_OPTIONS, null, true);
    const priority = choice("priority", SR_PRIORITY_OPTIONS, "normal") as string;
    const status = choice("status", SR_STATUS_OPTIONS, "open") as string;
    const channel = choice("channel", SR_CHANNEL_OPTIONS, null);
    const sebiCategory = choice("sebiCategory", SEBI_CATEGORY_OPTIONS, null);
    const complaintSource = choice("complaintSource", COMPLAINT_SOURCE_OPTIONS, null);

    const subject = row.get("subject");
    if (subject.length < 2) row.fail("subject", subject ? "Too short — at least 2 characters" : "Required");
    else if (subject.length > 300) row.fail("subject", "Too long — 300 characters at most");
    for (const [k, max] of [["description", 20000], ["resolutionNotes", 20000], ["remarks", 20000], ["requesterName", 200], ["sebiSubCategory", 200], ["scoresRefNo", 80]] as const) {
      if (row.get(k).length > max) row.fail(k, `Too long — ${max.toLocaleString("en-IN")} characters at most`);
    }

    // Complaint-only fields: refused on anything else, not silently dropped as a created ticket would.
    if (type && type !== "complaint") {
      for (const k of ["sebiCategory", "sebiSubCategory", "complaintSource", "scoresRefNo"] as const) {
        if (row.get(k)) row.fail(k, "Only for a Complaint — set Service Type to Complaint or clear this");
      }
    }

    // Ticket number: unique in the register and in the file.
    let ticketNo: string | null = null;
    const askedNo = row.get("ticketNo");
    if (askedNo) {
      const up = askedNo.toUpperCase();
      if (!TICKET.test(askedNo)) row.fail("ticketNo", "Letters, digits and - _ / . only (2–40 characters)");
      else if (prep.taken.has(up)) row.fail("ticketNo", "This ticket number is already in your register");
      else if (prep.inFile.has(up)) row.fail("ticketNo", "This ticket number appears twice in the file");
      else { ticketNo = askedNo; prep.inFile.add(up); }
    }

    let createdAt = new Date();
    if (row.get("createdDate")) {
      const p = parseDayTime(row.get("createdDate"));
      if (p.ok) {
        createdAt = istInstant(p.value.day, p.value.time ?? "00:00");
        if (createdAt.getTime() > Date.now() + 86_400_000) row.fail("createdDate", "Is in the future");
      } else row.fail("createdDate", p.error);
    }
    let resolvedAt: Date | null = null;
    if (row.get("resolvedDate")) {
      const p = parseDayTime(row.get("resolvedDate"));
      if (!p.ok) row.fail("resolvedDate", p.error);
      else if (!CLOSED.has(status)) row.fail("resolvedDate", "Only for a Resolved or Closed request — set Status or clear this");
      else {
        resolvedAt = istInstant(p.value.day, p.value.time ?? "00:00");
        if (resolvedAt.getTime() < createdAt.getTime() - 60_000) row.fail("resolvedDate", "Is before the Created Date");
      }
    } else if (CLOSED.has(status)) resolvedAt = new Date();

    let assignedToUserId = session.userId;
    if (row.get("assignedTo")) {
      const f = prep.users.find(row.get("assignedTo"));
      if (f.ok) assignedToUserId = f.value.id; else row.fail("assignedTo", f.error);
    }

    let investorId: string | null = null;
    const c = prep.clients.find({ pan: row.get("clientPan"), name: row.get("clientName") });
    if (c.ok) investorId = c.value?.id ?? null;
    else row.fail(row.get("clientPan") ? "clientPan" : "clientName", c.error);

    if (row.failed || !type) return null;
    return {
      ticketNo, type, subject, description: row.get("description") || null, priority, status, channel, investorId,
      requesterName: row.get("requesterName") || null, assignedToUserId, createdAt, resolvedAt,
      resolutionNotes: row.get("resolutionNotes") || null, remarks: row.get("remarks") || null,
      sebiCategory, sebiSubCategory: row.get("sebiSubCategory") || null,
      complaintSource: type === "complaint" ? (complaintSource ?? "direct") : null, scoresRefNo: row.get("scoresRefNo") || null,
    };
  },

  async commit(tx: Tx, session: SessionUser, items, prep) {
    const failed: Problem[] = [];
    let saved = 0;
    const who = session.name ?? "a teammate";
    for (const { n, item: s } of items) {
      // The next free number of the year the ticket was raised in; the ones asked for in the file are never reused.
      let ticketNo = s.ticketNo;
      if (!ticketNo) {
        const yr = istYear(s.createdAt);
        let next = (prep.counters.get(yr) ?? 0) + 1;
        while (prep.inFile.has(`SR-${yr}-${pad5(next)}`) || prep.taken.has(`SR-${yr}-${pad5(next)}`)) next++;
        prep.counters.set(yr, next);
        ticketNo = `SR-${yr}-${pad5(next)}`;
      }
      const hours = SLA_HOURS_BY_TYPE[s.type] ?? 24 * 7;
      const slaResolutionAt = new Date(s.createdAt.getTime() + hours * 3_600_000);
      const slaResponseAt = new Date(s.createdAt.getTime() + hours * 3_600_000 * 0.25);
      try {
        await tx.transaction(async (sp) => {
          await sp.insert(serviceRequests).values({
            id: uuid(),
            tenantId: session.tenantId,
            ticketNo,
            investorId: s.investorId,
            assignedToUserId: s.assignedToUserId,
            type: s.type,
            channel: s.channel ?? undefined,
            subject: s.subject,
            description: s.description ?? undefined,
            status: s.status,
            priority: s.priority,
            slaResponseAt,
            slaResolutionAt,
            resolvedAt: s.resolvedAt,
            sebiCategory: s.sebiCategory ?? undefined,
            sebiSubCategory: s.sebiSubCategory ?? undefined,
            complaintSource: s.complaintSource,
            scoresRefNo: s.scoresRefNo,
            resolutionNotes: s.resolutionNotes,
            remarks: s.remarks,
            requesterName: s.requesterName,
            timeline: [{
              at: s.createdAt.toISOString(), by: session.userId, event: "created",
              note: `Imported from Excel by ${who}${s.status !== "open" ? ` (status: ${s.status.replace(/_/g, " ")})` : ""}`,
            }],
            createdAt: s.createdAt,
          } as never);
        });
        saved++;
      } catch (e) {
        failed.push({ row: n, column: "—", message: `Could not be saved: ${(e as Error).message?.slice(0, 160) ?? "database error"}` });
      }
    }
    return { saved, failed };
  },
};
