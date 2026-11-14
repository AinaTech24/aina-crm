import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/import/commit  Body: { mapping, rows }
 *
 * Each row is held to the New lead rules (audit L19):
 *   - phone / email are stored with their normalised twins (the duplicate
 *     check and every lookup read those), as POST /api/leads does;
 *   - a PAN that is not a PAN rejects the row, with the reason;
 *   - a row whose phone, email or PAN is already a CLIENT, an existing lead,
 *     or an earlier row of the same file is skipped with the reason — never a
 *     silent duplicate (no name or owner of the match is shown);
 *   - the owner is the row's Owner column (a team member's email or name)
 *     when it names an active member the importer may assign to, else the
 *     firm's Assignment Rules / least-loaded pick (lib/leads/ownership.ts) —
 *     never simply the importer; the lead's branch is its owner's, and each
 *     owner is told how many leads they were given.
 * Every row runs in its own savepoint, so one bad row never aborts the rest.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { scoreFields } from "@/lib/leads/score";
import {
  LEAD_PHASE_STAGES,
  normalizeEmail,
  normalizeLeadSource,
  normalizeLeadStage,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";
import { isValidPan } from "@/lib/leads/contact-rules";
import { isBranchScoped } from "@/lib/leads/access";
import { autoAssignLeadOwner } from "@/lib/leads/ownership";
import { createNotification } from "@/lib/notifications/create";
import { startJourneyAt } from "@/lib/blueprints/journey-access";
import { loadCustomFieldDefs, sanitizeCustomFields } from "@/lib/custom-fields/values";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  // Bound the payload: the import runs as one transaction, so an unbounded
  // array would hold a write lock + memory for minutes. 10k/upload is well above
  // a normal book migration; larger imports should be split.
  rows: z.array(z.record(z.string(), z.any())).max(10000),
});

const VALID_AUM = new Set(["under_10l", "10l_50l", "50l_2cr", "hni_2cr_plus"]);
const VALID_LEAD_TYPE = new Set(["individual", "hni", "nri", "huf", "corporate", "minor"]);

const numOrNull = (v: string) => { const n = Number(String(v).replace(/[,₹\s]/g, "")); return Number.isFinite(n) && n >= 0 ? n : null; };
/** Split a "a, b; c" cell into a clean string array (for jsonb columns). */
const listOrNull = (v: string): string[] | null => {
  const parts = String(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return parts.length ? parts : null;
};
/** Lenient date → ISO yyyy-mm-dd (DD-MM-YYYY, DD/MM/YYYY, Excel serial, ISO). */
function dateOrNull(v: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4,6}$/.test(s)) {
    const serial = parseInt(s, 10);
    if (serial > 0 && serial < 100000) { const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
  }
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let day = +m[1], mon = +m[2], year = +m[3];
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) { const d = new Date(Date.UTC(year, mon - 1, day)); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
    return null;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(parse.data.mapping)) if (our) reverse[our] = src;
    if (!reverse.name) return NextResponse.json({ error: "mapping must include name" }, { status: 400 });

    function pick(row: any, h?: string) {
      if (!h) return "";
      const v = row[h];
      return v === null || v === undefined ? "" : String(v).trim();
    }

    let inserted = 0;
    let skipped = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];
    const skippedRows: Array<{ rowIndex: number; reason: string }> = [];

    await withTenant(session.tenantId, async (tx) => {
      // Firm custom-field definitions — any mapped cf_* column is sanitized + stored.
      const cfDefs = await loadCustomFieldDefs(tx, session.tenantId, "lead");

      // Who is already on file — clients and (live) leads — by the same keys
      // the New lead form's duplicate check uses. Loaded once, not per row.
      const keysOf = (rows: any[]) => ({
        phone: new Set(rows.map((r) => r.phone).filter(Boolean) as string[]),
        email: new Set(rows.map((r) => r.email).filter(Boolean) as string[]),
        pan: new Set(rows.map((r) => r.pan).filter(Boolean) as string[]),
      });
      const clientKeys = keysOf((await tx.execute(sql`
        SELECT NULLIF(right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10), '') AS phone,
               NULLIF(lower(btrim(COALESCE(email, ''))), '') AS email,
               NULLIF(upper(btrim(COALESCE(pan, ''))), '') AS pan
          FROM investors
         WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
      `)).rows as any[]);
      const leadKeys = keysOf((await tx.execute(sql`
        SELECT phone_normalized AS phone, email_normalized AS email, NULLIF(upper(btrim(COALESCE(pan, ''))), '') AS pan
          FROM leads
         WHERE tenant_id = ${session.tenantId}::uuid AND lost_reason IS DISTINCT FROM '__deleted__'
      `)).rows as any[]);
      const dupOf = (keys: ReturnType<typeof keysOf>, k: { phone: string | null; email: string | null; pan: string | null }) =>
        [k.phone && keys.phone.has(k.phone) ? "phone" : null, k.email && keys.email.has(k.email) ? "email" : null, k.pan && keys.pan.has(k.pan) ? "PAN" : null]
          .filter(Boolean) as string[];

      // The team the Owner column may name: active members — a branch-locked
      // importer only their own branch's.
      const members = (await tx.execute(sql`
        SELECT id::text AS id, lower(email) AS email, name, branch_id::text AS branch_id
          FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      `)).rows as Array<{ id: string; email: string | null; name: string | null; branch_id: string | null }>;
      const branchLocked = isBranchScoped(session);
      const findOwner = (raw: string) => {
        const v = raw.trim().toLowerCase();
        if (!v) return null;
        const byEmail = members.filter((m) => m.email === v);
        // "Pooja Shah (RM)" → "pooja shah": the role is not part of the name.
        const byName = members.filter((m) => (m.name ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase() === v);
        const hits = byEmail.length ? byEmail : byName;
        return hits.length === 1 ? hits[0] : null;
      };
      const assignedCount = new Map<string, number>();

      for (let i = 0; i < parse.data.rows.length; i++) {
        const row = parse.data.rows[i];
        const name = pick(row, reverse.name);
        if (!name) {
          errors.push({ rowIndex: i, error: "missing name" });
          continue;
        }
        // The same source vocabulary as the form and the filters (aliases
        // such as "Facebook" or "Google Ads" fold onto it).
        const source = normalizeLeadSource(pick(row, reverse.source));
        // The SOP's own lead stage (legacy names folded onto it); a client
        // stage or "converted" is not something a spreadsheet can make a lead.
        const stageRaw = pick(row, reverse.stage);
        const folded = stageRaw ? normalizeLeadStage(stageRaw) : "new";
        const stage = (LEAD_PHASE_STAGES as readonly string[]).includes(folded) && folded !== "won_lead" ? folded : "new";

        const emailVal = pick(row, reverse.email) || null;
        const phoneVal = pick(row, reverse.phone) || null;
        const panRaw = pick(row, reverse.pan).toUpperCase();
        if (panRaw && !isValidPan(panRaw)) {
          errors.push({ rowIndex: i, error: `invalid PAN "${panRaw.slice(0, 12)}" — 5 letters, 4 digits, 1 letter` });
          continue;
        }
        const keys = { phone: normalizePhoneLast10(phoneVal), email: normalizeEmail(emailVal), pan: panRaw || null };
        const asClient = dupOf(clientKeys, keys);
        if (asClient.length) {
          skipped++;
          skippedRows.push({ rowIndex: i, reason: `already a client (same ${asClient.join(", ")}) — start an opportunity on their record instead` });
          continue;
        }
        const asLead = dupOf(leadKeys, keys);
        if (asLead.length) {
          skipped++;
          skippedRows.push({ rowIndex: i, reason: `already a lead (same ${asLead.join(", ")})` });
          continue;
        }

        // Owner: the row's Owner column, else the assignment rules.
        let ownerId: string | null = null;
        let ownerBranch: string | null = null;
        const ownerRaw = pick(row, reverse.owner);
        if (ownerRaw) {
          const m = findOwner(ownerRaw);
          if (!m) {
            errors.push({ rowIndex: i, error: `owner "${ownerRaw.slice(0, 60)}" is not one active team member (use their email)` });
            continue;
          }
          if (branchLocked && m.branch_id !== session.branchId) {
            errors.push({ rowIndex: i, error: `owner "${ownerRaw.slice(0, 60)}" is outside your branch` });
            continue;
          }
          ownerId = m.id;
          ownerBranch = m.branch_id;
        } else {
          ownerId = (await autoAssignLeadOwner(tx, { tenantId: session.tenantId, source, branchId: session.branchId ?? null })) ?? session.userId;
          ownerBranch = members.find((m) => m.id === ownerId)?.branch_id ?? null;
        }
        const intendedVal = pick(row, reverse.intendedAmount) || null;
        // New-lead-form fields.
        const aumRaw = pick(row, reverse.aumPotential).toLowerCase().replace(/\s+/g, "_");
        const aum = VALID_AUM.has(aumRaw) ? aumRaw : null;
        const ltRaw = pick(row, reverse.leadType).toLowerCase().replace(/\s+/g, "_");
        const leadType = VALID_LEAD_TYPE.has(ltRaw) ? ltRaw : null;
        const interest = listOrNull(pick(row, reverse.interestedIn));
        const occupation = pick(row, reverse.occupation) || null;
        const currentInv = listOrNull(pick(row, reverse.currentInvestments));
        const profile = occupation || currentInv ? { occupation: occupation ?? undefined, currentInvestments: currentInv ?? undefined } : null;
        const tags = listOrNull(pick(row, reverse.tags));
        // Custom fields: read each mapped cf_* column, sanitize against defs.
        const rawCf: Record<string, any> = {};
        for (const d of cfDefs) rawCf[d.key] = pick(row, reverse[d.key]);
        const cleanCf = sanitizeCustomFields(cfDefs, rawCf);
        const cfJson = Object.keys(cleanCf).length ? JSON.stringify(cleanCf) : null;
        // Deterministic initial score from the imported signals.
        const sc = scoreFields({
          source,
          stage,
          intendedAmount: intendedVal,
          email: emailVal,
          phone: phoneVal,
        });

        try {
          const leadId = uuid();
          await tx.transaction(async (sp) => {
          await sp.execute(sql`
            INSERT INTO leads (
              id, tenant_id, branch_id, name, email, email_normalized, phone, phone_normalized, alt_phone, alt_email, pan, city, pincode,
              source, source_campaign, stage, stage_changed_at, score, intended_amount,
              expected_business_amount, aum_potential, lead_type, interest_products, profile,
              referred_by_name, next_follow_up_at, tags,
              lead_score, score_band, scored_at,
              owner_id, notes, custom_fields, created_at, updated_at
            )
            VALUES (
              ${leadId}, ${session.tenantId}, ${ownerBranch ?? session.branchId ?? null},
              ${name},
              ${emailVal}, ${keys.email},
              ${phoneVal}, ${keys.phone},
              ${pick(row, reverse.altPhone) || null},
              ${pick(row, reverse.altEmail) || null},
              ${keys.pan},
              ${pick(row, reverse.city) || null},
              ${pick(row, reverse.pincode) || null},
              ${source}, ${pick(row, reverse.campaignName) || null},
              ${stage}, now(),
              ${pick(row, reverse.score) || "0"},
              ${intendedVal},
              ${numOrNull(pick(row, reverse.expectedBusinessAmount))},
              ${aum}, ${leadType},
              ${interest ? JSON.stringify(interest) : "[]"}::jsonb,
              ${profile ? JSON.stringify(profile) : "{}"}::jsonb,
              ${pick(row, reverse.referredByName) || null},
              ${dateOrNull(pick(row, reverse.nextFollowUpAt))},
              ${tags ? JSON.stringify(tags) : "[]"}::jsonb,
              ${sc.leadScore}, ${sc.scoreBand}, now(),
              ${ownerId},
              ${pick(row, reverse.notes) || null},
              ${cfJson}::jsonb,
              now(), now()
            )
          `);
          // A row imported past "New" starts its journey at that stage, so
          // the board and the stepper agree (audit L9).
          if (stage !== "new") {
            await startJourneyAt(sp as any, session.tenantId, leadId, stage, session.userId);
          }
          });
          inserted++;
          // A later row with the same details is a duplicate of this one.
          if (keys.phone) leadKeys.phone.add(keys.phone);
          if (keys.email) leadKeys.email.add(keys.email);
          if (keys.pan) leadKeys.pan.add(keys.pan);
          if (ownerId && ownerId !== session.userId) assignedCount.set(ownerId, (assignedCount.get(ownerId) ?? 0) + 1);
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err.message ?? "insert failed") });
        }
      }

      // Each owner hears once how many leads came their way.
      for (const [ownerId, n] of assignedCount) {
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: ownerId,
          kind: "lead.assigned",
          title: n === 1 ? "1 new lead imported for you" : `${n} new leads imported for you`,
          body: "From a lead import — they are on your Leads board.",
          linkUrl: "/dashboard/leads?mine=1",
          severity: "info",
          meta: { how: "imported", count: n, assigned_by: session.userId },
        });
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.bulk_import",
        entityType: "lead",
        entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: parse.data.rows.length, skippedRows: skippedRows.slice(0, 200) },
        ...clientMeta,
      });
    });

    return NextResponse.json({ inserted, skipped, errored: errors.length, errors: errors.slice(0, 50), skippedRows: skippedRows.slice(0, 50) });
  } catch (err: any) {
    return handleApiError(err);
  }
}
