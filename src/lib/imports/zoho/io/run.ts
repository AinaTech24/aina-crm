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
 *
 * Refill (policies and claims, 2026-11-24): with `refill`, a policy or claim
 * already brought in is brought up to what Zoho holds — the per-line fields,
 * member / cover sub-tables and dates the first import missed. A row nobody has
 * edited since its import (updated_at = created_at) takes Zoho's values; an
 * edited one only has its blanks filled, so a person's change is never undone.
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
import { nameMatchKey } from "@/lib/rta/client-match";
import { groupWmRows, mapWmPolicy, policyKey, wmStatus, type WmRow } from "./wealthmaker";
import { ioLeadRecord, ioMeetingRow, ioUsers, mapIoAssignment, mapIoClaim, mapIoNote, mapIoPolicy, mapIoTask } from "./modules";

export const IO_MODULES = [
  "IO_Contacts", "IO_Leads", "IO_Calls", "IO_Tasks", "IO_Task_Assignment", "IO_Meetings", "IO_Insurance", "IO_Claims", "IO_Notes",
  // WealthMaker's insurance export (Floater / Individual / Motor / Other sheets) — wealthmaker.ts.
  "IO_WM_Insurance",
  // No records: the Zoho import's expired policies the client renewed → matured (2026-11-25).
  "IO_Policy_Renewals",
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
  /** IO_WM_Insurance: every policy left out, for the firm's list to fix. */
  skippedRows?: Array<{ sheet: string; policyNumber: string; holder: string; insurer: string; product: string; start: string | null; expiry: string | null; reason: string }>;
};

/** `refill`: policies and claims already brought in take what Zoho holds that they lack (2026-11-24). */
type Opts = { dryRun: boolean; unmatchedToMe: boolean; refill?: boolean; now?: Date; tx?: Tx };

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
    case "IO_WM_Insurance":
    case "IO_Policy_Renewals":
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

async function runOwn(actor: ImportActor, module: "IO_Insurance" | "IO_Claims" | "IO_Notes" | "IO_WM_Insurance" | "IO_Policy_Renewals", records: ZohoRecord[], opts: Opts): Promise<IoResult> {
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
        SELECT id, details->>'zohoId' AS z, investor_id, policy_number, details, status,
               policy_start_date::text AS start, next_premium_due_date::text AS due, sum_assured::text AS sum,
               lives_covered, (updated_at = created_at) AS untouched
          FROM insurance_policies
         WHERE tenant_id = ${actor.tenantId}::uuid AND details ? 'zohoId'
      `)).rows as Array<{
        id: string; z: string; investor_id: string; policy_number: string | null; details: Record<string, unknown> | null; status: string;
        start: string | null; due: string | null; sum: string | null; lives_covered: number | null; untouched: boolean;
      }>;
      const doneById = new Map(done.map((d) => [d.z, d]));
      const doneIds = new Set(done.map((d) => d.z));
      const doneNumbers = new Set(done.filter((d) => d.policy_number).map((d) => `${d.investor_id}|${d.policy_number!.toUpperCase()}`));
      const today = istToday(now);
      // Line modules first (richer: start dates, sum insured), then the register.
      const mapped = records.map(mapIoPolicy).sort((a, b) => Number(a.module === "Insurance") - Number(b.module === "Insurance"));
      const rows: Array<typeof insurancePolicies.$inferInsert> = [];
      for (const m of mapped) {
        if (m.test) { skip("Test record in Zoho"); continue; }
        if (doneIds.has(m.zohoId)) {
          const have = doneById.get(m.zohoId);
          if (!opts.refill || !have) { result.already++; continue; }
          const change = refillPolicy(have, m, today);
          if (!change) { result.already++; continue; }
          for (const l of change.labels) count(`Refill: ${l}`);
          await tx.execute(sql`
            UPDATE insurance_policies SET
              details = ${JSON.stringify(change.details)}::jsonb,
              policy_start_date = COALESCE(${change.start}::date, policy_start_date),
              risk_cover_start_date = COALESCE(risk_cover_start_date, ${change.start}::date),
              next_premium_due_date = COALESCE(${change.due}::date, next_premium_due_date),
              sum_assured = COALESCE(${change.sum}::numeric, sum_assured),
              lives_covered = COALESCE(${change.lives}::int, lives_covered),
              status = COALESCE(${change.status}, status),
              lapse_reason = COALESCE(${change.lapseReason}, lapse_reason),
              updated_at = CASE WHEN updated_at = created_at THEN created_at ELSE updated_at END
             WHERE id = ${have.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
          `);
          result.updated++;
          continue;
        }
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
          ...(m.livesCovered ? { livesCovered: m.livesCovered } : {}),
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
      const doneRows = (await tx.execute(sql`
        SELECT id, substring(comments from 'Zoho claim ([0-9]+)') AS z, details, (updated_at = created_at) AS untouched
          FROM insurance_claims
         WHERE tenant_id = ${actor.tenantId}::uuid AND comments LIKE '%Zoho claim %'
      `)).rows as Array<{ id: string; z: string; details: Record<string, unknown> | null; untouched: boolean }>;
      const done = new Set(doneRows.map((r) => r.z));
      const claimById = new Map(doneRows.map((r) => [r.z, r]));
      const policies = (await tx.execute(sql`
        SELECT id, investor_id, upper(policy_number) AS no FROM insurance_policies
         WHERE tenant_id = ${actor.tenantId}::uuid AND policy_number IS NOT NULL
      `)).rows as Array<{ id: string; investor_id: string; no: string }>;
      const policyByNo = new Map(policies.map((p) => [p.no, p]));
      for (const raw of records) {
        const m = mapIoClaim(raw);
        if (done.has(m.zohoId)) {
          const have = claimById.get(m.zohoId);
          if (!opts.refill || !have) { result.already++; continue; }
          const next = mergeDetails(have.details ?? {}, m.details, have.untouched);
          if (JSON.stringify(next) === JSON.stringify(have.details ?? {})) { result.already++; continue; }
          count("Refill: claim details");
          await tx.execute(sql`
            UPDATE insurance_claims SET details = ${JSON.stringify(next)}::jsonb
             WHERE id = ${have.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
          `);
          result.updated++;
          continue;
        }
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
          details: m.details,
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

    if (module === "IO_Policy_Renewals") {
      // The Zoho import (2026-11-20) marked every policy whose period had ended
      // "lapsed" — lost business — even when the client renewed. Only rows still
      // carrying that import's own lapse reason are looked at, so a status a
      // person set is never changed.
      const lapsed = (await tx.execute(sql`
        SELECT id, investor_id, policy_type, policy_number, policy_start_date::text AS start,
               next_premium_due_date::text AS due, COALESCE(remarks, '') AS remarks
          FROM insurance_policies
         WHERE tenant_id = ${actor.tenantId}::uuid AND status = 'lapsed'
           AND details ? 'zohoId' AND lapse_reason LIKE '%(Zoho); no renewal recorded on this policy'
      `)).rows as Array<{ id: string; investor_id: string; policy_type: string; policy_number: string | null; start: string | null; due: string | null; remarks: string }>;
      const all = (await tx.execute(sql`
        SELECT investor_id, policy_type, policy_number, policy_start_date::text AS start
          FROM insurance_policies
         WHERE tenant_id = ${actor.tenantId}::uuid AND policy_start_date IS NOT NULL
      `)).rows as Array<{ investor_id: string; policy_type: string; policy_number: string | null; start: string }>;
      const byClient = new Map<string, Array<{ policyType: string; startDate: string | null; policyNumber: string }>>();
      for (const a of all) {
        const l = byClient.get(a.investor_id) ?? [];
        l.push({ policyType: a.policy_type, startDate: a.start, policyNumber: a.policy_number ?? "" });
        byClient.set(a.investor_id, l);
      }
      const today = istToday(now);
      for (const p of lapsed) {
        const others = (byClient.get(p.investor_id) ?? []).filter((o) => o.policyNumber !== (p.policy_number ?? ""));
        const st = wmStatus({ policyType: p.policy_type, startDate: p.start, expiryDate: p.due }, others, today);
        if (st.status !== "matured") { result.already++; continue; }
        const note = st.renewedBy ? `Renewed: next policy ${st.renewedBy}.` : "Trip over.";
        count(`${p.policy_type.replace(/_/g, " ")} · lapsed → ${st.renewedBy ? "renewed (matured)" : "trip over (matured)"}`);
        await tx.execute(sql`
          UPDATE insurance_policies
             SET status = 'matured', lapse_reason = NULL,
                 remarks = ${[p.remarks, note].filter(Boolean).join(" ")}
           WHERE id = ${p.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
        `);
        result.updated++;
      }
      result.notes.push("Only policies still carrying the Zoho import's own lapse reason were looked at; a lapsed policy the client did not renew stays lapsed.");
    }

    if (module === "IO_WM_Insurance") {
      const today = istToday(now);
      // Every live client, by name key (the export has no PAN or mobile).
      const all = (await tx.execute(sql`
        SELECT id, name, branch_id, rm_id FROM investors
         WHERE tenant_id = ${actor.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
      `)).rows as Array<{ id: string; name: string; branch_id: string | null; rm_id: string | null }>;
      const byName = new Map<string, Array<(typeof all)[number]>>();
      for (const c of all) {
        const k = nameMatchKey(c.name);
        if (k.split(" ").length < 2) continue;
        const list = byName.get(k);
        if (list) list.push(c);
        else byName.set(k, [c]);
      }
      const existing = (await tx.execute(sql`
        SELECT id, policy_number, investor_id, policy_type, details, sum_assured::text AS sum,
               policy_start_date::text AS start, next_premium_due_date::text AS due
          FROM insurance_policies
         WHERE tenant_id = ${actor.tenantId}::uuid AND policy_number IS NOT NULL
      `)).rows as Array<{ id: string; policy_number: string; investor_id: string; policy_type: string; details: Record<string, unknown> | null; sum: string | null; start: string | null; due: string | null }>;
      const existingByNo = new Map(existing.map((e) => [policyKey(e.policy_number), e]));
      const skippedRows: NonNullable<IoResult["skippedRows"]> = [];
      const left = (p: ReturnType<typeof mapWmPolicy>, reason: string) => {
        skip(reason);
        skippedRows.push({ sheet: p.sheet, policyNumber: p.policyNumber, holder: p.holder, insurer: p.insurer, product: p.planName, start: p.startDate, expiry: p.expiryDate, reason });
      };

      // 1. Map, drop what is already here (filling its blanks), match the holder.
      const seen = new Set<string>();
      const take: Array<{ p: ReturnType<typeof mapWmPolicy>; client: (typeof all)[number] }> = [];
      for (const group of groupWmRows(records as WmRow[])) {
        const p = mapWmPolicy(group);
        const no = policyKey(p.policyNumber);
        if (seen.has(no)) { left(p, "Same policy number twice in the files"); continue; }
        seen.add(no);
        const have = existingByNo.get(no);
        if (have) {
          // Already in the CRM (Zoho): fill only what it lacks.
          const d = { ...(have.details ?? {}) };
          let filled = false;
          for (const [k, v] of Object.entries(p.details)) {
            if (k === "source" || k === "wmSheet") continue;
            if (d[k] == null || d[k] === "" || (Array.isArray(d[k]) && !(d[k] as unknown[]).length)) { d[k] = v; filled = true; }
          }
          const sum = !have.sum || Number(have.sum) === 0 ? (p.sumAssured != null ? String(p.sumAssured) : null) : null;
          const start = !have.start ? p.startDate : null;
          const due = !have.due ? p.expiryDate : null;
          if (filled || sum || start || due) {
            await tx.execute(sql`
              UPDATE insurance_policies SET details = ${JSON.stringify(d)}::jsonb,
                     sum_assured = COALESCE(sum_assured, ${sum}::numeric),
                     policy_start_date = COALESCE(policy_start_date, ${start}::date),
                     next_premium_due_date = COALESCE(next_premium_due_date, ${due}::date)
               WHERE id = ${have.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
            `);
            count("Already in the CRM — blanks filled from WealthMaker");
            result.updated++;
          } else result.already++;
          continue;
        }
        const k = nameMatchKey(p.holder);
        if (k.split(" ").length < 2) { left(p, "Holder name too short to match"); continue; }
        const matches = byName.get(k) ?? [];
        if (matches.length === 0) { left(p, "Holder not in the CRM"); continue; }
        if (matches.length > 1) { left(p, "Holder name matches 2+ clients"); continue; }
        take.push({ p, client: matches[0] });
      }

      // 2. Status from the client's other policies (renewed → matured, not renewed → lapsed).
      const byClient = new Map<string, Array<{ policyType: string; startDate: string | null; policyNumber: string }>>();
      const addOther = (id: string, o: { policyType: string; startDate: string | null; policyNumber: string }) => {
        const l = byClient.get(id);
        if (l) l.push(o);
        else byClient.set(id, [o]);
      };
      for (const e of existing) addOther(e.investor_id, { policyType: e.policy_type, startDate: e.start, policyNumber: e.policy_number });
      for (const { p, client } of take) addOther(client.id, { policyType: p.policyType, startDate: p.startDate, policyNumber: p.policyNumber });

      const rows: Array<typeof insurancePolicies.$inferInsert> = [];
      for (const { p, client } of take) {
        const others = (byClient.get(client.id) ?? []).filter((o) => o.policyNumber !== p.policyNumber);
        const st = wmStatus(p, others, today);
        count(`${p.policyType.replace(/_/g, " ")} · ${st.status === "matured" ? "renewed (history)" : st.status}`);
        const seller = userOf(p.agencyEmail);
        rows.push({
          tenantId: actor.tenantId,
          branchId: client.branch_id,
          investorId: client.id,
          policyNumber: p.policyNumber,
          insurer: p.insurer || "Not recorded",
          planName: p.planName,
          policyType: p.policyType,
          sumAssured: p.sumAssured != null ? String(p.sumAssured) : null,
          ...(p.livesCovered ? { livesCovered: p.livesCovered } : {}),
          annualPremium: p.premium != null ? String(p.premium) : null,
          premiumFrequency: "annual",
          policyStartDate: p.startDate,
          riskCoverStartDate: p.startDate,
          maturityDate: p.expiryDate,
          nextPremiumDueDate: p.expiryDate,
          details: p.details,
          remarks: [
            `Imported from WealthMaker (${p.sheet}).`,
            st.renewedBy ? `Renewed: next policy ${st.renewedBy}.` : "",
          ].filter(Boolean).join(" "),
          status: st.status,
          lapseReason: st.status === "lapsed" ? `Policy period ended ${p.expiryDate} (WealthMaker); no renewal recorded for this client` : null,
          soldByUserId: seller?.id ?? client.rm_id ?? null,
          soldAt: p.startDate ? new Date(`${p.startDate}T10:00:00+05:30`) : null,
          // Nothing alerts at import: history is history.
          lapseAlertedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        result.created++;
      }
      for (let i = 0; i < rows.length; i += 500) await tx.insert(insurancePolicies).values(rows.slice(i, i + 500));
      result.skippedRows = skippedRows;
      result.notes.push(
        "Linked by the holder's name only (the export has no PAN or mobile): a name matching no client or two or more clients is skipped and listed.",
        "A policy whose period ended is 'matured' when the client has a later policy of the same type (renewed), else 'lapsed'.",
      );
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


// ── Refill ────────────────────────────────────────────────────────────────

/** Keys the first import (2026-11-20) wrote under another spelling than the form's. */
const OLD_KEYS: Record<string, string> = {
  chassisNumber: "chassisNo",
  engineNumber: "engineNo",
  yearOfManufacture: "manufacturingYear",
  issueDate: "policyIssueDate",
  agency: "agencyName",
  idv: "sumAssured",
};

const blank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Stored details + Zoho's. An untouched row takes Zoho's value for every key
 * Zoho has; an edited row only gains the keys it lacks. Keys under the first
 * import's old spelling move to the form's (dropped where the new one holds a value).
 */
export function mergeDetails(have: Record<string, unknown>, zoho: Record<string, unknown>, untouched: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...have };
  for (const [oldKey, newKey] of Object.entries(OLD_KEYS)) {
    if (!(oldKey in out)) continue;
    if (newKey !== "sumAssured" && blank(out[newKey])) out[newKey] = out[oldKey];
    delete out[oldKey];
  }
  // A "Yes" / "No" floater from the first import is the form's checkbox.
  if (typeof out.familyFloater === "string") out.familyFloater = /^(yes|true|y)$/i.test(out.familyFloater);
  for (const [k, v] of Object.entries(zoho)) {
    if (blank(v)) continue;
    if (untouched || blank(out[k])) out[k] = v;
  }
  return out;
}

type HeldPolicy = {
  details: Record<string, unknown> | null; status: string; start: string | null; due: string | null;
  sum: string | null; lives_covered: number | null; untouched: boolean;
};

/** What a refill changes on one policy, or null when nothing would. */
export function refillPolicy(have: HeldPolicy, m: ReturnType<typeof mapIoPolicy>, today: string): {
  details: Record<string, unknown>; start: string | null; due: string | null; sum: string | null; lives: number | null;
  status: "lapsed" | null; lapseReason: string | null; labels: string[];
} | null {
  const labels: string[] = [];
  const details = mergeDetails(have.details ?? {}, m.details, have.untouched);
  if (JSON.stringify(details) !== JSON.stringify(have.details ?? {})) labels.push(`${m.module.replace(/_/g, " ")} details`);
  const take = (held: string | null, zoho: string | null) => (zoho && zoho !== held && (have.untouched || !held) ? zoho : null);
  // A start "worked out from the renewal date" is replaced by Zoho's real one.
  const start = take(have.start, m.startDerived ? null : m.startDate);
  const due = take(have.due, m.renewalDate);
  const zSum = m.sumAssured != null ? String(m.sumAssured) : null;
  const sum = zSum && (have.untouched || !have.sum || Number(have.sum) === 0) && Number(have.sum ?? 0) !== Number(zSum) ? zSum : null;
  const lives = m.livesCovered && m.livesCovered !== have.lives_covered && (have.untouched || (have.lives_covered ?? 1) <= 1) ? m.livesCovered : null;
  if (start) labels.push("start date");
  if (due) labels.push("renewal date");
  if (sum) labels.push("sum insured");
  if (lives) labels.push("lives covered");
  // A renewal date now known and over (30 days' grace) on an active, untouched policy → lapsed, as at import.
  let status: "lapsed" | null = null;
  let lapseReason: string | null = null;
  if (due && have.status === "active" && have.untouched) {
    const over = new Date(`${due}T00:00:00+05:30`).getTime() + 30 * DAY < new Date(`${today}T00:00:00+05:30`).getTime();
    if (over) {
      status = "lapsed";
      lapseReason = `Policy period ended ${due} (Zoho); no renewal recorded on this policy`;
      labels.push("lapsed (period over)");
    }
  }
  if (!labels.length) return null;
  return { details, start, due, sum, lives, status, lapseReason, labels };
}
