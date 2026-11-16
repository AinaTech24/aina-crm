/**
 * Import a Zoho CRM Contacts export as clients — the preview and the import
 * are the SAME code: a preview runs everything in the transaction and then
 * rolls it back, so the counts it shows are the counts the import will give.
 *
 *  - A client is found again by its Zoho Record Id (a second run updates,
 *    never duplicates), else by a PAN exactly one live client holds.
 *  - An existing client is never overwritten: only its EMPTY fields are
 *    filled, custom fields and Cross-sell are merged, and a later last
 *    meeting date wins.
 *  - Contact Owner must be a user of the firm. The import refuses to start
 *    while an owner has no user, unless the person chose to take those clients
 *    themselves.
 *  - Family Owner builds the households: the head's family (new, FAM-####, or
 *    the one they already head) takes every member not already in another
 *    family; members take the head's address and the family's review
 *    frequency (the firm's rule, lib/families/shared-details.ts). A client who
 *    is their own family owner with nobody else is not given a family.
 *  - A risk profile from Zoho is recorded PROVISIONAL: Zoho does not say when
 *    or how the client signed it, so it does not pass the 12-month confirmed
 *    profile gate a proposal needs.
 *  - Nothing is sent and no workflow starts: no event is written.
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { customFieldDefs, families, investors } from "@/db/schema";
import { healthFields } from "@/lib/investors/health";
import { applyRiskCategory } from "@/lib/risk-profile/apply";
import { familyHealthFields } from "@/lib/families/health";
import { loadFamilySettings } from "@/lib/families/master";
import { familyNameForHead } from "@/lib/families/naming";
import { familyDetailsFromHead } from "@/lib/families/from-head";
import { nextFamilyCode } from "@/lib/families/code";
import { applyFamilySharedDetails } from "@/lib/families/shared-details";
import { recomputeFamilyHealth } from "@/lib/families/health-persist";
import { onClientFamilyMapped } from "@/lib/families/journey";
import { HEAD_ROLE } from "@/lib/families/roles";
import { CONTACT_CUSTOM_FIELDS, IGNORED_CONTACT_COLUMNS, ZOHO_ID_FIELD, mapZohoContact, ownerKey, type MappedContact } from "./contacts";
import { ZohoFileError } from "./workbook";

export type ImportActor = { tenantId: string; userId: string; branchId: string | null; roles: string[] };

export type OwnerLine = { owner: string; clients: number; user: { id: string; name: string } | null };

export type ContactImportResult = {
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  skipped: Array<{ row: number; name: string; reason: string }>;
  owners: OwnerLine[];
  families: { created: number; joinedExisting: number; membersLinked: number; inAnotherFamily: number; headMissing: number; aloneNotCreated: number };
  referralsLinked: number;
  customFieldsCreated: string[];
  crossSellClients: number;
  riskProfiles: number;
  minors: number;
  values: { label: string; items: Array<{ value: string; to: string; count: number }> }[];
  warnings: Array<{ row: number; name: string; message: string }>;
  ignoredColumns: Array<{ column: string; reason: string }>;
  unusedColumns: string[];
};

class Rollback extends Error {
  constructor(public result: ContactImportResult) {
    super("dry run");
  }
}

const HANDLED_COLUMNS = new Set([
  "Record Id", "Contact Owner", "Email", "Mobile", "Date of Birth", "Contact Name", "Mailing Street", "Mailing City",
  "Other City", "Mailing State", "Mailing Zip", "Mailing Country", "Description", "Profession", "Pan Card No",
  "Date of Onboarding", "Company Name", "Family Owner.id", "Family Owner", "Nominee Details", "Nominee Date of Birth",
  "Nominee Relation", "CAN/IIN No", "Adhaar Card", "Client Category", "Referal Client Name.id", "Referal Client Name",
  "Last Meeting Date", "Next Meeting Date", "Review Type", "Risk Profile", "Guardian Name", "Family or Individual",
  ...CONTACT_CUSTOM_FIELDS.map((f) => f.column),
]);

export async function importZohoContacts(
  actor: ImportActor,
  headers: string[],
  rows: Record<string, unknown>[],
  opts: { dryRun: boolean; unmatchedOwnersToMe: boolean; now?: Date; /** Run inside this transaction (tenant already set) — tests. */ tx?: Tx }
): Promise<ContactImportResult> {
  const now = opts.now ?? new Date();
  const mapped = rows.map((r) => mapZohoContact(r, now));

  const run = async (tx: Tx): Promise<ContactImportResult> => {
    const result: ContactImportResult = {
      dryRun: opts.dryRun,
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped: [],
      owners: [],
      families: { created: 0, joinedExisting: 0, membersLinked: 0, inAnotherFamily: 0, headMissing: 0, aloneNotCreated: 0 },
      referralsLinked: 0,
      customFieldsCreated: [],
      crossSellClients: 0,
      riskProfiles: 0,
      minors: 0,
      values: valueSummaries(rows, mapped),
      warnings: [],
      ignoredColumns: headers.filter((h) => IGNORED_CONTACT_COLUMNS[h]).map((h) => ({ column: h, reason: IGNORED_CONTACT_COLUMNS[h] })),
      unusedColumns: headers.filter((h) => h && !HANDLED_COLUMNS.has(h) && !IGNORED_CONTACT_COLUMNS[h]),
    };

    // ── Owners → users ───────────────────────────────────────────────
    const users = (await tx.execute(sql`
      SELECT id, name, email, branch_id FROM users
       WHERE tenant_id = ${actor.tenantId}::uuid AND status <> 'offboarded'
    `)).rows as Array<{ id: string; name: string; email: string; branch_id: string | null }>;
    const userByKey = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.name) userByKey.set(ownerKey(u.name), u);
      if (u.email) userByKey.set(ownerKey(u.email), u);
    }
    const ownerCounts = new Map<string, number>();
    for (const m of mapped) ownerCounts.set(m.ownerText, (ownerCounts.get(m.ownerText) ?? 0) + 1);
    result.owners = [...ownerCounts.entries()]
      .map(([owner, clients]) => {
        const u = owner ? userByKey.get(ownerKey(owner)) : undefined;
        return { owner, clients, user: u ? { id: u.id, name: u.name } : null };
      })
      .sort((a, b) => b.clients - a.clients);
    const unmatched = result.owners.filter((o) => o.owner && !o.user);
    if (unmatched.length && !opts.dryRun && !opts.unmatchedOwnersToMe) {
      throw new ZohoFileError(`Create these users first (or choose to take their clients yourself): ${unmatched.map((o) => o.owner).join(", ")}.`);
    }
    const me = users.find((u) => u.id === actor.userId);
    const ownerOf = (m: MappedContact) => (m.ownerText ? userByKey.get(ownerKey(m.ownerText)) : undefined) ?? me ?? null;

    // ── Custom fields this file needs ───────────────────────────────
    const usedKeys = new Set<string>();
    for (const m of mapped) for (const k of Object.keys(m.custom)) usedKeys.add(k);
    usedKeys.add(ZOHO_ID_FIELD.key);
    const defs = (await tx.execute(sql`
      SELECT key, sort_order FROM custom_field_defs WHERE tenant_id = ${actor.tenantId}::uuid AND entity = 'investor'
    `)).rows as Array<{ key: string; sort_order: number }>;
    const haveKey = new Set(defs.map((d) => d.key));
    let sortOrder = defs.reduce((mx, d) => Math.max(mx, Number(d.sort_order) || 0), 0);
    for (const f of CONTACT_CUSTOM_FIELDS) {
      if (!usedKeys.has(f.key) || haveKey.has(f.key)) continue;
      await tx.insert(customFieldDefs).values({
        tenantId: actor.tenantId,
        entity: "investor",
        key: f.key,
        label: f.label,
        type: f.type,
        options: null,
        required: false,
        sortOrder: ++sortOrder,
        createdBy: actor.userId,
      });
      result.customFieldsCreated.push(f.label);
    }

    // ── Clients already in the CRM ──────────────────────────────────
    const existing = (await tx.execute(sql`
      SELECT id, name, pan, rm_id, family_id, risk_profile,
             custom_fields->>${ZOHO_ID_FIELD.key} AS zoho_id
        FROM investors
       WHERE tenant_id = ${actor.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
    `)).rows as Array<{ id: string; name: string; pan: string | null; rm_id: string | null; family_id: string | null; risk_profile: string | null; zoho_id: string | null }>;
    const byZoho = new Map<string, (typeof existing)[number]>();
    const panHolders = new Map<string, Array<(typeof existing)[number]>>();
    for (const e of existing) {
      if (e.zoho_id) byZoho.set(e.zoho_id, e);
      if (e.pan) panHolders.set(e.pan, [...(panHolders.get(e.pan) ?? []), e]);
    }

    /** Zoho id → the CRM client it became, for families, referrals and meetings. */
    const clientOfZoho = new Map<string, { id: string; name: string }>();
    for (const e of existing) if (e.zoho_id) clientOfZoho.set(e.zoho_id, { id: e.id, name: e.name });
    const seenZoho = new Set<string>();

    for (let i = 0; i < mapped.length; i++) {
      const m = mapped[i];
      const rowNo = i + 2; // spreadsheet row (header is row 1)
      for (const w of m.warnings) if (result.warnings.length < 500) result.warnings.push({ row: rowNo, name: m.name, message: w });
      if (!m.name) {
        result.skipped.push({ row: rowNo, name: m.zohoId || "(blank)", reason: "No contact name" });
        continue;
      }
      if (m.zohoId && seenZoho.has(m.zohoId)) {
        result.skipped.push({ row: rowNo, name: m.name, reason: "Same Record Id as an earlier row" });
        continue;
      }
      if (m.zohoId) seenZoho.add(m.zohoId);
      if (!m.zohoId && result.warnings.length < 500) {
        result.warnings.push({ row: rowNo, name: m.name, message: "No Record Id — imported, but meetings and families can't be linked to this client" });
      }

      const owner = ownerOf(m);
      const panOwners = m.pan ? panHolders.get(m.pan) : undefined;
      const match = (m.zohoId ? byZoho.get(m.zohoId) : undefined) ?? (panOwners?.length === 1 ? panOwners[0] : undefined);

      try {
        await tx.transaction(async (spRaw) => {
          const sp = spRaw as unknown as Tx;
          if (match) {
            await fillBlanks(sp, actor.tenantId, match.id, m, owner?.id ?? null);
            if (m.riskProfile && !match.risk_profile) {
              await applyRiskCategory({ ...riskArgs(sp, actor, match.id, m), currentCategory: null });
              result.riskProfiles++;
            }
            if (m.zohoId) clientOfZoho.set(m.zohoId, { id: match.id, name: match.name });
            result.updated++;
          } else {
            const id = uuid();
            await sp.insert(investors).values({
              id,
              tenantId: actor.tenantId,
              branchId: owner?.branch_id ?? actor.branchId ?? null,
              rmId: owner?.id ?? actor.userId,
              name: m.name,
              // PAN is optional in the database (migration 0129) though the Drizzle type says NOT NULL.
              pan: m.pan ?? sql`NULL`,
              dedupPan: false,
              email: m.email,
              phone: m.phone,
              whatsappPhone: m.phone,
              dob: m.dob,
              gender: m.gender,
              occupation: m.occupation,
              employerName: m.employerName,
              aadhaarLast4: m.aadhaarLast4,
              address: m.address,
              ...(m.investorCategory ? { investorCategory: m.investorCategory } : {}),
              isMinor: m.isMinor,
              typeDetails: m.isMinor && m.guardianName ? { guardian: { name: m.guardianName.slice(0, 200) } } : {},
              segmentTag: m.segmentTag,
              clientCategory: m.clientCategory,
              householdType: m.householdType,
              familyOwnerName: m.familyOwnerName || null,
              referralClientName: m.referralName || null,
              uccCodes: m.uccCodes,
              nomineeName: m.nominee?.name ?? null,
              nomineeRelation: m.nominee?.relation ?? null,
              nomineeDob: m.nominee?.dob ?? null,
              nominees: m.nominee ? [m.nominee] : [],
              onboardedAt: m.onboardedAt,
              lastReviewAt: m.lastReviewAt,
              nextReviewAt: m.nextReviewAt,
              reviewFrequency: m.reviewFrequency,
              crossSell: Object.keys(m.crossSell).length ? m.crossSell : null,
              customFields: Object.keys(m.custom).length ? m.custom : null,
              notes: m.notes,
              kycStatus: "pending",
              status: "active",
              ...healthFields({ status: "active", kycStatus: "pending" }, now),
            });
            if (m.riskProfile) {
              await applyRiskCategory({ ...riskArgs(sp, actor, id, m), currentCategory: null });
              result.riskProfiles++;
            }
            if (m.zohoId) clientOfZoho.set(m.zohoId, { id, name: m.name });
            result.created++;
          }
        });
        if (Object.keys(m.crossSell).length) result.crossSellClients++;
        if (m.isMinor) result.minors++;
      } catch (err: any) {
        result.skipped.push({ row: rowNo, name: m.name, reason: `Could not be saved: ${String(err?.message ?? err).slice(0, 200)}` });
      }
    }

    // ── Families from Family Owner ──────────────────────────────────
    const groups = new Map<string, string[]>(); // head zoho id → member zoho ids
    for (const m of mapped) {
      if (!m.familyOwnerZohoId || !m.zohoId || !clientOfZoho.has(m.zohoId)) continue;
      const list = groups.get(m.familyOwnerZohoId) ?? [];
      if (m.zohoId !== m.familyOwnerZohoId) list.push(m.zohoId);
      groups.set(m.familyOwnerZohoId, list);
    }
    const settings = groups.size ? await loadFamilySettings(tx, actor.tenantId) : null;
    for (const [headZoho, memberZohos] of groups) {
      const head = clientOfZoho.get(headZoho);
      if (!head) {
        result.families.headMissing += memberZohos.length;
        continue;
      }
      const memberIds = [...new Set(memberZohos.map((z) => clientOfZoho.get(z)!.id))].filter((id) => id !== head.id);
      if (!memberIds.length) {
        result.families.aloneNotCreated++;
        continue;
      }
      const familyId = await headFamily(tx, actor, head, settings!, result);
      if (!familyId) {
        result.families.inAnotherFamily += memberIds.length;
        continue;
      }
      const linked = (await tx.execute(sql`
        UPDATE investors SET family_id = ${familyId}::uuid, updated_at = now()
         WHERE tenant_id = ${actor.tenantId}::uuid
           AND id = ANY(ARRAY[${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)}]::uuid[])
           AND family_id IS NULL
        RETURNING id
      `)).rows.map((r: any) => String(r.id));
      result.families.membersLinked += linked.length;
      result.families.inAnotherFamily += memberIds.length - linked.length;
      if (linked.length) {
        await applyFamilySharedDetails(tx, { tenantId: actor.tenantId, familyId, onlyInvestorIds: linked, actorUserId: actor.userId, reason: "mapped_to_family" });
        for (const id of linked) await onClientFamilyMapped(tx, actor.tenantId, id);
      }
      await recomputeFamilyHealth(tx, familyId, now);
    }

    // ── Referrals: the referring client's CRM name, where none is recorded ──
    for (const m of mapped) {
      if (!m.zohoId || !m.referralZohoId) continue;
      const self = clientOfZoho.get(m.zohoId);
      const ref = clientOfZoho.get(m.referralZohoId);
      if (!self || !ref || ref.id === self.id) continue;
      const r = await tx.execute(sql`
        UPDATE investors SET referral_client_name = ${ref.name}, updated_at = now()
         WHERE id = ${self.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
           AND (referral_client_name IS NULL OR referral_client_name = '' OR referral_client_name = ${m.referralName})
        RETURNING id
      `);
      if (r.rows.length) result.referralsLinked++;
    }

    await recordAudit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "investor.bulk_import",
      entityType: "investor",
      entityId: null,
      meta: {
        source: "zoho_contacts",
        totalRows: rows.length,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped.length,
        families: result.families,
        customFieldsCreated: result.customFieldsCreated,
      },
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

function riskArgs(tx: Tx, actor: ImportActor, investorId: string, m: MappedContact) {
  return {
    tx,
    tenantId: actor.tenantId,
    investorId,
    category: m.riskProfile!,
    createdById: actor.userId,
    signedByName: m.name,
    provisional: true,
    basis: "zoho_import",
    remarks: "Imported from Zoho CRM. Zoho does not record when or how the client signed it — confirm it with the client.",
  };
}

/** Fill only what the CRM client has blank; merge custom fields and Cross-sell. */
async function fillBlanks(tx: Tx, tenantId: string, id: string, m: MappedContact, ownerId: string | null): Promise<void> {
  const txt = (col: string, v: string | null) => (v ? sql`${sql.raw(col)} = COALESCE(NULLIF(${sql.raw(col)}, ''), ${v}),` : sql``);
  const val = (col: string, v: unknown, cast: string) => (v !== null && v !== undefined ? sql`${sql.raw(col)} = COALESCE(${sql.raw(col)}, ${v}::${sql.raw(cast)}),` : sql``);
  const hasAddress = Object.entries(m.address).some(([k, v]) => k !== "country" && v);
  await tx.execute(sql`
    UPDATE investors SET
      ${txt("email", m.email)}
      ${txt("phone", m.phone)}
      ${txt("whatsapp_phone", m.phone)}
      ${txt("pan", m.pan)}
      ${val("dob", m.dob, "date")}
      ${txt("gender", m.gender)}
      ${txt("occupation", m.occupation)}
      ${txt("employer_name", m.employerName)}
      ${txt("aadhaar_last4", m.aadhaarLast4)}
      ${txt("segment_tag", m.segmentTag)}
      ${txt("client_category", m.clientCategory)}
      ${txt("household_type", m.householdType)}
      ${txt("family_owner_name", m.familyOwnerName || null)}
      ${txt("referral_client_name", m.referralName || null)}
      ${txt("review_frequency", m.reviewFrequency)}
      ${txt("notes", m.notes)}
      ${val("onboarded_at", m.onboardedAt?.toISOString() ?? null, "timestamptz")}
      ${val("next_review_at", m.nextReviewAt?.toISOString() ?? null, "timestamptz")}
      ${val("rm_id", ownerId, "uuid")}
      ${m.lastReviewAt ? sql`last_review_at = GREATEST(last_review_at, ${m.lastReviewAt.toISOString()}::timestamptz),` : sql``}
      ${hasAddress
        ? sql`address = CASE WHEN NULLIF(TRIM(COALESCE(address->>'line1', '') || COALESCE(address->>'city', '') || COALESCE(address->>'pincode', '')), '') IS NULL
                             THEN ${JSON.stringify(m.address)}::jsonb ELSE address END,`
        : sql``}
      ${m.uccCodes.length ? sql`ucc_codes = CASE WHEN jsonb_array_length(COALESCE(ucc_codes, '[]'::jsonb)) = 0 THEN ${JSON.stringify(m.uccCodes)}::jsonb ELSE ucc_codes END,` : sql``}
      ${m.nominee
        ? sql`nominee_name = COALESCE(NULLIF(nominee_name, ''), ${m.nominee.name}),
              nominees = CASE WHEN jsonb_array_length(COALESCE(nominees, '[]'::jsonb)) = 0 THEN ${JSON.stringify([m.nominee])}::jsonb ELSE nominees END,`
        : sql``}
      ${Object.keys(m.crossSell).length ? sql`cross_sell = COALESCE(cross_sell, '{}'::jsonb) || ${JSON.stringify(m.crossSell)}::jsonb,` : sql``}
      ${Object.keys(m.custom).length ? sql`custom_fields = ${JSON.stringify(m.custom)}::jsonb || COALESCE(custom_fields, '{}'::jsonb),` : sql``}
      updated_at = now()
     WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
  `);
}

type HeadRow = {
  family_id: string | null;
  rm_id: string | null;
  branch_id: string | null;
  segment_tag: "HNI" | "Affluent" | "Retail" | "NRI" | "Corporate" | null;
  review_frequency: "monthly" | "quarterly" | "half_yearly" | "annual" | null;
  next_review_at: string | Date | null;
  primary_investor_id: string | null;
};

/** The family the head already heads, else a new one built from the head. Null when the head is a member of someone else's family. */
async function headFamily(
  tx: Tx,
  actor: ImportActor,
  head: { id: string; name: string },
  settings: Awaited<ReturnType<typeof loadFamilySettings>>,
  result: ContactImportResult
): Promise<string | null> {
  const h = (await tx.execute(sql`
    SELECT i.family_id, i.rm_id, i.branch_id, i.segment_tag, i.review_frequency, i.next_review_at,
           f.primary_investor_id
      FROM investors i LEFT JOIN families f ON f.id = i.family_id
     WHERE i.id = ${head.id}::uuid AND i.tenant_id = ${actor.tenantId}::uuid
  `)).rows[0] as HeadRow | undefined;
  if (!h) return null;
  if (h.family_id) {
    if (h.primary_investor_id && h.primary_investor_id !== head.id) return null;
    result.families.joinedExisting++;
    return String(h.family_id);
  }
  const id = uuid();
  const details = familyDetailsFromHead({
    head: {
      rmId: h.rm_id ?? null,
      branchId: h.branch_id ?? null,
      segmentTag: h.segment_tag ?? null,
      reviewFrequency: h.review_frequency ?? null,
      nextReviewAt: h.next_review_at ? new Date(h.next_review_at) : null,
    },
    explicit: {},
    creator: { userId: actor.userId, branchId: actor.branchId },
    firmReviewFrequency: settings.defaultReviewFrequency ?? null,
  });
  const familyCode = await nextFamilyCode(tx, actor.tenantId);
  await tx.insert(families).values({
    id,
    tenantId: actor.tenantId,
    branchId: details.branchId,
    headName: head.name,
    familyName: familyNameForHead(head.name, settings.familyNamePattern),
    primaryInvestorId: head.id,
    rmId: details.rmId,
    familyCode,
    familyCategory: details.familyCategory,
    reviewFrequency: details.reviewFrequency,
    firstMeetingDate: details.firstMeetingDate,
    nextReviewAt: details.nextReviewAt,
    notes: "Created by the Zoho CRM import (Family Owner).",
    ...familyHealthFields({ primaryInvestorId: head.id, rmId: details.rmId, lastReviewAt: null, nextReviewAt: details.nextReviewAt }, []),
  });
  await tx.execute(sql`
    UPDATE investors SET family_id = ${id}::uuid, family_role = ${HEAD_ROLE}, updated_at = now()
     WHERE id = ${head.id}::uuid AND tenant_id = ${actor.tenantId}::uuid AND family_id IS NULL
  `);
  await onClientFamilyMapped(tx, actor.tenantId, head.id);
  await recordAudit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "family.create",
    entityType: "family",
    entityId: id,
    after: { headName: head.name, familyCode, source: "zoho_import" },
  });
  result.families.created++;
  return id;
}

/** What each judgement column's values become — shown in the preview. */
function valueSummaries(rows: Record<string, unknown>[], mapped: MappedContact[]): ContactImportResult["values"] {
  const tally = (label: string, col: string, to: (m: MappedContact) => string) => {
    const counts = new Map<string, { to: string; count: number }>();
    rows.forEach((r, i) => {
      const v = String(r[col] ?? "").trim();
      if (!v) return;
      const cur = counts.get(v) ?? { to: to(mapped[i]), count: 0 };
      cur.count++;
      counts.set(v, cur);
    });
    return { label, items: [...counts.entries()].map(([value, x]) => ({ value, ...x })).sort((a, b) => b.count - a.count).slice(0, 30) };
  };
  return [
    tally("Risk Profile", "Risk Profile", (m) => m.riskProfile ? `${m.riskProfile.replace("_", " ")} (provisional)` : "Kept as text (Risk Profile (Zoho))"),
    tally("Client Category", "Client Category", (m) => m.clientCategory ? `Category ${m.clientCategory}` : m.segmentTag ? `Segment ${m.segmentTag}` : "Kept as text"),
    tally("Review Type", "Review Type", (m) => m.reviewFrequency ? m.reviewFrequency.replace("_", " ") : "Kept as text"),
    tally("Family or Individual", "Family or Individual", (m) => m.householdType ? `Household: ${m.householdType}` : "Kept as text"),
  ].filter((s) => s.items.length);
}
