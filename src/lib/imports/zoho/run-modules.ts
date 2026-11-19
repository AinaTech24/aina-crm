/**
 * Write the Zoho modules mapped in modules.ts (We Care, 2026-11-18). Preview
 * and import are the same code; a preview rolls back (see run-contacts.ts).
 *
 *  - Owners / assignees are users of the firm by name; one with no user goes
 *    to the person importing, if they chose that (as for meetings).
 *  - A client is the one carrying the record's Zoho contact id (the Contacts
 *    import stamped every client); a lead, the one carrying the Zoho lead id.
 *  - A second run adds only what is new: every row keeps its Zoho id
 *    (lead custom field, task meta, risk profile remark, SIP rejection dedup
 *    key) or is matched on client + time (calls).
 *  - Nothing is sent and nothing fires: no event, no notification; imported
 *    open tasks and SIP rejections are marked as already reminded / escalated
 *    so a years-old item does not wake a scanner.
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { activities, leads, riskProfileResponses, sipRejections, tasks } from "@/db/schema";
import { normalizeEmail, normalizePhoneLast10 } from "@/lib/leads/normalize";
import { ownerKey } from "./contacts";
import type { ImportActor } from "./run-contacts";
import { ZohoFileError } from "./workbook";
import {
  DEFAULT_RISK_BANDS, MODULE_LABEL, brokerageByMonth, categoryFromScore, mapCall, mapLead, mapLineType, mapRiskProfile, mapSipTracking, mapTask,
  type RiskBand, type ZohoModule, type ZohoRecord,
} from "./modules";

export type ModuleImportResult = {
  dryRun: boolean;
  module: ZohoModule;
  label: string;
  totalRows: number;
  created: number;
  updated: number;
  already: number;
  owners: Array<{ owner: string; rows: number; user: { id: string; name: string } | null }>;
  skippedByReason: Array<{ reason: string; count: number }>;
  breakdown: Array<{ label: string; count: number }>;
  notes: string[];
};

class Rollback extends Error {
  constructor(public result: ModuleImportResult) {
    super("dry run");
  }
}

const SCORE_BY_CATEGORY = { conservative: 13, moderate: 24, aggressive: 35, very_aggressive: 40 } as const;
const DAY = 864e5;

export async function importZohoModule(
  actor: ImportActor,
  module: ZohoModule,
  records: ZohoRecord[],
  opts: { dryRun: boolean; unmatchedToMe: boolean; now?: Date; tx?: Tx }
): Promise<ModuleImportResult> {
  const now = opts.now ?? new Date();

  const run = async (tx: Tx): Promise<ModuleImportResult> => {
    const result: ModuleImportResult = {
      dryRun: opts.dryRun, module, label: MODULE_LABEL[module], totalRows: records.length,
      created: 0, updated: 0, already: 0, owners: [], skippedByReason: [], breakdown: [], notes: [],
    };
    const skipped = new Map<string, number>();
    const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    const tally = new Map<string, number>();
    const count = (label: string) => tally.set(label, (tally.get(label) ?? 0) + 1);

    // ── Users ──
    const users = (await tx.execute(sql`
      SELECT id, name, email, branch_id FROM users WHERE tenant_id = ${actor.tenantId}::uuid AND status <> 'offboarded'
    `)).rows as Array<{ id: string; name: string; email: string; branch_id: string | null }>;
    const userByKey = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.name) userByKey.set(ownerKey(u.name), u);
      if (u.email) userByKey.set(ownerKey(u.email), u);
    }
    const ownerRows = new Map<string, number>();
    const noteOwner = (name: string) => {
      if (name) ownerRows.set(name, (ownerRows.get(name) ?? 0) + 1);
    };
    /** A Zoho user's CRM user id; one with no user goes to the importer. */
    const userId = (name: string): string | null => {
      if (!name) return null;
      return userByKey.get(ownerKey(name))?.id ?? actor.userId;
    };
    const finishOwners = () => {
      result.owners = [...ownerRows.entries()]
        .map(([owner, rows]) => {
          const u = userByKey.get(ownerKey(owner));
          return { owner, rows, user: u ? { id: u.id, name: u.name } : null };
        })
        .sort((a, b) => b.rows - a.rows);
      const unmatched = result.owners.filter((o) => !o.user);
      if (unmatched.length && !opts.dryRun && !opts.unmatchedToMe) {
        throw new ZohoFileError(`Create these users first (or choose to take their records yourself): ${unmatched.map((o) => o.owner).join(", ")}.`);
      }
    };

    // ── Clients and leads by Zoho id ──
    const clients = (await tx.execute(sql`
      SELECT id, name, phone, branch_id, rm_id, risk_profile, custom_fields->>'cf_zoho_record_id' AS zoho_id
        FROM investors
       WHERE tenant_id = ${actor.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
         AND custom_fields->>'cf_zoho_record_id' IS NOT NULL
    `)).rows as Array<{ id: string; name: string; phone: string | null; branch_id: string | null; rm_id: string | null; risk_profile: string | null; zoho_id: string }>;
    const clientOf = new Map(clients.map((c) => [c.zoho_id, c]));
    const leadRows = (await tx.execute(sql`
      SELECT id, name, phone, custom_fields->>'cf_zoho_record_id' AS zoho_id
        FROM leads WHERE tenant_id = ${actor.tenantId}::uuid AND custom_fields->>'cf_zoho_record_id' IS NOT NULL
    `)).rows as Array<{ id: string; name: string; phone: string | null; zoho_id: string }>;
    const leadOf = new Map(leadRows.map((l) => [l.zoho_id, l]));

    const insertAll = async <T>(table: any, rows: T[]) => {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        if (batch.length) await tx.insert(table).values(batch as any);
      }
    };

    if (module === "Leads") {
      const mapped = records.map(mapLead);
      for (const m of mapped) noteOwner(m.owner);
      finishOwners();
      const rows: Array<typeof leads.$inferInsert> = [];
      for (const m of mapped) {
        if (!m.zohoId) { skip("No Zoho id"); continue; }
        if (!m.name) { skip("No name"); continue; }
        if (leadOf.has(m.zohoId)) { result.already++; continue; }
        const converted = m.convertedZohoId ? clientOf.get(m.convertedZohoId) : undefined;
        const referrer = m.referrerZohoId ? clientOf.get(m.referrerZohoId) : undefined;
        const followUp = m.followUp && new Date(`${m.followUp}T10:00:00+05:30`) > now ? new Date(`${m.followUp}T10:00:00+05:30`) : null;
        const ownerId = userId(m.owner);
        const ownerBranch = users.find((u) => u.id === ownerId)?.branch_id ?? null;
        count(`Stage: ${m.statusText || "(blank)"} → ${m.stage.replace(/_/g, " ")}`);
        if (m.stage === "converted") count(converted ? "Converted, linked to the client" : "Converted, client not found");
        rows.push({
          id: uuid(),
          tenantId: actor.tenantId,
          branchId: ownerBranch,
          name: m.name,
          email: m.email,
          emailNormalized: normalizeEmail(m.email),
          phone: m.phone,
          phoneNormalized: normalizePhoneLast10(m.phone),
          city: m.city,
          pincode: m.pincode,
          source: m.source as any,
          sourceCampaign: m.sourceText || null,
          stage: m.stage as any,
          stageChangedAt: m.convertedAt ?? m.createdAt ?? now,
          pipeline: m.pipeline,
          interestProducts: m.interest,
          referredByInvestorId: referrer?.id ?? null,
          referredByName: m.referrerName || null,
          ownerId,
          nextFollowUpAt: followUp,
          convertedInvestorId: converted?.id ?? null,
          convertedAt: m.stage === "converted" ? m.convertedAt ?? m.createdAt ?? now : null,
          lostReason: m.stage === "lost" ? "Lost in Zoho" : null,
          lostAt: m.stage === "lost" ? m.createdAt ?? now : null,
          notes: m.notes,
          customFields: {
            cf_zoho_record_id: m.zohoId,
            ...(m.sourceText ? { cf_zoho_lead_source: m.sourceText } : {}),
            ...(m.statusText ? { cf_zoho_lead_status: m.statusText } : {}),
            ...(m.expectedText ? { cf_zoho_expected_business: m.expectedText } : {}),
          },
          createdAt: m.createdAt ?? now,
          updatedAt: now,
        } as any);
        result.created++;
      }
      await insertAll(leads, rows);
    }

    if (module === "Risk_Profiles") {
      const mapped = records.map(mapRiskProfile);
      for (const m of mapped) noteOwner(m.owner);
      finishOwners();
      const done = new Set(
        ((await tx.execute(sql`
          SELECT substring(rm_remarks from 'Zoho risk profile ([0-9]+)') AS z FROM risk_profile_responses
           WHERE tenant_id = ${actor.tenantId}::uuid AND rm_remarks LIKE 'Zoho risk profile %'
        `)).rows as Array<{ z: string }>).map((r) => r.z)
      );
      // The firm's own bands (its active questionnaire) decide the category from Zoho's score.
      const tpl = (await tx.execute(sql`
        SELECT bands FROM risk_profile_templates
         WHERE tenant_id = ${actor.tenantId}::uuid AND is_active ORDER BY version_number DESC LIMIT 1
      `)).rows[0] as { bands: RiskBand[] } | undefined;
      const bands = Array.isArray(tpl?.bands) && tpl!.bands.length ? tpl!.bands : DEFAULT_RISK_BANDS;
      result.notes.push(`Band from Zoho's score on the firm's bands: ${bands.map((b) => `${b.id} ${b.minScore}–${b.maxScore}`).join(", ")}.`);
      for (const m of mapped) m.category = categoryFromScore(m.score, bands) as any;
      // The latest profile per client becomes the client's own.
      const latest = new Map<string, (typeof mapped)[number]>();
      const rows: Array<typeof riskProfileResponses.$inferInsert> = [];
      for (const m of mapped) {
        if (done.has(m.zohoId)) { result.already++; continue; }
        if (!m.category) { skip(m.score > 0 ? `Score ${m.score} is outside the firm's bands` : "No score on the Zoho profile"); continue; }
        const client = clientOf.get(m.clientZohoId);
        if (!client) { skip(m.clientZohoId ? "Client not in the CRM" : "No client on the Zoho profile"); continue; }
        if (!m.signedAt) { skip("No date on the Zoho profile"); continue; }
        count(`Zoho ${m.zohoBand || "(no band)"} → ${m.category}`);
        rows.push({
          tenantId: actor.tenantId,
          investorId: client.id,
          profileDate: m.signedAt.toISOString().slice(0, 10),
          finalCategory: m.category,
          totalScore: m.score || SCORE_BY_CATEGORY[m.category],
          responses: m.responses,
          signedAt: m.signedAt,
          signedByName: client.name,
          nextReviewAt: new Date(m.signedAt.getTime() + 365 * DAY).toISOString().slice(0, 10),
          verificationMethod: "rm_entry",
          rmRemarks: `Zoho risk profile ${m.zohoId} · Zoho band: ${m.zohoBand}${m.score ? ` · Zoho score ${m.score}` : ""}`,
          provisional: false,
          basis: "zoho_import",
          createdById: userId(m.owner),
        } as any);
        const prev = latest.get(client.id);
        if (!prev || prev.signedAt!.getTime() < m.signedAt.getTime()) latest.set(client.id, m);
        result.created++;
      }
      await insertAll(riskProfileResponses, rows);
      // The client's own profile: the latest Zoho one, unless the client has answered the
      // CRM's own questionnaire (link / OTP / physical form) after it. A category that was
      // only set or imported (the Excel client load stamped those with the import date)
      // gives way to Zoho's questionnaire.
      for (const [investorId, m] of latest) {
        const res = await tx.execute(sql`
          UPDATE investors SET
                 risk_profile = ${m.category},
                 risk_profile_score = ${m.score || SCORE_BY_CATEGORY[m.category!]},
                 risk_profile_signed_at = ${m.signedAt!.toISOString()}::timestamptz,
                 risk_profile_provisional = false,
                 risk_profile_version = COALESCE(risk_profile_version, 0) + 1,
                 updated_at = now()
           WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${investorId}::uuid
             AND NOT EXISTS (
               SELECT 1 FROM risk_profile_responses r
                WHERE r.tenant_id = ${actor.tenantId}::uuid AND r.investor_id = ${investorId}::uuid
                  AND r.verification_method IN ('client_link', 'client_otp', 'client_physical')
                  AND r.signed_at > ${m.signedAt!.toISOString()}::timestamptz
             )
          RETURNING id
        `);
        if (res.rows.length) result.updated++;
      }
      result.notes.push(`${result.updated} clients now carry their latest Zoho profile as their confirmed risk profile.`);
    }

    if (module === "Query_Tracker") {
      const mapped = records.map(mapTask);
      for (const m of mapped) {
        noteOwner(m.owner);
        noteOwner(m.assignee);
      }
      finishOwners();
      const done = new Set(
        ((await tx.execute(sql`
          SELECT meta->>'zohoId' AS z FROM tasks WHERE tenant_id = ${actor.tenantId}::uuid AND meta ? 'zohoTask'
        `)).rows as Array<{ z: string }>).map((r) => r.z)
      );
      const rows: Array<typeof tasks.$inferInsert> = [];
      for (const m of mapped) {
        if (!m.zohoId) { skip("No Zoho id"); continue; }
        if (done.has(m.zohoId)) { result.already++; continue; }
        const client = m.clientZohoId ? clientOf.get(m.clientZohoId) : undefined;
        const lead = m.leadZohoId ? leadOf.get(m.leadZohoId) : undefined;
        const created = m.created ?? m.start ?? now;
        // Unfinished work older than 30 days comes in closed (the firm's choice):
        // years-old "open" Zoho tasks would otherwise sit on every dashboard as overdue.
        const stale = (m.status === "open" || m.status === "in_progress") && now.getTime() - created.getTime() > 30 * DAY;
        const status = stale ? "cancelled" : m.status;
        const finished = status === "completed" || status === "cancelled";
        const remarks = stale ? [`Closed at the move from Zoho — it was "${m.statusText || "no status"}" there`, m.remarks].filter(Boolean).join(" · ") : m.remarks;
        count(stale ? `${m.statusText || "(blank)"}, older than 30 days → closed` : `${m.statusText || "(blank)"} → ${status.replace("_", " ")}`);
        if (m.clientZohoId && !client) count("Client not found (kept, unlinked)");
        rows.push({
          tenantId: actor.tenantId,
          subjectType: client ? "investor" : lead ? "lead" : "internal",
          subjectId: client?.id ?? lead?.id ?? null,
          relatedInvestorId: client?.id ?? null,
          relatedLeadId: lead?.id ?? null,
          department: m.department as any,
          type: "custom",
          title: m.title,
          description: m.description,
          remarks,
          priority: m.priority,
          status,
          assigneeId: userId(m.assignee) ?? userId(m.owner),
          createdById: userId(m.owner),
          entryDate: created.toISOString().slice(0, 10),
          dueAt: m.end ?? m.start ?? null,
          startedAt: m.status === "open" ? null : m.start ?? created,
          completedAt: finished ? m.end ?? m.start ?? created : null,
          remindAt: null,
          reminderFiredAt: finished ? null : now,
          overdueNotifiedAt: finished ? null : now,
          meta: {
            ...m.meta,
            ...(m.clientZohoId && !client ? { zohoClient: m.clientName } : {}),
            ...(m.assignee ? { zohoAssignee: m.assignee } : {}),
            ...(m.owner ? { zohoOwner: m.owner } : {}),
          },
          tags: ["zoho"],
          createdAt: created,
          updatedAt: now,
        } as any);
        result.created++;
      }
      await insertAll(tasks, rows);
    }

    if (module === "Calls") {
      const mapped = records.map(mapCall);
      for (const m of mapped) noteOwner(m.owner);
      finishOwners();
      const rows: Array<typeof activities.$inferInsert> = [];
      const seen = new Set(
        ((await tx.execute(sql`
          SELECT subject_id, occurred_at FROM activities WHERE tenant_id = ${actor.tenantId}::uuid AND kind = 'call'
        `)).rows as Array<{ subject_id: string; occurred_at: string | Date }>).map((r) => `${r.subject_id}|${new Date(r.occurred_at).getTime()}`)
      );
      for (const m of mapped) {
        const client = m.contactZohoId ? clientOf.get(m.contactZohoId) : undefined;
        const lead = client ? undefined : leadOf.get(m.relatedZohoId) ?? leadOf.get(m.contactZohoId);
        const subject = client ? { type: "investor" as const, id: client.id, name: client.name, phone: client.phone } : lead ? { type: "lead" as const, id: lead.id, name: lead.name, phone: lead.phone } : null;
        if (!subject) { skip(m.contactZohoId || m.relatedZohoId ? "Client / lead not in the CRM" : "Call not linked to a client or lead"); continue; }
        if (!m.at) { skip("No call time"); continue; }
        const k = `${subject.id}|${m.at.getTime()}`;
        if (seen.has(k)) { result.already++; continue; }
        seen.add(k);
        count(m.scheduled ? "Scheduled call (logged as a note of the plan)" : m.status === "no_answer" ? "Missed call" : m.direction === "inbound" ? "Incoming call" : "Outgoing call");
        const ownerId = userId(m.owner);
        rows.push({
          tenantId: actor.tenantId,
          branchId: client?.branch_id ?? users.find((u) => u.id === ownerId)?.branch_id ?? null,
          subjectType: subject.type,
          subjectId: subject.id,
          subjectName: subject.name,
          subjectPhone: subject.phone,
          kind: "call",
          direction: m.direction,
          status: m.status,
          subject: m.subject,
          notes: m.notes,
          occurredAt: m.at,
          durationSec: m.durationSec,
          ownerUserId: ownerId,
          createdAt: m.at,
          updatedAt: now,
        } as any);
        result.created++;
      }
      await insertAll(activities, rows);
    }

    if (module === "SWP") {
      const mapped = records.map(mapSipTracking);
      const rejected = mapped.filter((m) => /reject/i.test(m.status));
      for (const m of rejected) noteOwner(m.owner);
      finishOwners();
      const notRejected = mapped.length - rejected.length;
      if (notRejected) skipped.set("Not rejected (Pending / Completed SIPs stay in Business Entries)", notRejected);
      const done = new Set(
        ((await tx.execute(sql`
          SELECT dedup_key FROM sip_rejections WHERE tenant_id = ${actor.tenantId}::uuid AND dedup_key LIKE 'zoho:%'
        `)).rows as Array<{ dedup_key: string }>).map((r) => r.dedup_key)
      );
      const rows: Array<typeof sipRejections.$inferInsert> = [];
      for (const m of rejected) {
        if (done.has(`zoho:${m.zohoId}`)) { result.already++; continue; }
        const client = clientOf.get(m.clientZohoId);
        if (!client) { skip("Client not in the CRM"); continue; }
        if (!m.date) { skip("No date"); continue; }
        if (!(m.amount > 0)) { skip("No amount"); continue; }
        // As Zoho has it (the firm's choice): every rejection open. Marked as
        // already escalated so the reconciliation scanner does not alert on
        // years-old rejections all at once.
        count(m.date.slice(0, 4));
        rows.push({
          tenantId: actor.tenantId,
          investorId: client.id,
          rejectionDate: m.date,
          rejectionAmount: String(m.amount),
          rejectionReason: "Rejected (Zoho SIP Tracking)",
          schemeName: m.scheme,
          assignedRmId: client.rm_id ?? userId(m.owner),
          recoveryStatus: "pending",
          statusChangedAt: now,
          escalatedAt: now,
          remarks: [m.sipType, m.debitDay ? `Debit day ${m.debitDay}` : "", m.mft ? `Zoho ${m.mft}` : "", "Imported from Zoho SIP Tracking"].filter(Boolean).join(" · "),
          dedupKey: `zoho:${m.zohoId}`,
        } as any);
        result.created++;
      }
      await insertAll(sipRejections, rows);
    }

    if (module === "Purchase_and_Redempti_01") {
      // Restore Zoho's own Type and Purchase/Redemption onto the imported lines
      // (the Scheme Master mapping re-derived asset_class from the category).
      const lines = (await tx.execute(sql`
        SELECT l.id, l.amount::numeric AS amount, l.scheme_name, l.from_scheme_name, COALESCE(l.notes, '') AS notes,
               substring(e.notes from '^Zoho (MFT[0-9]+)') AS mft
          FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
         WHERE l.tenant_id = ${actor.tenantId}::uuid AND e.notes ~ '^Zoho MFT[0-9]'
           AND l.txn_type NOT IN ('sip', 'sip_topup', 'sip_stop')
      `)).rows as Array<{ id: string; amount: string; scheme_name: string; from_scheme_name: string | null; notes: string; mft: string }>;
      const byMft = new Map<string, typeof lines>();
      for (const l of lines) {
        if (!byMft.has(l.mft)) byMft.set(l.mft, []);
        byMft.get(l.mft)!.push(l);
      }
      const taken = new Set<string>();
      const sets: Array<{ id: string; type: string; kind: string }> = [];
      const key = (s: string) => s.trim().toLowerCase();
      for (const r of records) {
        const m = mapLineType(r);
        if (!m.mft) { skip("No MF Transaction on the line"); continue; }
        const cands = (byMft.get(m.mft) ?? []).filter((l) => !taken.has(l.id) && Math.abs(Number(l.amount) - m.amount) < 0.01);
        if (!cands.length) { skip(byMft.has(m.mft) ? "No CRM line with this amount" : "MF Transaction not in the CRM"); continue; }
        const names = [m.scheme, m.toScheme].filter(Boolean).map(key);
        const hit =
          cands.find((l) => names.some((n) => key(l.scheme_name) === n || key(l.from_scheme_name ?? "") === n || key(l.notes).startsWith(`zoho: ${n}`))) ?? cands[0];
        taken.add(hit.id);
        sets.push({ id: hit.id, type: m.type, kind: m.kind });
        count(`${m.kind || "(blank)"} · ${m.type || "(no type)"}`);
      }
      for (let i = 0; i < sets.length; i += 500) {
        const batch = sets.slice(i, i + 500);
        const ids = batch.map((b) => b.id);
        const types = batch.map((b) => b.type ?? "");
        const kinds = batch.map((b) => b.kind ?? "");
        await tx.execute(sql`
          UPDATE business_entry_lines l SET source_type = NULLIF(v.t, ''), source_kind = NULLIF(v.k, ''), updated_at = now()
            FROM unnest(${ids}::uuid[], ${types}::text[], ${kinds}::text[]) AS v(id, t, k)
           WHERE l.id = v.id AND l.tenant_id = ${actor.tenantId}::uuid
        `);
      }
      result.updated = sets.length;
      // The old Mutual Fund module has no subform: its Type is the one the import
      // gave the line, read back from the asset class it set (no Scheme Master
      // mapping has run on those lines).
      const old = await tx.execute(sql`
        UPDATE business_entry_lines l SET
               source_type = CASE WHEN l.asset_class = 'equity' AND l.from_asset_class = 'liquid' THEN 'Liquid to Equity'
                                  WHEN l.asset_class = 'liquid' THEN 'Liquid'
                                  WHEN l.asset_class = 'equity' THEN 'Equity' ELSE NULL END,
               source_kind = CASE WHEN l.txn_type IN ('redemption', 'swp') THEN 'Redemption' ELSE 'Purchase' END,
               updated_at = now()
          FROM business_entries e
         WHERE e.id = l.entry_id AND l.tenant_id = ${actor.tenantId}::uuid AND e.notes ~ '^Zoho MFT-OLD-'
           AND e.product_type = 'mutual_fund' AND l.source_type IS NULL
           AND l.txn_type NOT IN ('sip', 'sip_topup', 'sip_stop')
        RETURNING l.id
      `);
      result.notes.push(`${sets.length} MF Transaction lines took Zoho's Type; ${old.rows.length} old Mutual Fund lines took the Type they were imported with.`);
    }

    if (module === "Equity") {
      const { months, undated } = brokerageByMonth(records);
      if (undated) skipped.set("No date", undated);
      for (const m of months) {
        const active = m.activeClients.map(Number).filter((n) => Number.isFinite(n));
        const notes = `Zoho Equity Brokerage: ${m.rows} day${m.rows === 1 ? "" : "s"}${m.turnover ? ` · turnover ₹${Math.round(m.turnover).toLocaleString("en-IN")}` : ""}${active.length ? ` · active clients up to ${Math.max(...active)}` : ""}`;
        const res = await tx.execute(sql`
          INSERT INTO equity_brokerage (id, tenant_id, period, amount, notes, created_at, updated_at)
          VALUES (${uuid()}::uuid, ${actor.tenantId}::uuid, ${m.period}, ${m.amount.toFixed(2)}, ${notes}, now(), now())
          ON CONFLICT (tenant_id, period) DO UPDATE SET amount = EXCLUDED.amount, notes = EXCLUDED.notes, updated_at = now()
          RETURNING (xmax = 0) AS inserted
        `);
        if ((res.rows[0] as any)?.inserted) result.created++;
        else result.updated++;
        count(m.period.slice(0, 4));
      }
      result.notes.push(`${months.length} months of brokerage; a month already in the CRM takes Zoho's total.`);
    }

    result.skippedByReason = [...skipped.entries()].map(([reason, c]) => ({ reason, count: c })).sort((a, b) => b.count - a.count);
    result.breakdown = [...tally.entries()].map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count).slice(0, 60);

    if (opts.dryRun) throw new Rollback(result);
    await recordAudit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "zoho_import.module",
      entityType: "tenant",
      entityId: null,
      meta: { source: `zoho_${module}`, totalRows: records.length, created: result.created, updated: result.updated, already: result.already, skipped: result.skippedByReason },
    });
    return result;
  };

  try {
    if (opts.tx) return await run(opts.tx);
    return await withTenant(actor.tenantId, run);
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}
