/**
 * A minor's guardian link (`investors.guardian_investor_id`) — who it may point
 * at, and who may see the guardian through it (G-1, 2026-10-14).
 *
 * The link is not a label. Migration 0234 copies the linked client's risk
 * profile onto the minor and the minor's pages name the guardian, so a link to
 * the wrong record hands one client's details to another client's record —
 * and, before this module, to any user who typed a PAN. Rules:
 *
 *  - The guardian is a LIVE, NON-MERGED, ADULT INDIVIDUAL: a person client type
 *    (individual / NRI / sole proprietor), not flagged minor, 18 or older when a
 *    date of birth is on record, and — when a PAN is on record — an individual's
 *    PAN (4th letter P), so an HUF, company or trust PAN can never stand in.
 *  - A typed guardian PAN links only when EXACTLY ONE live record in the firm
 *    holds it. Two records sharing a PAN is a question for a person (Merge
 *    Clients), never a pick.
 *  - The user must be able to open that client: the firm's data wall
 *    (`investorScopeSql`) applies to the guardian exactly as to any client.
 *  - A picked id goes through the same checks as a typed PAN.
 *  - Every refusal looks the same to the caller (`null`), so the answer never
 *    says whether a PAN exists, is shared, or belongs to another RM's client.
 */
import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { recordAudit } from "@/lib/audit";
import { withOwnRiskForMinor } from "@/lib/risk-profile/own-assessment";

/** `investor_merges.moved` keys for guardian links a merge moved / removed. */
export const GUARDIAN_MOVED_KEY = "investors.guardian_investor_id";
export const GUARDIAN_UNLINKED_KEY = "investors.guardian_unlinked";

/** One message for every refused pick — it must not say WHY. */
export const GUARDIAN_NOT_LINKED =
  "That client can't be linked as this minor's guardian. A guardian must be an adult individual client you can open; pick them from your clients, or leave the guardian's details typed in.";

/** What a save says when a typed guardian PAN linked nobody — also never why. */
export const GUARDIAN_PAN_NOT_LINKED =
  "Saved — but the guardian is not linked to a client record, so the guardian is NOT VERIFIED. Their details are kept as typed. No mutual fund proposal can go to this minor until the guardian is linked or the owner or compliance confirms them, and the minor has no risk profile of its own until one is recorded for the minor's account. To link a guardian who is your client, pick them under \"Guardian's client record\".";

/** Client types that are one natural person. */
export const GUARDIAN_TYPES = ["individual", "nri", "sole_proprietor"] as const;

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export type GuardianCandidateRow = {
  investor_category: string | null;
  is_minor: boolean | null;
  dob: string | Date | null;
  pan: string | null;
  status: string | null;
  deleted_at: string | Date | null;
  merged_into_id: string | null;
};

/** Pure: may this record be a guardian at all (before access is considered)? */
export function isEligibleGuardian(r: GuardianCandidateRow, today = new Date()): boolean {
  if (r.deleted_at || r.merged_into_id) return false;
  if (r.status === "closed" || r.status === "exited") return false;
  if (!(GUARDIAN_TYPES as readonly string[]).includes(r.investor_category ?? "individual")) return false;
  if (r.is_minor) return false;
  const pan = String(r.pan ?? "").trim().toUpperCase();
  if (PAN_RE.test(pan) && pan[3] !== "P") return false;
  if (r.dob) {
    const d = new Date(r.dob);
    const adult = new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate()));
    if (adult.getTime() > today.getTime()) return false;
  }
  return true;
}

/** Normalise a typed guardian PAN; anything that is not a PAN is no PAN. */
export function guardianPan(v: unknown): string | null {
  const p = String(v ?? "").trim().toUpperCase();
  return PAN_RE.test(p) ? p : null;
}

const COLS = sql`g.id::text AS id, g.investor_category, g.is_minor, g.dob, g.pan, g.status, g.deleted_at, g.merged_into_id`;

/** Who is looking: a full session, or the subset a server component carries. */
export type Viewer = Pick<SessionUser, "tenantId" | "userId" | "roles" | "branchId"> & Partial<SessionUser>;

/** May this user open this client (the firm's data wall)? False when unsure. */
export async function viewerMaySee(tx: any, session: Viewer, investorId: string): Promise<boolean> {
  let scope;
  try { scope = await investorScopeSql(tx, session as SessionUser, "g"); } catch { return false; }
  const r = await tx.execute(sql`
    SELECT 1 FROM investors g
     WHERE g.id = ${investorId}::uuid AND g.tenant_id = ${session.tenantId}::uuid
       AND g.deleted_at IS NULL AND ${scope}
     LIMIT 1`);
  return r.rows.length > 0;
}

/**
 * The guardian a pick or a typed PAN resolves to, or null (refused). `minorId`
 * is the minor being edited (never its own guardian).
 */
export async function resolveGuardian(
  tx: any,
  session: SessionUser,
  by: { id?: string | null; pan?: string | null; minorId?: string },
): Promise<string | null> {
  let rows: Array<GuardianCandidateRow & { id: string }>;
  if (by.id) {
    rows = (await tx.execute(sql`
      SELECT ${COLS} FROM investors g
       WHERE g.id = ${by.id}::uuid AND g.tenant_id = ${session.tenantId}::uuid`)).rows;
  } else {
    const pan = guardianPan(by.pan);
    if (!pan) return null;
    // Firm-wide on purpose: a PAN is one legal person, so EVERY live record
    // carrying it counts — including ones this user cannot see. Two of them
    // means nobody knows which one is the guardian.
    rows = (await tx.execute(sql`
      SELECT ${COLS} FROM investors g
       WHERE g.tenant_id = ${session.tenantId}::uuid AND upper(btrim(g.pan)) = ${pan}
         AND g.deleted_at IS NULL AND g.merged_into_id IS NULL
       LIMIT 2`)).rows;
  }
  if (rows.length !== 1) return null;
  const g = rows[0];
  if (by.minorId && g.id === by.minorId) return null;
  if (!isEligibleGuardian(g)) return null;
  if (!(await viewerMaySee(tx, session, g.id))) return null;
  return g.id;
}

/** Audit a change of a minor's guardian link (ids only — never a PAN or name). */
export async function auditGuardianChange(
  tx: any,
  input: {
    tenantId: string; actorUserId: string | null; minorId: string;
    before: string | null; after: string | null; via: "picked" | "pan" | "unlinked" | "merge";
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  if ((input.before ?? null) === (input.after ?? null)) return;
  await recordAudit(tx, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? undefined,
    actorType: input.actorUserId ? "user" : "system",
    action: input.after ? "investor.guardian_linked" : "investor.guardian_unlinked",
    entityType: "investor",
    entityId: input.minorId,
    before: { guardianInvestorId: input.before ?? null },
    after: { guardianInvestorId: input.after ?? null, via: input.via },
    ...(input.meta ? { meta: input.meta } : {}),
  });
}

/**
 * A typed guardian PAN that linked nobody. Recorded without the reason (the
 * minor's history is visible to its RM, and the reason — shared PAN, another
 * RM's client — is exactly what must not reach them); the impact report
 * (docs/security/g1-guardian-impact.sql) re-derives it for compliance.
 */
export async function auditGuardianNotLinked(
  tx: any, input: { tenantId: string; actorUserId: string | null; minorId: string },
): Promise<void> {
  await recordAudit(tx, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? undefined,
    actorType: input.actorUserId ? "user" : "system",
    action: "investor.guardian_not_linked",
    entityType: "investor",
    entityId: input.minorId,
    after: { via: "pan" },
  });
}

/**
 * What a viewer may see of a minor's guardian: the record when they can open
 * it, else only that one exists. Never the name or risk of a hidden guardian.
 */
export async function guardianForViewer(
  tx: any,
  session: Viewer,
  guardianId: string | null | undefined,
): Promise<{ id: string; name: string | null; riskProfile: string | null; hidden: boolean } | null> {
  if (!guardianId) return null;
  if (!(await viewerMaySee(tx, session, guardianId))) return { id: guardianId, name: null, riskProfile: null, hidden: true };
  const g = (await tx.execute(sql`
    SELECT id::text AS id, name, risk_profile FROM investors
     WHERE id = ${guardianId}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1`)).rows[0] as
    { id: string; name: string; risk_profile: string | null } | undefined;
  return g ? { id: g.id, name: g.name, riskProfile: g.risk_profile, hidden: false } : null;
}

/**
 * A client record on its way to a screen or an API response. For a MINOR, the
 * risk fields become the minor's own latest assessment — never migration
 * 0234's copy of the guardian's, whoever is looking (G-1). The guardian's own
 * profile is shown separately, only through `guardianForViewer`. The stored
 * row is untouched. Anyone else's record is returned unchanged.
 */
export async function withMinorOwnRisk<T extends Record<string, any>>(tx: any, session: Viewer, inv: T): Promise<T> {
  return withOwnRiskForMinor(tx, session.tenantId, inv);
}

const RISK_KEYS = [
  "riskProfile", "riskProfileScore", "riskProfileSignedAt", "riskProfileProvisional",
  "risk_profile", "risk_profile_score", "risk_profile_signed_at", "risk_profile_provisional",
] as const;

/** Pure: a copy of `row` with the risk fields blanked (a minor's history rows
 *  carry 0234's copies of whichever guardian was linked at the time). */
export function stripRiskKeys<T extends Record<string, any>>(row: T): T {
  const out: Record<string, any> = { ...row };
  for (const k of RISK_KEYS) if (k in out) out[k] = /provisional/i.test(k) ? false : null;
  return out as T;
}
