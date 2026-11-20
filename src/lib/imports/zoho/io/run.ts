/**
 * Investment Options' Zoho import (2026-11-20): one entry point per module,
 * records read through Zoho's API. Preview and import are the same code (a
 * preview rolls back). The shared Zoho importers do clients, leads, calls,
 * tasks and meetings with this firm's own mapping; policies, claims and notes
 * are written here.
 *
 * Nothing is sent and nothing fires at import time: no event, no notification.
 * Every row keeps its Zoho id, so a second run (the cut-over re-sync) adds only
 * what is new.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { activities, insuranceClaims, insurancePolicies } from "@/db/schema";
import { ownerKey } from "../contacts";
import { importZohoContacts, type ImportActor } from "../run-contacts";
import { importZohoModule } from "../run-modules";
import { importZohoMeetings } from "../run-meetings";
import type { ZohoRecord } from "../modules";
import { IO_CUSTOM_FIELDS, ioContactRow, mapIoContact } from "./contacts";
import { ioLeadRecord, ioMeetingRow, ioUsers, mapIoAssignment, mapIoClaim, mapIoNote, mapIoPolicy, mapIoTask } from "./modules";

export const IO_MODULES = [
  "IO_Contacts", "IO_Leads", "IO_Calls", "IO_Tasks", "IO_Task_Assignment", "IO_Meetings", "IO_Insurance", "IO_Claims", "IO_Notes",
] as const;
export type IoModule = (typeof IO_MODULES)[number];

export type IoResult = {
  dryRun: boolean;
  module: string;
  totalRows: number;
  created: number;
  updated: number;
  already: number;
  skippedByReason: Array<{ reason: string; count: number }>;
  breakdown: Array<{ label: string; count: number }>;
  notes: string[];
};

type Opts = { dryRun: boolean; unmatchedToMe: boolean; now?: Date; tx?: Tx };

export async function importIoModule(actor: ImportActor, module: IoModule, records: ZohoRecord[], opts: Opts): Promise<unknown> {
  switch (module) {
    case "IO_Contacts":
      return importZohoContacts(actor, [], records.map(ioContactRow), {
        ...opts,
        unmatchedOwnersToMe: opts.unmatchedToMe,
        mapRow: mapIoContact,
        customFields: IO_CUSTOM_FIELDS,
      });
    case "IO_Leads":
      return importZohoModule(actor, "Leads", records.map(ioLeadRecord), opts);
    case "IO_Calls":
      return importZohoModule(actor, "Calls", records.map(ioUsers), opts);
    case "IO_Tasks":
      return importZohoModule(actor, "Query_Tracker", records, { ...opts, mapTask: mapIoTask });
    case "IO_Task_Assignment":
      return importZohoModule(actor, "Query_Tracker", records, { ...opts, mapTask: mapIoAssignment });
    case "IO_Meetings":
      return importZohoMeetings(actor, records.map(ioMeetingRow), { ...opts, unmatchedHostsToMe: opts.unmatchedToMe });
    case "IO_Insurance":
    case "IO_Claims":
    case "IO_Notes":
      return runOwn(actor, module, records, opts);
  }
}

class Rollback extends Error {
  constructor(public result: IoResult) {
    super("dry run");
  }
}

const DAY = 864e5;
const istToday = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

async function runOwn(actor: ImportActor, module: "IO_Insurance" | "IO_Claims" | "IO_Notes", records: ZohoRecord[], opts: Opts): Promise<IoResult> {
  const now = opts.now ?? new Date();
  const run = async (tx: Tx): Promise<IoResult> => {
    const result: IoResult = { dryRun: opts.dryRun, module, totalRows: records.length, created: 0, updated: 0, already: 0, skippedByReason: [], breakdown: [], notes: [] };
    const skipped = new Map<string, number>();
    const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
    const tally = new Map<string, number>();
    const count = (l: string) => tally.set(l, (tally.get(l) ?? 0) + 1);

    const users = (await tx.execute(sql`
      SELECT id, name, email, branch_id FROM users WHERE tenant_id = ${actor.tenantId}::uuid AND status <> 'offboarded'
    `)).rows as Array<{ id: string; name: string; email: string; branch_id: string | null }>;
    const userByKey = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.name) userByKey.set(ownerKey(u.name), u);
      if (u.email) userByKey.set(ownerKey(u.email), u);
    }
    const userOf = (v: string) => (v ? userByKey.get(ownerKey(v)) : undefined);

    const clients = (await tx.execute(sql`
      SELECT id, name, phone, email, branch_id, rm_id, custom_fields->>'cf_zoho_record_id' AS zoho_id
        FROM investors
       WHERE tenant_id = ${actor.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
         AND custom_fields->>'cf_zoho_record_id' IS NOT NULL
    `)).rows as Array<{ id: string; name: string; phone: string | null; email: string | null; branch_id: string | null; rm_id: string | null; zoho_id: string }>;
    const clientOf = new Map(clients.map((c) => [c.zoho_id, c]));

    if (module === "IO_Insurance") {
      const done = (await tx.execute(sql`
        SELECT details->>'zohoId' AS z, investor_id, policy_number FROM insurance_policies
         WHERE tenant_id = ${actor.tenantId}::uuid AND details ? 'zohoId'
      `)).rows as Array<{ z: string; investor_id: string; policy_number: string | null }>;
      const doneIds = new Set(done.map((d) => d.z));
      const doneNumbers = new Set(done.filter((d) => d.policy_number).map((d) => `${d.investor_id}|${d.policy_number!.toUpperCase()}`));
      const today = istToday(now);
      // Line modules first (richer: start dates, sum insured), then the register.
      const mapped = records.map(mapIoPolicy).sort((a, b) => Number(a.module === "Insurance") - Number(b.module === "Insurance"));
      const rows: Array<typeof insurancePolicies.$inferInsert> = [];
      for (const m of mapped) {
        if (m.test) { skip("Test record in Zoho"); continue; }
        if (doneIds.has(m.zohoId)) { result.already++; continue; }
        const client = clientOf.get(m.clientZohoId);
        if (!client) { skip(m.clientZohoId ? "Policy holder not in the CRM" : "No policy holder in Zoho"); continue; }
        const numKey = m.policyNumber ? `${client.id}|${m.policyNumber.toUpperCase()}` : "";
        if (numKey && doneNumbers.has(numKey)) { skip("Same policy number already brought in (line module or earlier row)"); continue; }
        if (numKey) doneNumbers.add(numKey);
        if (!m.insurer) count("No insurer in Zoho (recorded as 'Not recorded')");
        // The policy period is over and no renewal is recorded on this row → lapsed (grace 30 days).
        const expired = !!m.renewalDate && new Date(`${m.renewalDate}T00:00:00+05:30`).getTime() + 30 * DAY < new Date(`${today}T00:00:00+05:30`).getTime();
        const status = expired ? ("lapsed" as const) : ("active" as const);
        count(`${m.policyType.replace(/_/g, " ")} · ${status}`);
        const seller = userOf(m.agentEmail);
        rows.push({
          tenantId: actor.tenantId,
          branchId: client.branch_id,
          investorId: client.id,
          policyNumber: m.policyNumber,
          insurer: m.insurer || "Not recorded",
          planName: m.planName,
          policyType: m.policyType,
          sumAssured: m.sumAssured != null ? String(m.sumAssured) : null,
          annualPremium: m.premium != null ? String(m.premium) : null,
          premiumFrequency: m.frequency,
          premiumPayingTermYears: m.payingTermYears,
          policyTermYears: m.termYears,
          policyStartDate: m.startDate,
          riskCoverStartDate: m.startDate,
          maturityDate: m.maturityDate,
          nextPremiumDueDate: m.renewalDate,
          nomineeName: m.nominee?.name ?? null,
          nomineeRelation: m.nominee?.relation ?? null,
          nomineeDob: m.nominee?.dob ?? null,
          details: m.details,
          remarks: m.remarks,
          lapseReason: expired ? `Policy period ended ${m.renewalDate} (Zoho); no renewal recorded on this policy` : null,
          status,
          // Business owner: the agent when they are a user, else the client's RM (lib/insurance/book.ts).
          soldByUserId: seller?.id ?? client.rm_id ?? null,
          soldAt: m.startDate ? new Date(`${m.startDate}T10:00:00+05:30`) : null,
          // Nothing alerts at import: a lapsed one is already lapsed.
          lapseAlertedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        result.created++;
      }
      for (let i = 0; i < rows.length; i += 500) await tx.insert(insurancePolicies).values(rows.slice(i, i + 500));
      result.notes.push("Policies with no start date take one from Zoho's renewal date (a one-year policy); the remark on each says so.");
    }

    if (module === "IO_Claims") {
      const done = new Set(((await tx.execute(sql`
        SELECT substring(comments from 'Zoho claim ([0-9]+)') AS z FROM insurance_claims
         WHERE tenant_id = ${actor.tenantId}::uuid AND comments LIKE '%Zoho claim %'
      `)).rows as Array<{ z: string }>).map((r) => r.z));
      const policies = (await tx.execute(sql`
        SELECT id, investor_id, upper(policy_number) AS no FROM insurance_policies
         WHERE tenant_id = ${actor.tenantId}::uuid AND policy_number IS NOT NULL
      `)).rows as Array<{ id: string; investor_id: string; no: string }>;
      const policyByNo = new Map(policies.map((p) => [p.no, p]));
      for (const raw of records) {
        const m = mapIoClaim(raw);
        if (done.has(m.zohoId)) { result.already++; continue; }
        const client = clientOf.get(m.clientZohoId);
        if (!client) { skip("Policy holder not in the CRM"); continue; }
        const policy = m.policyNumber ? policyByNo.get(m.policyNumber.toUpperCase()) : undefined;
        const rm = userOf(m.owner);
        count(`${m.title.slice(0, 30)} · ${m.status.replace(/_/g, " ")}`);
        await tx.insert(insuranceClaims).values({
          tenantId: actor.tenantId,
          branchId: client.branch_id,
          policyId: policy?.id ?? null,
          policyNumber: m.policyNumber,
          insurer: m.insurer || null,
          investorId: client.id,
          proposerName: client.name,
          email: client.email,
          phone: client.phone,
          claimStatus: m.status,
          policyDetails: m.policyDetails,
          claimType: m.claimType,
          claimMode: m.claimMode,
          intimationMode: m.intimationMode,
          admissionDate: m.admissionDate,
          intimationDate: m.intimationDate,
          submissionDate: m.submissionDate,
          settlementDate: m.settlementDate,
          claimedAmount: String(m.claimed || 0),
          settledAmount: String(m.settled || 0),
          rmId: rm?.id ?? client.rm_id,
          comments: [`${m.title} · Zoho claim ${m.zohoId}`, m.details.claimNo ? `Claim no. ${m.details.claimNo}` : "", m.comments].filter(Boolean).join("\n"),
          createdAt: now,
          updatedAt: now,
        });
        result.created++;
      }
    }

    if (module === "IO_Notes") {
      const leadOf = new Map(((await tx.execute(sql`
        SELECT id, name, phone, custom_fields->>'cf_zoho_record_id' AS zoho_id FROM leads
         WHERE tenant_id = ${actor.tenantId}::uuid AND custom_fields->>'cf_zoho_record_id' IS NOT NULL
      `)).rows as Array<{ id: string; name: string; phone: string | null; zoho_id: string }>).map((l) => [l.zoho_id, l]));
      const taskOf = new Map(((await tx.execute(sql`
        SELECT id, meta->>'zohoId' AS z, COALESCE(remarks, '') AS remarks FROM tasks
         WHERE tenant_id = ${actor.tenantId}::uuid AND meta ? 'zohoTask'
      `)).rows as Array<{ id: string; z: string; remarks: string }>).map((t) => [t.z, t]));
      const seenNotes = new Set(((await tx.execute(sql`
        SELECT substring(notes from 'Zoho note ([0-9]+)') AS z FROM activities
         WHERE tenant_id = ${actor.tenantId}::uuid AND kind = 'note' AND notes LIKE '%Zoho note %'
      `)).rows as Array<{ z: string }>).map((r) => r.z));
      const rows: Array<typeof activities.$inferInsert> = [];
      for (const raw of records) {
        const m = mapIoNote(raw);
        if (!m.text) { skip("Empty note"); continue; }
        // A note on a task (IO Task, Tasks) becomes part of that task's remarks.
        if (m.parentModule === "Task_Assignment" || m.parentModule === "Tasks") {
          const t = taskOf.get(m.parentZohoId);
          if (!t) { skip("Task not in the CRM"); continue; }
          if (t.remarks.includes(`[Zoho note ${m.zohoId}]`)) { result.already++; continue; }
          const line = `${m.at ? m.at.toISOString().slice(0, 10) : ""} ${m.text} [Zoho note ${m.zohoId}]`.trim();
          t.remarks = t.remarks ? `${t.remarks}\n${line}` : line;
          await tx.execute(sql`UPDATE tasks SET remarks = ${t.remarks.slice(0, 8000)}, updated_at = now() WHERE id = ${t.id}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
          count("Added to the task's remarks");
          result.updated++;
          continue;
        }
        // Otherwise a note on the client / lead it belongs to (Events and Calls carry the client in _clientZohoId).
        const clientZoho = m.parentModule === "Contacts" ? m.parentZohoId : String((raw as Record<string, unknown>)._clientZohoId ?? "");
        const client = clientZoho ? clientOf.get(clientZoho) : undefined;
        const lead = !client && m.parentModule === "Leads" ? leadOf.get(m.parentZohoId) : undefined;
        if (!client && !lead) { skip(`Note on ${m.parentModule || "an unknown record"} with no client or lead`); continue; }
        if (seenNotes.has(m.zohoId)) { result.already++; continue; }
        const owner = userOf(m.owner);
        rows.push({
          tenantId: actor.tenantId,
          branchId: client?.branch_id ?? owner?.branch_id ?? null,
          subjectType: client ? ("investor" as const) : ("lead" as const),
          subjectId: (client ?? lead)!.id,
          subjectName: (client ?? lead)!.name,
          subjectPhone: (client ?? lead)!.phone,
          kind: "note",
          subject: m.parentModule === "Contacts" || m.parentModule === "Leads" ? "Note (Zoho)" : `Note on a Zoho ${m.parentModule === "Events" ? "meeting" : "call"}`,
          notes: `${m.text}\n[Zoho note ${m.zohoId}]`,
          occurredAt: m.at ?? now,
          ownerUserId: owner?.id ?? null,
          createdAt: m.at ?? now,
          updatedAt: now,
        });
        count(client ? "Note on a client" : "Note on a lead");
        result.created++;
      }
      for (let i = 0; i < rows.length; i += 500) await tx.insert(activities).values(rows.slice(i, i + 500));
    }

    result.skippedByReason = [...skipped.entries()].map(([reason, c]) => ({ reason, count: c })).sort((a, b) => b.count - a.count);
    result.breakdown = [...tally.entries()].map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count);
    await recordAudit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "zoho_import.module",
      entityType: "tenant",
      entityId: null,
      meta: { source: `zoho_${module.toLowerCase()}`, totalRows: records.length, created: result.created, updated: result.updated, already: result.already },
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
