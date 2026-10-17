/**
 * Client merge engine — the ONE place a duplicate client is folded into a
 * survivor. SERVER-ONLY.
 *
 * Three callers, identical semantics:
 *   · POST /api/investors/merge        — an operator merging a pair (source 'manual')
 *   · POST /api/investors/merge/auto   — exact-PAN groups merged unattended (source 'system')
 *   · the N-way "Merge Client" tool     — several losers into one survivor, one call each
 *
 * What a merge does, in one transaction:
 *   1. re-points every child row referencing the loser (auto-discovered from
 *      information_schema: any table with an `investor_id` column, minus a
 *      denylist) to the survivor, RECORDING the moved ids so it can be undone;
 *   2. fixes the special columns the generic pass misses (lead referrals,
 *      family head, activity subject);
 *   3. fills the survivor's blank fields (MERGE_FIELDS) from the loser and
 *      applies the operator's per-field picks;
 *   4. retires the loser (status 'inactive', merged_into_id, provenance) and
 *      ZEROES its cached AUM/SIP so nothing double-counts;
 *   5. logs the merge in investor_merges with everything the un-merge needs;
 *   6. recomputes the survivor's headline figures + health; audits.
 *
 * Extracted from the merge route so the system path cannot drift from the
 * manual one — a "system merge" that moved rows differently from a manual merge
 * would be impossible to un-merge with the same code.
 */

import { GUARDIAN_MOVED_KEY, GUARDIAN_UNLINKED_KEY, auditGuardianChange, isEligibleGuardian, type GuardianCandidateRow } from "@/lib/investors/guardian-link";
import { minorOwnRiskColumns } from "@/lib/risk-profile/own-assessment";
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { isBranchScoped } from "@/lib/leads/access";
import { recordAudit } from "@/lib/audit";
import { recomputeInvestorAum } from "@/lib/finance/aum-persist";
import { recomputeInvestorHealth } from "@/lib/investors/health-persist";

export type MergeSource = "manual" | "system" | "import";

/**
 * Data scope for merging (alias `alias` over investors): a record may be
 * merged / un-merged only by someone who can see it (lib/investors/access),
 * and a branch head locked to a branch only ever merges inside that branch —
 * a merge rewrites both records, so it must never reach across branches.
 */
export async function mergeScopeSql(tx: Tx, session: SessionUser, alias = "i"): Promise<SQL> {
  const scope = await investorScopeSql(tx, session, alias);
  if (!isBranchScoped(session)) return scope;
  return sql`(${scope} AND ${sql.raw(`${alias}.branch_id`)} = ${session.branchId}::uuid)`;
}

/** True when every id is a client of this tenant inside the viewer's merge scope. */
export async function allInMergeScope(tx: Tx, session: SessionUser, ids: string[]): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const scope = await mergeScopeSql(tx, session, "i");
  const r = await tx.execute(sql`
    SELECT count(*)::int AS n FROM investors i
     WHERE i.tenant_id = ${session.tenantId}::uuid
       AND i.id IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})
       AND ${scope}
  `);
  return Number((r.rows[0] as any)?.n ?? 0) === unique.length;
}

/** Above this many moved rows we log counts only and mark the merge irreversible. */
const MOVED_ID_CAP = 20_000;

/** investor_id on these participates in a uniqueness / one-per-investor rule, or
 *  is consent/PII that shouldn't silently move; rows stay on the (inactive) loser. */
const DENYLIST = new Set(["investors", "consents", "communications", "campaigns", "risk_profiles", "onboarding"]);

/**
 * The client fields a merge reconciles — everything that describes the person
 * (profile, contact, address, KYC, bank, nominee, relationship). A blank field
 * on the kept record is filled from a merged one; where both hold a value the
 * operator picks which one the kept record ends up with (fieldOverrides).
 *
 * Deliberately excluded: `pan` (a merge must never change who the surviving
 * record legally is — different PANs are refused outright), family membership
 * (changed from the family page, it re-shapes a household), and everything the
 * CRM computes or records about the merge itself (AUM, SIP book, health,
 * status, merge provenance, timestamps).
 */
export type MergeFieldKind = "text" | "date" | "json" | "user" | "branch";
export const MERGE_FIELDS = [
  // Profile
  { key: "name", label: "Name", group: "Profile", kind: "text" },
  { key: "dob", label: "Date of birth", group: "Profile", kind: "date" },
  { key: "gender", label: "Gender", group: "Profile", kind: "text" },
  { key: "marital_status", label: "Marital status", group: "Profile", kind: "text" },
  { key: "anniversary_date", label: "Anniversary", group: "Profile", kind: "date" },
  { key: "occupation", label: "Occupation", group: "Profile", kind: "text" },
  { key: "employer_name", label: "Employer", group: "Profile", kind: "text" },
  { key: "income_range", label: "Income range", group: "Profile", kind: "text" },
  { key: "tax_status", label: "Tax status", group: "Profile", kind: "text" },
  { key: "residency_status", label: "Residency", group: "Profile", kind: "text" },
  { key: "birth_place", label: "Place of birth", group: "Profile", kind: "text" },
  { key: "mother_name", label: "Mother's name", group: "Profile", kind: "text" },
  { key: "language_pref", label: "Language", group: "Profile", kind: "text" },
  { key: "mode_of_holding", label: "Mode of holding", group: "Profile", kind: "text" },
  // Contact
  { key: "phone", label: "Mobile", group: "Contact", kind: "text" },
  { key: "mobile_relation", label: "Mobile belongs to", group: "Contact", kind: "text" },
  { key: "alternate_phone", label: "Alternate phone", group: "Contact", kind: "text" },
  { key: "whatsapp_phone", label: "WhatsApp number", group: "Contact", kind: "text" },
  { key: "email", label: "Email", group: "Contact", kind: "text" },
  { key: "email_relation", label: "Email belongs to", group: "Contact", kind: "text" },
  { key: "address", label: "Address", group: "Contact", kind: "json" },
  // KYC & codes
  { key: "kyc_status", label: "KYC status", group: "KYC", kind: "text" },
  { key: "name_as_per_pan", label: "Name as per PAN", group: "KYC", kind: "text" },
  { key: "kra_name", label: "KRA", group: "KYC", kind: "text" },
  { key: "ckyc_number", label: "CKYC number", group: "KYC", kind: "text" },
  { key: "pan_aadhaar_link_status", label: "PAN–Aadhaar link", group: "KYC", kind: "text" },
  { key: "aadhaar_last4", label: "Aadhaar (last 4)", group: "KYC", kind: "text" },
  { key: "fatca_status", label: "FATCA", group: "KYC", kind: "text" },
  { key: "bse_ucc_code", label: "BSE UCC", group: "KYC", kind: "text" },
  { key: "nse_can_code", label: "NSE CAN", group: "KYC", kind: "text" },
  // Bank
  { key: "bank_name", label: "Bank", group: "Bank", kind: "text" },
  { key: "bank_account_masked", label: "Account number", group: "Bank", kind: "text" },
  { key: "bank_ifsc", label: "IFSC", group: "Bank", kind: "text" },
  { key: "bank_accounts", label: "Bank accounts", group: "Bank", kind: "json" },
  // Nominee
  { key: "nominee_name", label: "Nominee", group: "Nominee", kind: "text" },
  { key: "nominee_relation", label: "Nominee relation", group: "Nominee", kind: "text" },
  { key: "nominee_dob", label: "Nominee date of birth", group: "Nominee", kind: "date" },
  { key: "nominees", label: "Nominees", group: "Nominee", kind: "json" },
  // Second holder
  { key: "second_holder_first_name", label: "Second holder first name", group: "Second holder", kind: "text" },
  { key: "second_holder_last_name", label: "Second holder last name", group: "Second holder", kind: "text" },
  // Relationship
  { key: "rm_id", label: "Relationship manager", group: "Relationship", kind: "user" },
  { key: "branch_id", label: "Branch", group: "Relationship", kind: "branch" },
  { key: "investor_category", label: "Category", group: "Relationship", kind: "text" },
  { key: "client_category", label: "Client category", group: "Relationship", kind: "text" },
  { key: "relationship_category", label: "Relationship category", group: "Relationship", kind: "text" },
  { key: "review_frequency", label: "Review frequency", group: "Relationship", kind: "text" },
  { key: "notes", label: "Notes", group: "Relationship", kind: "text" },
] as const satisfies ReadonlyArray<{ key: string; label: string; group: string; kind: MergeFieldKind }>;

export type MergeableField = (typeof MERGE_FIELDS)[number]["key"];
export const MERGEABLE_FIELDS: readonly MergeableField[] = MERGE_FIELDS.map((f) => f.key);
export const FIELD_LABELS = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.label])) as Record<MergeableField, string>;

/**
 * The catalog fields this database actually has. Every column above is created
 * by a migration, but a merge must never fail on one that a lagging database
 * lacks — it simply isn't reconciled there.
 */
async function presentMergeFields(tx: Tx) {
  const r = await tx.execute(sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'investors'
  `);
  const cols = new Set((r.rows as Array<{ column_name: string }>).map((x) => x.column_name));
  return MERGE_FIELDS.filter((f) => cols.has(f.key));
}

/** SQL: is column `col` of row alias `a` blank (null, empty text, empty json)? */
function blankSql(a: string, f: { key: string; kind: MergeFieldKind }): SQL {
  const c = sql.raw(`${a}."${f.key}"`);
  if (f.kind === "text") return sql`NULLIF(trim(${c}), '') IS NULL`;
  if (f.kind === "json") return sql`(${c} IS NULL OR ${c} = 'null'::jsonb OR ${c} = '{}'::jsonb OR ${c} = '[]'::jsonb)`;
  return sql`${c} IS NULL`;
}

/** snake_case table name -> something an operator can read. */
export function tableLabel(table: string): string {
  const words = table.replace(/_/g, " ").trim();
  const cased = words.charAt(0).toUpperCase() + words.slice(1);
  return cased
    .replace(/\baum\b/gi, "AUM")
    .replace(/\bsip\b/gi, "SIP")
    .replace(/\bsips\b/gi, "SIPs")
    .replace(/\bkyc\b/gi, "KYC")
    .replace(/\bpan\b/gi, "PAN")
    .replace(/\bnav\b/gi, "NAV")
    .replace(/\brta\b/gi, "RTA");
}

/** Tables carrying investor_id, split into the ones a merge moves and the ones
 *  it deliberately leaves behind. Shared by the merge and its preview so the
 *  two can never describe different things. */
async function investorChildTables(tx: Tx): Promise<{ moves: string[]; stays: string[] }> {
  const cols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'investor_id'
    ORDER BY table_name
  `);
  const all = (cols.rows as Array<{ table_name: string }>).map((r) => r.table_name);
  return {
    moves: all.filter((t) => !DENYLIST.has(t)),
    // "investors" is the record itself, not a child row anyone thinks about.
    stays: all.filter((t) => DENYLIST.has(t) && t !== "investors"),
  };
}

export type MergeInput = {
  tenantId: string;
  survivorId: string;
  loserId: string;
  /** The user performing (or triggering) the merge. Null only for scheduled system runs. */
  byUserId: string | null;
  source: MergeSource;
  /** Matched key ("PAN") or an operator's note — shown in the merged-clients audit. */
  reason?: string | null;
  /** Request metadata for the audit row (ip / user agent), when available. */
  auditMeta?: Record<string, unknown>;
  /**
   * Take these survivor fields from the loser. Without this a merge only fills
   * fields the survivor left BLANK, so when both records hold a value the
   * loser's is discarded silently — including when the loser's is the current
   * one. Only MERGEABLE_FIELDS are honoured.
   */
  fieldOverrides?: Partial<Record<MergeableField, boolean>>;
  /**
   * Proceed even though the two records carry DIFFERENT PANs. A PAN is one
   * legal person, so this normally means two different people and the merge is
   * refused; the caller must consciously override it.
   */
  allowPanMismatch?: boolean;
};

export type MergeError =
  | "one or both clients not found"
  | "a selected record is already merged"
  | "survivor and loser must differ"
  | "different PAN";

export type MergeResult =
  | { ok: true; reassigned: number; skipped: string[]; reversible: boolean }
  | { error: MergeError; survivorPan?: string; loserPan?: string };

export async function mergeInvestors(tx: Tx, input: MergeInput): Promise<MergeResult> {
  const { tenantId, survivorId, loserId, byUserId, source } = input;
  const mergeReason = input.reason?.trim() || null;
  if (survivorId === loserId) return { error: "survivor and loser must differ" };

  const both = await tx.execute(sql`
    SELECT id, name, merged_into_id, status, upper(nullif(trim(pan), '')) AS pan,
           COALESCE(aum::numeric, 0) AS aum,
           COALESCE(active_sip_amount::numeric, 0) AS sip
      FROM investors
     WHERE tenant_id = ${tenantId}::uuid AND id IN (${survivorId}::uuid, ${loserId}::uuid)
  `);
  if (both.rows.length !== 2) return { error: "one or both clients not found" };
  if (both.rows.some((r: any) => r.merged_into_id)) return { error: "a selected record is already merged" };

  // A PAN is one legal person in India. Two records holding DIFFERENT PANs are
  // two different people, and folding one into the other moves their folios and
  // transactions onto a stranger — the one mistake this tool must not make
  // quietly. Refuse unless the caller has explicitly acknowledged it.
  const survivorPan = (both.rows as any[]).find((r) => String(r.id) === survivorId)?.pan ?? null;
  const loserPanValue = (both.rows as any[]).find((r) => String(r.id) === loserId)?.pan ?? null;
  if (survivorPan && loserPanValue && survivorPan !== loserPanValue && !input.allowPanMismatch) {
    return { error: "different PAN", survivorPan, loserPan: loserPanValue };
  }

  // Snapshot the loser as it stands — its aum / sip are zeroed below, so
  // without this an un-merge could only restore the record at 0.
  const loserRow = (both.rows as any[]).find((r) => String(r.id) === loserId);
  const loserAum = Number(loserRow?.aum ?? 0);
  const loserSip = Number(loserRow?.sip ?? 0);
  const loserStatus = loserRow?.status ?? null;

  // Tables that carry a tenant_id — a cheap second line of defence on the reassignment.
  const tcols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
  `);
  const hasTenant = new Set((tcols.rows as Array<{ table_name: string }>).map((r) => r.table_name));
  const tf = (table: string) => (hasTenant.has(table) ? sql` AND tenant_id = ${tenantId}::uuid` : sql``);

  // Child tables that reference investor_id, and which of them have an `id` we
  // can RETURN (needed to record exactly what moved). The discovery is shared
  // with previewMerge so the preview can't advertise a different set.
  const { moves: moveTables } = await investorChildTables(tx);
  const idCols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id'
  `);
  const hasId = new Set((idCols.rows as Array<{ table_name: string }>).map((r) => r.table_name));

  let reassigned = 0;
  const skipped: string[] = [];
  const moved: Record<string, string[]> = {};
  const movedCounts: Record<string, number> = {};
  let movedIdTotal = 0;
  let reversible = true;

  for (const tbl of moveTables) {
    // Per-table SAVEPOINT: a uniqueness collision skips THAT table (its rows
    // stay on the inactive loser) instead of aborting the whole merge.
    await tx.execute(sql`SAVEPOINT merge_child`);
    try {
      const canReturn = hasId.has(tbl);
      const r = await tx.execute(
        canReturn
          ? sql`UPDATE ${sql.raw(`"${tbl}"`)} SET investor_id = ${survivorId}::uuid WHERE investor_id = ${loserId}::uuid${tf(tbl)} RETURNING id`
          : sql`UPDATE ${sql.raw(`"${tbl}"`)} SET investor_id = ${survivorId}::uuid WHERE investor_id = ${loserId}::uuid${tf(tbl)}`
      );
      const ids = canReturn ? (r.rows as Array<{ id: string }>).map((x) => String(x.id)) : [];
      const n = canReturn ? ids.length : ((r as any).rowCount ?? 0);
      reassigned += n;
      if (!canReturn && n > 0) reversible = false;
      if (n > 0) {
        movedCounts[tbl] = n;
        if (movedIdTotal + ids.length <= MOVED_ID_CAP) {
          moved[tbl] = ids;
          movedIdTotal += ids.length;
        } else {
          reversible = false;
        }
      }
      await tx.execute(sql`RELEASE SAVEPOINT merge_child`);
    } catch {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT merge_child`);
      skipped.push(tbl);
    }
  }

  // Special columns the generic pass misses.
  await tx.execute(sql`UPDATE leads SET referred_by_investor_id = ${survivorId}::uuid WHERE referred_by_investor_id = ${loserId}::uuid${tf("leads")}`);
  await tx.execute(sql`UPDATE leads SET converted_investor_id = ${survivorId}::uuid WHERE converted_investor_id = ${loserId}::uuid${tf("leads")}`);
  // A family headed by the loser is headed by the survivor only if the
  // survivor is IN that family; otherwise it has no head until someone picks
  // one (it used to point at a person who belonged to another family).
  await tx.execute(sql`
    UPDATE families f
       SET primary_investor_id = CASE
             WHEN EXISTS (SELECT 1 FROM investors s WHERE s.id = ${survivorId}::uuid AND s.family_id = f.id)
             THEN ${survivorId}::uuid ELSE NULL END
     WHERE f.primary_investor_id = ${loserId}::uuid${tf("families")}`);
  await tx.execute(sql`UPDATE activities SET subject_id = ${survivorId}::uuid WHERE subject_type = 'investor' AND subject_id = ${loserId}::uuid${tf("activities")}`);

  // A minor's guardian link follows the person (G-1). The merge says loser and
  // survivor are ONE person, so a minor linked to the retired loser now points
  // at the survivor — if the survivor can be a guardian at all (a live adult
  // individual, lib/investors/guardian-link.ts); otherwise the link is removed
  // rather than left on a retired record. Both are recorded so un-merge puts
  // them back, and each minor's change is audited. The minor's risk profile
  // then follows the survivor's (migration 0234).
  const survivorRow = (await tx.execute(sql`
    SELECT investor_category, is_minor, dob, pan, status, deleted_at, NULL::uuid AS merged_into_id
      FROM investors WHERE id = ${survivorId}::uuid AND tenant_id = ${tenantId}::uuid`)).rows[0] as GuardianCandidateRow | undefined;
  const survivorMayGuard = !!survivorRow && isEligibleGuardian(survivorRow);
  const guarded = (await tx.execute(sql`
    UPDATE investors SET guardian_investor_id = ${survivorMayGuard ? sql`${survivorId}::uuid` : sql`NULL`}, updated_at = now()
     WHERE guardian_investor_id = ${loserId}::uuid AND tenant_id = ${tenantId}::uuid AND id <> ${survivorId}::uuid
     RETURNING id::text AS id`)).rows as Array<{ id: string }>;
  if (guarded.length) {
    // Keys that are not table names: the un-merge loop skips them and restores
    // them explicitly (SAFE_TABLE in the unmerge route).
    moved[survivorMayGuard ? GUARDIAN_MOVED_KEY : GUARDIAN_UNLINKED_KEY] = guarded.map((r) => r.id);
    movedCounts[survivorMayGuard ? GUARDIAN_MOVED_KEY : GUARDIAN_UNLINKED_KEY] = guarded.length;
    for (const m of guarded) {
      if (!survivorMayGuard) {
        // The link is gone, so the old guardian's copied profile goes too: the
        // minor's own latest assessment, else none (0234 copies only while a
        // link exists). Un-merge relinks, and 0234 copies the profile back.
        const own = await minorOwnRiskColumns(tx, tenantId, m.id);
        await tx.execute(sql`
          UPDATE investors SET risk_profile = ${own.riskProfile}, risk_profile_score = ${own.riskProfileScore},
                 risk_profile_signed_at = ${own.riskProfileSignedAt}, risk_profile_provisional = ${own.riskProfileProvisional}
           WHERE id = ${m.id}::uuid AND tenant_id = ${tenantId}::uuid`);
      }
      await auditGuardianChange(tx, {
        tenantId, actorUserId: byUserId ?? null, minorId: m.id,
        before: loserId, after: survivorMayGuard ? survivorId : null, via: "merge",
        meta: { survivorId, loserId },
      });
    }
  }

  // Snapshot the survivor's reconciled fields BEFORE anything writes to them.
  // The fill below (and any operator pick) changes the surviving record, and
  // un-merge has to be able to put it back exactly as it was.
  const fields = await presentMergeFields(tx);
  const keyList = sql.join(fields.map((f) => sql`${f.key}`), sql`, `);
  const survivorBefore = (
    (
      await tx.execute(sql`
        SELECT (SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(i)) AS e(k, v) WHERE k IN (${keyList})) AS before
          FROM investors i WHERE i.id = ${survivorId}::uuid
      `)
    ).rows[0] as { before: Record<string, unknown> | null } | undefined
  )?.before ?? null;

  // Fill the survivor's blank fields from the loser, then apply the operator's
  // explicit picks, which OVERWRITE a value the survivor already had (a fill
  // can only fill blanks). A pick falls back to the survivor's own value when
  // the loser's is blank, so it can never blank a field out.
  const picked = new Set(
    (Object.keys(input.fieldOverrides ?? {}) as MergeableField[]).filter(
      (f) => input.fieldOverrides?.[f] && (MERGEABLE_FIELDS as readonly string[]).includes(f)
    )
  );
  if (fields.length) {
    const assignments = fields.map((f) => {
      const col = sql.raw(`"${f.key}"`);
      const s = sql.raw(`s."${f.key}"`);
      const l = sql.raw(`l."${f.key}"`);
      return picked.has(f.key)
        ? sql`${col} = CASE WHEN ${blankSql("l", f)} THEN ${s} ELSE ${l} END`
        : sql`${col} = CASE WHEN ${blankSql("s", f)} THEN ${l} ELSE ${s} END`;
    });
    await tx.execute(sql`
      UPDATE investors s SET ${sql.join(assignments, sql`, `)}, updated_at = now()
      FROM investors l
      WHERE s.id = ${survivorId}::uuid AND l.id = ${loserId}::uuid
    `);
  }

  // Retire the loser and ZERO its cached headline figures — its folios and SIPs
  // now belong to the survivor, so leaving them would double-count the money.
  await tx.execute(sql`
    UPDATE investors
       SET status = 'inactive', merged_into_id = ${survivorId}::uuid, merged_at = now(),
           merged_by_id = ${byUserId ? sql`${byUserId}::uuid` : sql`NULL`}, merge_source = ${source},
           merge_reason = ${mergeReason},
           aum = 0, active_sip_amount = 0, updated_at = now()
     WHERE id = ${loserId}::uuid
  `);

  // Log the merge with everything needed to undo it.
  await tx.execute(sql`
    INSERT INTO investor_merges (
      tenant_id, survivor_id, loser_id, merged_by_id, source, reason,
      loser_aum, loser_sip_amount, loser_status,
      moved, moved_counts, reversible, survivor_before
    ) VALUES (
      ${tenantId}::uuid, ${survivorId}::uuid, ${loserId}::uuid,
      ${byUserId ? sql`${byUserId}::uuid` : sql`NULL`}, ${source}, ${mergeReason},
      ${loserAum}, ${loserSip}, ${loserStatus},
      ${JSON.stringify(moved)}::jsonb, ${JSON.stringify(movedCounts)}::jsonb, ${reversible},
      ${survivorBefore ? sql`${JSON.stringify(survivorBefore)}::jsonb` : sql`NULL`}
    )
  `);

  // The survivor just absorbed folios / transactions / SIPs — refresh its
  // cached figures + health so lists and KPIs don't lag until the nightly run.
  await recomputeInvestorAum(tx, survivorId);
  await recomputeInvestorHealth(tx, survivorId);

  await recordAudit(tx, {
    tenantId,
    actorUserId: byUserId ?? undefined,
    action: source === "manual" ? "investor.merge" : "investor.merge.system",
    entityType: "investor",
    entityId: survivorId,
    after: { survivorId, loserId, source, reason: mergeReason, childRowsReassigned: reassigned, skippedTables: skipped } as any,
    ...(input.auditMeta ?? {}),
  } as any);

  return { ok: true, reassigned, skipped, reversible };
}

/* ─────────────────────────── Dry-run preview ─────────────────────────── */

/** A json field (address, nominees, bank accounts) as one readable line. */
function jsonSummary(v: unknown): string {
  const flat = (o: unknown): string => {
    if (o == null) return "";
    if (typeof o !== "object") return String(o).trim();
    // Postgres returns jsonb keys shortest-first ("city" before "line1"), so
    // put the parts of an address back in reading order.
    const ORDER = ["line1", "line2", "line3", "address", "city", "district", "state", "pincode", "pin", "country"];
    const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
    return Object.entries(o as Record<string, unknown>)
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([, x]) => x)
      .filter((x) => x != null && typeof x !== "object" && String(x).trim() !== "")
      .map((x) => String(x).trim())
      .join(", ");
  };
  if (Array.isArray(v)) return v.map(flat).filter(Boolean).join(" · ");
  return flat(v);
}

export type MergePreview = {
  survivor: { id: string; name: string; pan: string | null };
  losers: Array<{ id: string; name: string; pan: string | null }>;
  /** Child rows that WILL be re-pointed at the survivor. */
  moves: Array<{ table: string; label: string; count: number }>;
  /** Child rows deliberately left on the retired record (see DENYLIST). */
  stays: Array<{ table: string; label: string; count: number }>;
  /** Every reconciled field, with each record's value (survivor first), whether
   *  they disagree, and whose value the kept record gets if nobody chooses. */
  fields: Array<{
    field: MergeableField;
    label: string;
    group: string;
    values: Array<{ id: string; value: string }>;
    differs: boolean;
    defaultId: string | null;
  }>;
  /** Fields where the records disagree and the operator must choose. */
  conflicts: Array<{
    field: MergeableField;
    label: string;
    survivorValue: string | null;
    loserValues: Array<{ id: string; name: string; value: string }>;
  }>;
  /** Non-empty PANs that differ — almost always two different people. */
  panMismatch: boolean;
  totals: { moving: number; staying: number };
};

/**
 * What a merge would do, without doing it.
 *
 * Runs the SAME table discovery and denylist as mergeInvestors, so the preview
 * cannot promise something the merge won't do. Counting is a `count(*)` per
 * child table for the losers — cheap enough for a handful of records, and the
 * only honest way to say "12 transactions and 3 folios move".
 */
export async function previewMerge(
  tx: Tx,
  args: { tenantId: string; survivorId: string; loserIds: string[] }
): Promise<MergePreview | { error: "one or both clients not found" }> {
  const { tenantId, survivorId } = args;
  const loserIds = args.loserIds.filter((id) => id !== survivorId);
  const ids = [survivorId, ...loserIds];

  const fieldDefs = await presentMergeFields(tx);
  const keyList = sql.join(fieldDefs.map((f) => sql`${f.key}`), sql`, `);
  const people = await tx.execute(sql`
    SELECT i.id, i.name, upper(nullif(trim(i.pan), '')) AS pan,
           (SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(i)) AS e(k, v) WHERE k IN (${keyList})) AS fields
      FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid
       AND i.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
  `);
  const byId = new Map((people.rows as any[]).map((r) => [String(r.id), r]));
  const survivorRow = byId.get(survivorId);
  if (!survivorRow || loserIds.some((id) => !byId.has(id))) return { error: "one or both clients not found" };

  // RM and branch are ids — show the operator names.
  const refIds = new Set<string>();
  for (const r of people.rows as any[]) {
    for (const f of fieldDefs) if ((f.kind === "user" || f.kind === "branch") && r.fields?.[f.key]) refIds.add(String(r.fields[f.key]));
  }
  const names = new Map<string, string>();
  if (refIds.size) {
    const list = sql.join([...refIds].map((i) => sql`${i}::uuid`), sql`, `);
    const nr = await tx.execute(sql`
      SELECT id, name FROM users WHERE tenant_id = ${tenantId}::uuid AND id IN (${list})
      UNION ALL
      SELECT id, name FROM branches WHERE tenant_id = ${tenantId}::uuid AND id IN (${list})
    `);
    for (const r of nr.rows as Array<{ id: string; name: string | null }>) names.set(String(r.id), r.name ?? "—");
  }
  const display = (f: { kind: MergeFieldKind }, v: unknown): string => {
    if (v == null) return "";
    if (f.kind === "user" || f.kind === "branch") return names.get(String(v)) ?? "(no longer on the team)";
    if (f.kind === "json") return jsonSummary(v);
    return String(v).trim();
  };
  const sameKey = (f: { kind: MergeFieldKind }, v: unknown) =>
    f.kind === "json" ? (jsonSummary(v) ? JSON.stringify(v) : "") : display(f, v).toLowerCase();

  const fields: MergePreview["fields"] = fieldDefs.map((f) => {
    const raw = ids.map((id) => byId.get(id)?.fields?.[f.key] ?? null);
    const values = ids.map((id, n) => ({ id, value: display(f, raw[n]) }));
    const keys = new Set(raw.map((v) => sameKey(f, v)).filter(Boolean));
    // What happens with no choice: the kept record's value, else the first
    // merged record that has one (the order the merges run in).
    const defaultId = values.find((v) => v.value)?.id ?? null;
    return { field: f.key, label: f.label, group: f.group, values, differs: keys.size > 1, defaultId };
  });

  const { moves: moveTables, stays: stayTables } = await investorChildTables(tx);

  const tcols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
  `);
  const hasTenant = new Set((tcols.rows as Array<{ table_name: string }>).map((r) => r.table_name));
  const loserList = sql.join(loserIds.map((i) => sql`${i}::uuid`), sql`, `);

  async function countFor(tables: string[]) {
    const out: Array<{ table: string; label: string; count: number }> = [];
    if (!loserIds.length) return out;
    for (const tbl of tables) {
      try {
        const r = await tx.execute(sql`
          SELECT count(*)::int AS n FROM ${sql.raw(`"${tbl}"`)}
           WHERE investor_id IN (${loserList})
             ${hasTenant.has(tbl) ? sql`AND tenant_id = ${tenantId}::uuid` : sql``}
        `);
        const n = Number((r.rows[0] as any)?.n ?? 0);
        if (n > 0) out.push({ table: tbl, label: tableLabel(tbl), count: n });
      } catch {
        // A table we can't read (permissions, odd shape) simply isn't reported;
        // the merge itself skips it the same way.
      }
    }
    return out.sort((a, b) => b.count - a.count);
  }

  const moves = await countFor(moveTables);
  const stays = await countFor(stayTables);

  // Field disagreements the operator should resolve deliberately: the kept
  // record has a value and a merged one has a different one. (A blank on the
  // kept record is filled automatically.)
  const conflicts: MergePreview["conflicts"] = fields
    .filter((f) => f.differs && f.values[0].value)
    .map((f) => ({
      field: f.field,
      label: f.label,
      survivorValue: f.values[0].value,
      loserValues: f.values
        .slice(1)
        .filter((v) => v.value && v.value.toLowerCase() !== f.values[0].value.toLowerCase())
        .map((v) => ({ id: v.id, name: String(byId.get(v.id)?.name ?? "—"), value: v.value })),
    }))
    .filter((c) => c.loserValues.length > 0);

  const survivorPan = survivorRow.pan ?? null;
  const panMismatch = loserIds.some((id) => {
    const p = byId.get(id)?.pan ?? null;
    return !!survivorPan && !!p && p !== survivorPan;
  });

  return {
    survivor: { id: survivorId, name: String(survivorRow.name ?? "—"), pan: survivorPan },
    losers: loserIds.map((id) => ({
      id,
      name: String(byId.get(id)?.name ?? "—"),
      pan: byId.get(id)?.pan ?? null,
    })),
    moves,
    stays,
    fields,
    conflicts,
    panMismatch,
    totals: {
      moving: moves.reduce((n, m) => n + m.count, 0),
      staying: stays.reduce((n, m) => n + m.count, 0),
    },
  };
}

/**
 * Exact-PAN duplicate groups among LIVE clients (not merged, not closed),
 * excluding any pair the firm has marked "not duplicates". The only rule the
 * system is allowed to merge on unattended: a PAN is one legal person in
 * India, so two live records with the same PAN are the same client by
 * definition — phone / email / address are shared across a household and
 * must stay human-reviewed.
 *
 * Survivor per group = the record with the most AUM, then the most folios,
 * then the oldest — the one with the most to lose if retired.
 */
export type PanGroup = {
  pan: string;
  survivorId: string;
  survivorName: string;
  losers: Array<{ id: string; name: string }>;
};

/** `scope` — mergeScopeSql over alias `i`; default unrestricted. */
export async function loadExactPanGroups(tx: Tx, tenantId: string, cap = 500, scope: SQL = sql`TRUE`): Promise<PanGroup[]> {
  const r = await tx.execute(sql`
    WITH live AS (
      SELECT i.id, i.name, upper(trim(i.pan)) AS pan, i.created_at,
             COALESCE(i.aum::numeric, 0) AS aum,
             (SELECT count(*) FROM folios f WHERE f.investor_id = i.id)::int AS folios
        FROM investors i
       WHERE i.tenant_id = ${tenantId}::uuid
         AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status <> 'closed'
         AND NULLIF(trim(i.pan), '') IS NOT NULL
         AND ${scope}
    ),
    dup AS (SELECT pan FROM live GROUP BY pan HAVING count(*) > 1)
    SELECT l.id, l.name, l.pan, l.aum, l.folios, l.created_at
      FROM live l
     WHERE l.pan IN (SELECT pan FROM dup)
     ORDER BY l.pan, l.aum DESC, l.folios DESC, l.created_at ASC
     LIMIT ${cap}
  `);
  const ignored = await tx.execute(sql`
    SELECT key1_id, key2_id FROM ignored_duplicates
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'client'
  `);
  const ignoredPairs = new Set(
    (ignored.rows as Array<{ key1_id: string; key2_id: string }>).map((p) =>
      [String(p.key1_id), String(p.key2_id)].sort().join("|")
    )
  );
  const isIgnored = (a: string, b: string) => ignoredPairs.has([a, b].sort().join("|"));

  const byPan = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of r.rows as any[]) {
    const arr = byPan.get(row.pan) ?? [];
    arr.push({ id: String(row.id), name: row.name ?? "—" });
    byPan.set(row.pan, arr);
  }
  const groups: PanGroup[] = [];
  for (const [pan, members] of byPan) {
    if (members.length < 2) continue;
    const [survivor, ...rest] = members; // already ordered: biggest book first
    const losers = rest.filter((m) => !isIgnored(survivor.id, m.id));
    if (!losers.length) continue;
    groups.push({ pan, survivorId: survivor.id, survivorName: survivor.name, losers });
  }
  return groups;
}
