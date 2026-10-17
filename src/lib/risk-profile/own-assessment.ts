/**
 * Which risk profile may SUITABILITY rely on for a client (G-1, 2026-10-14)?
 *
 * Migration 0234 copies a linked guardian's risk category, score, signed date
 * and provisional flag onto a minor's `investors` row. On that row the copy is
 * indistinguishable from an assessment of the minor's account: same columns,
 * `provisional` false, the guardian's signing date. No suitability policy in
 * the CRM says a guardian's own profile establishes the suitability of the
 * minor's investments, so until the firm confirms one, the copy is shown as the
 * guardian's but never satisfies a suitability gate on its own.
 *
 *  - Any client who is not a minor: the `investors` row, exactly as before.
 *  - A MINOR (linked to a guardian or not): only an assessment recorded FOR THE
 *    MINOR'S ACCOUNT — the latest `risk_profile_responses` row whose
 *    investor_id is the minor (the questionnaire or the RM's entry, answered by
 *    the guardian on the minor's behalf). None → not profiled. An UNLINKED
 *    minor is included because unlinking (an edit, or a merge into a survivor
 *    that cannot be a guardian) used to leave the old guardian's copy on the
 *    row, where it would read as the minor's own.
 *
 * Read-only: nothing here writes a risk profile or an audit row.
 */
import { sql } from "drizzle-orm";
import { riskExpiresOn, riskExpiresOnSql, riskProfileLapsed } from "./expiry";

export type SuitabilityProfile = {
  category: string | null;
  score: number | null;
  signedAt: string | null;
  provisional: boolean;
  /** YYYY-MM-DD the profile lapses (valid THROUGH it); null with no signed profile.
   *  An adult: lib/risk-profile/expiry.ts on the row. A minor: the own assessment's
   *  stated review / expiry date, else one year after it was signed — never the
   *  guardian's copied dates (0234 / 0236). */
  expiresOn: string | null;
  /** The client is a minor: only their own assessment was read, and whatever
   *  the `investors` row carries (a guardian's copy, current or stale) was
   *  ignored. Callers use this profile's fields instead of the row's. */
  inheritedIgnored: boolean;
};

const iso = (v: unknown) => (v ? new Date(v as string | number | Date).toISOString() : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dayOf = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** A minor's own assessment lapses on its stated review / expiry date (an upload
 *  states one; the questionnaire and RM entry record signed + 1 year), else one
 *  year after it was signed. No signed assessment → null. */
function ownExpiresOn(signedAt: unknown, nextReviewAt: unknown): string | null {
  if (!signedAt) return null;
  return dayOf(nextReviewAt) ?? day(riskExpiresOn({ riskProfileSignedAt: signedAt as any }));
}

export async function suitabilityProfile(tx: any, tenantId: string, investorId: string): Promise<SuitabilityProfile> {
  const inv = (await tx.execute(sql`
    SELECT risk_profile, risk_profile_score, risk_profile_signed_at, COALESCE(risk_profile_provisional, false) AS provisional,
           risk_profile_expires_on, risk_profile_expiry_for, guardian_investor_id, investor_category, is_minor
      FROM investors WHERE id = ${investorId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`)).rows[0] as Record<string, any> | undefined;
  if (!inv) return { category: null, score: null, signedAt: null, provisional: false, expiresOn: null, inheritedIgnored: false };
  const minor = inv.investor_category === "minor" || inv.is_minor === true;
  if (!minor) {
    return {
      category: inv.risk_profile ?? null,
      score: inv.risk_profile_score == null ? null : Number(inv.risk_profile_score),
      signedAt: iso(inv.risk_profile_signed_at),
      provisional: inv.provisional === true,
      expiresOn: day(riskExpiresOn({ riskProfileSignedAt: inv.risk_profile_signed_at, riskProfileExpiresOn: inv.risk_profile_expires_on, riskProfileExpiryFor: inv.risk_profile_expiry_for })),
      inheritedIgnored: false,
    };
  }
  const own = (await tx.execute(sql`
    SELECT final_category, total_score, signed_at, provisional, next_review_at FROM risk_profile_responses
     WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid
     ORDER BY COALESCE(signed_at, created_at) DESC LIMIT 1`)).rows[0] as Record<string, any> | undefined;
  return {
    category: own?.final_category ?? null,
    score: own?.total_score == null ? null : Number(own.total_score),
    signedAt: iso(own?.signed_at),
    provisional: own?.provisional === true,
    expiresOn: ownExpiresOn(own?.signed_at, own?.next_review_at),
    inheritedIgnored: true,
  };
}

/** Completed / Provisional / Due for review (lapsed) / Not completed, from the
 *  profile's own expiry (`expiresOn`: valid THROUGH that date, as
 *  lib/risk-profile/expiry.ts decides for everyone). */
export function suitabilityStatus(p: SuitabilityProfile, now = new Date()): "Completed" | "Provisional" | "Due for review" | "Not completed" {
  if (!p.category) return "Not completed";
  if (p.provisional) return "Provisional";
  if (!p.signedAt) return "Not completed";
  const lapsed = riskProfileLapsed({ riskProfileSignedAt: p.signedAt, riskProfileExpiresOn: p.expiresOn, riskProfileExpiryFor: p.signedAt }, now);
  return lapsed ? "Due for review" : "Completed";
}

/**
 * The risk columns a minor's own `investors` row should carry once NO guardian
 * is linked any more: the minor's own latest assessment, else nothing. Used
 * where a link is removed (an edit, a merge) — 0234's trigger copies only
 * while a link exists, so without this the old guardian's profile would stay
 * on the row and read as the minor's own.
 */
export async function minorOwnRiskColumns(tx: any, tenantId: string, minorId: string): Promise<{
  riskProfile: "conservative" | "moderate" | "aggressive" | "very_aggressive" | null;
  riskProfileScore: number | null;
  riskProfileSignedAt: Date | null;
  riskProfileProvisional: boolean;
  riskProfileExpiresOn: string | null;
  riskProfileExpiryFor: Date | null;
}> {
  const own = (await tx.execute(sql`
    SELECT final_category, total_score, signed_at, provisional, next_review_at FROM risk_profile_responses
     WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${minorId}::uuid
     ORDER BY COALESCE(signed_at, created_at) DESC LIMIT 1`)).rows[0] as Record<string, any> | undefined;
  return {
    riskProfile: own?.final_category ?? null,
    riskProfileScore: own?.total_score == null ? null : Number(own.total_score),
    riskProfileSignedAt: own?.signed_at ? new Date(own.signed_at) : null,
    riskProfileProvisional: own?.provisional === true,
    riskProfileExpiresOn: ownExpiresOn(own?.signed_at, own?.next_review_at),
    riskProfileExpiryFor: own?.signed_at ? new Date(own.signed_at) : null,
  };
}

/* ───────────── one rule for every reader of a client's risk columns ─────────────
 *
 * Migration 0234 copies a linked guardian's risk category, score, signed date and
 * provisional flag onto the minor's `investors` row. Every screen, export,
 * message, automation and report that reads those columns would therefore show
 * the GUARDIAN's information as the minor's (to people who may not open the
 * guardian, and to the minor's own contacts) and decide on it. The rule (G-1):
 *
 *   for a MINOR, the risk columns are the minor's own latest assessment
 *   (`risk_profile_responses` for the minor's account), never the row;
 *   for everyone else, the row, exactly as before.
 *
 * The minor's own assessment is the minor's information, so whoever may see the
 * minor may see it — no viewer check is needed, which is what lets automations
 * and client messages use it too. The guardian's profile is shown only through
 * the link, to a viewer who may open the guardian (guardian-link.ts).
 */

/** SQL: the `investors` row under `alias` is a minor. */
export function minorSql(alias: string) {
  const a = (c: string) => sql.raw(`${alias}.${c}`);
  return sql`(${a("investor_category")} = 'minor' OR COALESCE(${a("is_minor")}, false))`;
}

function ownLatest(alias: string, column: string) {
  const a = (c: string) => sql.raw(`${alias}.${c}`);
  return sql`(SELECT r_own.${sql.raw(column)} FROM risk_profile_responses r_own
               WHERE r_own.tenant_id = ${a("tenant_id")} AND r_own.investor_id = ${a("id")}
               ORDER BY COALESCE(r_own.signed_at, r_own.created_at) DESC LIMIT 1)`;
}

function ownLatestExpiry(alias: string) {
  const a = (c: string) => sql.raw(`${alias}.${c}`);
  return sql`(SELECT CASE WHEN r_own.signed_at IS NULL THEN NULL
                          ELSE COALESCE(r_own.next_review_at, (r_own.signed_at + interval '1 year')::date) END
                FROM risk_profile_responses r_own
               WHERE r_own.tenant_id = ${a("tenant_id")} AND r_own.investor_id = ${a("id")}
               ORDER BY COALESCE(r_own.signed_at, r_own.created_at) DESC LIMIT 1)`;
}

/**
 * The client's risk columns as any reader may use them (see above), as SQL
 * expressions over the `investors` row under `alias`. Use in place of
 * `alias.risk_profile` / `_score` / `_signed_at` / `_provisional`.
 */
export function clientRiskSql(alias: string) {
  const a = (c: string) => sql.raw(`${alias}.${c}`);
  const minor = minorSql(alias);
  return {
    category: sql`(CASE WHEN ${minor} THEN ${ownLatest(alias, "final_category")} ELSE ${a("risk_profile")} END)`,
    score: sql`(CASE WHEN ${minor} THEN ${ownLatest(alias, "total_score")} ELSE ${a("risk_profile_score")} END)`,
    signedAt: sql`(CASE WHEN ${minor} THEN ${ownLatest(alias, "signed_at")} ELSE ${a("risk_profile_signed_at")} END)`,
    provisional: sql`(CASE WHEN ${minor} THEN COALESCE(${ownLatest(alias, "provisional")}, false) ELSE COALESCE(${a("risk_profile_provisional")}, false) END)`,
    /** DATE the profile lapses (valid THROUGH it); NULL with no signed profile. */
    expiresOn: sql`(CASE WHEN ${minor} THEN ${ownLatestExpiry(alias)} ELSE ${riskExpiresOnSql(alias)} END)`,
  };
}

/** The four risk keys of a row, camelCase (Drizzle) or snake_case (raw SQL). */
const RISK_ROW_KEYS = {
  category: ["riskProfile", "risk_profile"],
  score: ["riskProfileScore", "risk_profile_score"],
  signedAt: ["riskProfileSignedAt", "risk_profile_signed_at"],
  provisional: ["riskProfileProvisional", "risk_profile_provisional"],
  expiresOn: ["riskProfileExpiresOn", "risk_profile_expires_on"],
  expiryFor: ["riskProfileExpiryFor", "risk_profile_expiry_for"],
} as const;

/**
 * Rows already fetched (e.g. `select().from(investors)`): replace the risk
 * fields of every MINOR row with the minor's own latest assessment (none →
 * empty). `idKey` names the client id; `extra` maps further aliases, e.g.
 * `{ category: ["risk"] }`. Rows that are not minors are returned unchanged.
 */
export async function withOwnRiskForMinors<T extends Record<string, any>>(
  tx: any, tenantId: string, rows: T[],
  opts: { idKey?: string; extra?: Partial<Record<keyof typeof RISK_ROW_KEYS, readonly string[]>> } = {},
): Promise<T[]> {
  const idKey = opts.idKey ?? "id";
  const ids = [...new Set(rows.map((r) => r?.[idKey]).filter(Boolean).map(String))];
  if (!ids.length) return rows;
  const own = new Map<string, { category: string | null; score: number | null; signedAt: Date | null; provisional: boolean; expiresOn: string | null; expiryFor: Date | null }>();
  // Chunked: a bound parameter per id, and Postgres allows 65,535 per statement.
  for (let k = 0; k < ids.length; k += 5000) {
    const part = ids.slice(k, k + 5000);
    const res = await tx.execute(sql`
      SELECT m.id::text AS id, o.final_category, o.total_score, o.signed_at, COALESCE(o.provisional, false) AS provisional, o.next_review_at
        FROM investors m
        LEFT JOIN LATERAL (
          SELECT r.final_category, r.total_score, r.signed_at, r.provisional, r.next_review_at FROM risk_profile_responses r
           WHERE r.tenant_id = m.tenant_id AND r.investor_id = m.id
           ORDER BY COALESCE(r.signed_at, r.created_at) DESC LIMIT 1) o ON true
       WHERE m.tenant_id = ${tenantId}::uuid
         AND m.id = ANY(ARRAY[${sql.join(part.map((i) => sql`${i}`), sql`, `)}]::uuid[])
         AND ${minorSql("m")}`);
    for (const r of res.rows as Array<Record<string, any>>) {
      own.set(r.id, {
        category: r.final_category ?? null,
        score: r.total_score == null ? null : Number(r.total_score),
        signedAt: r.signed_at ? new Date(r.signed_at) : null,
        provisional: r.provisional === true,
        // The own assessment's expiry, paired with its own signed date (expiry.ts reads the pair).
        expiresOn: ownExpiresOn(r.signed_at, r.next_review_at),
        expiryFor: r.signed_at ? new Date(r.signed_at) : null,
      });
    }
  }
  if (!own.size) return rows;
  return rows.map((row) => {
    const o = own.get(String(row?.[idKey]));
    if (!o) return row;
    const out: Record<string, any> = { ...row };
    for (const field of Object.keys(RISK_ROW_KEYS) as Array<keyof typeof RISK_ROW_KEYS>) {
      for (const k of [...RISK_ROW_KEYS[field], ...(opts.extra?.[field] ?? [])]) {
        if (!(k in out)) continue;
        const v = o[field];
        // Keep the row's shape: a date that arrived as a string stays a string.
        out[k] = v instanceof Date && typeof row[k] === "string" ? v.toISOString() : v;
      }
    }
    return out as T;
  });
}

/** One row: `withOwnRiskForMinors` for a single client record. */
export async function withOwnRiskForMinor<T extends Record<string, any>>(tx: any, tenantId: string, row: T, idKey = "id"): Promise<T> {
  if (!row) return row;
  return (await withOwnRiskForMinors(tx, tenantId, [row], { idKey }))[0];
}
