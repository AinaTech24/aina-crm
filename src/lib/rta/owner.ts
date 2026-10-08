/**
 * Who LEGALLY owns a registrar row's folio — the owner decisions of 2026-10-08.
 *
 * A folio has exactly one legal owner (the first holder). A minor is an owner
 * represented by a guardian; an HUF is an owner represented by its Karta; joint
 * holders are named on the owner's folio, they do not own copies of it. A
 * guardian's or Karta's PAN appearing on a row NEVER makes that person the
 * owner, and name / mobile / email are never used to identify anyone.
 *
 * Two steps, both pure:
 *   deriveHolder()  what the ROW says: owner type, the owner's own PAN, which
 *                   role the row's PAN column plays, guardian and joint PANs,
 *                   and anything that needs review
 *   resolveOwner()  given what the CRM already knows (an OwnerDirectory), which
 *                   client the folio belongs to — Decision 7's order:
 *                     1. the folio already on record (registrar + AMC + folio)
 *                        and its owner, checked against the row
 *                     2. the owner's OWN PAN (never a representative's)
 *                     3. a provisional, folio-keyed owner when the owner has
 *                        no PAN of their own (a minor, as every minor in the
 *                        verified files) — with the guardian as a link
 *                     4. otherwise an exception for review
 *
 * Evidence (real files, 2026-10-08): CAMS R2 prints the GUARDIAN's PAN in its
 * `pan` column on every minor row (22/22) and says so in `tax_status`
 * ("On Behalf of Minor"); R9, MFSD211, MFSD201 and MFSD203 leave a minor's own
 * PAN blank and give the guardian in guard_pan / GuardPanNo. Every HUF row's
 * PAN has H as its holder-type letter (R9 6/6, R2 6/6, MFSD211 13/13). No
 * report carries a Karta field, so a Karta can only come from KYC / the firm.
 */
import { validPan } from "./values";

export type OwnerType = "individual" | "minor" | "huf" | "non_individual" | "unknown";

/** How the row's main PAN column is to be read. */
export type PanColumnRole =
  | "owner" //            the first holder's own PAN (R9 pan_no, MFSD211 PAN Number, MFSD201 PAN1, MFSD203 PAN)
  | "owner_or_guardian"; // the owner's, or the GUARDIAN's on a minor row (CAMS R2 `pan`)

export type HolderFacts = {
  /** Registrar holder / tax status as printed (R9 / R2 tax_status, MFSD211 StatusDesc, MFSD201 Status). */
  statusText?: string | null;
  rowPan?: string | null;
  rowPanRole: PanColumnRole;
  guardianPan?: string | null;
  /** Second and third holders' PANs, in order. */
  jointPans?: Array<string | null | undefined>;
  dob?: string | null;
  asOf?: string | null;
};

export type HolderFlag =
  | "source_pan_is_guardian" //           the row's PAN column held the guardian's PAN (CAMS minor row)
  | "minor_without_own_pan" //            identity must be provisional / folio-linked
  | "minor_age_18_or_over" //             date of birth says 18+ but the registrar still says minor
  | "huf_owner_pan_not_huf" //            HUF owner, but the PAN is not an HUF PAN (likely the Karta's)
  | "huf_without_pan" //
  | "owner_pan_type_mismatch" //          e.g. individual status with an H / F PAN
  | "guardian_pan_invalid" //
  | "owner_type_from_pan_only"; //        no registrar status on the row; the PAN's holder letter was used

export type DerivedHolder = {
  ownerType: OwnerType;
  ownerTypeSource: "registrar_status" | "pan_structure" | "none";
  /** The legal owner's own PAN, when the row really carries it. */
  ownerPan: string | null;
  guardianPan: string | null;
  jointPans: string[];
  sourcePanRole: "owner" | "guardian" | "none";
  flags: HolderFlag[];
};

/** PAN 4th character → holder type (Income-tax PAN structure). */
export function panHolderType(pan: string | null): OwnerType | null {
  if (!pan) return null;
  const c = pan[3];
  if (c === "P") return "individual";
  if (c === "H") return "huf";
  return "non_individual"; // C F A T B L J G (validPan admits only these)
}

/** Registrar holder status text → owner type. Unknown text is "unknown", never guessed. */
export function statusOwnerType(text?: string | null): OwnerType | null {
  const s = (text ?? "").toUpperCase().trim();
  if (!s) return null;
  if (/MINOR/.test(s)) return "minor";
  if (/\bHUF\b|HINDU UNDIVIDED/.test(s)) return "huf";
  // A sole proprietorship IS the individual (individual PAN, verified 4/4 in R9).
  if (/PROPRIET/.test(s)) return "individual";
  if (/PARTNER|FIRM|COMPANY|CORPORATE|BODY CORP|TRUST|SOCIETY|AOP|BOI|LLP|BANK|INSTITUTION|GOVERN|FPI|FII/.test(s)) return "non_individual";
  if (/INDIVIDUAL|\bNRI\b|NON[- ]?RESIDENT|RESIDENT|NRE|NRO/.test(s)) return "individual";
  return "unknown";
}

function ageOn(dob?: string | null, at?: string | null): number | null {
  if (!dob || !at || !/^\d{4}-\d{2}-\d{2}$/.test(dob) || !/^\d{4}-\d{2}-\d{2}$/.test(at)) return null;
  const [y1, m1, d1] = dob.split("-").map(Number), [y2, m2, d2] = at.split("-").map(Number);
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

export function deriveHolder(f: HolderFacts): DerivedHolder {
  const flags: HolderFlag[] = [];
  const rowPan = validPan(f.rowPan);
  const guardianRaw = validPan(f.guardianPan);
  if ((f.guardianPan ?? "").trim() && !guardianRaw) flags.push("guardian_pan_invalid");
  const jointPans = (f.jointPans ?? []).map((p) => validPan(p)).filter((p): p is string => !!p);

  const byStatus = statusOwnerType(f.statusText);
  let ownerType: OwnerType = byStatus && byStatus !== "unknown" ? byStatus : "unknown";
  let ownerTypeSource: DerivedHolder["ownerTypeSource"] = byStatus && byStatus !== "unknown" ? "registrar_status" : "none";

  if (ownerType === "minor") {
    let guardianPan = guardianRaw;
    let ownerPan: string | null = null;
    let sourcePanRole: DerivedHolder["sourcePanRole"] = rowPan ? "owner" : "none";
    if (rowPan && f.rowPanRole === "owner_or_guardian") {
      // CAMS transaction feed: on a minor row this column is the guardian's PAN.
      sourcePanRole = "guardian";
      flags.push("source_pan_is_guardian");
      guardianPan = guardianPan ?? rowPan;
    } else if (rowPan && rowPan !== guardianPan && panHolderType(rowPan) === "individual") {
      ownerPan = rowPan; // the minor's own PAN
    } else if (rowPan) {
      sourcePanRole = "guardian";
      flags.push("source_pan_is_guardian");
      guardianPan = guardianPan ?? rowPan;
    }
    if (!ownerPan) flags.push("minor_without_own_pan");
    const age = ageOn(f.dob, f.asOf);
    if (age !== null && age >= 18) flags.push("minor_age_18_or_over");
    return { ownerType, ownerTypeSource, ownerPan, guardianPan, jointPans, sourcePanRole, flags };
  }

  // Not a minor: the row's PAN is the first holder's.
  const panType = panHolderType(rowPan);
  if (ownerType === "unknown" && panType) {
    ownerType = panType;
    ownerTypeSource = "pan_structure";
    flags.push("owner_type_from_pan_only");
  }
  let ownerPan = rowPan;
  if (ownerType === "huf") {
    if (!rowPan) flags.push("huf_without_pan");
    else if (panType !== "huf") {
      // Decision 4.7/4.8: an HUF folio with an individual PAN — most likely the
      // Karta's. Never used as the HUF's PAN, never manufactured.
      flags.push("huf_owner_pan_not_huf");
      ownerPan = null;
    }
  } else if (rowPan && panType && ownerType !== panType && !(ownerType === "individual" && panType === "individual")) {
    flags.push("owner_pan_type_mismatch");
  }
  return { ownerType, ownerTypeSource, ownerPan, guardianPan: guardianRaw, jointPans, sourcePanRole: rowPan ? "owner" : "none", flags };
}

// ── Resolution against what the CRM knows ───────────────────────────────────

export type KnownInvestor = {
  id: string;
  /** investors.pan as stored: a real PAN, or an importer key (MINOR:…, NOPAN:…). */
  pan: string | null;
  isMinor: boolean;
  category: string | null;
  guardianId: string | null;
  placeholder: boolean;
};

export type Lookup =
  | { kind: "found"; investorId: string; folioId?: string | null }
  | { kind: "none" }
  | { kind: "blocked" | "ambiguous"; reason: string };

/** Read-only view of the CRM's clients and folios. */
export interface OwnerDirectory {
  folioOwner(amcCode: string | null, folioNumber: string): Promise<Lookup>;
  byPan(pan: string): Promise<Lookup>;
  investor(id: string): KnownInvestor | null;
}

export type OwnerDecision =
  | { kind: "existing_folio_owner"; investorId: string; folioId: string | null; rule: string }
  | { kind: "owner_by_pan"; investorId: string; rule: string }
  | { kind: "new_owner_by_pan"; ownerType: OwnerType; rule: string }
  | { kind: "new_provisional_owner"; ownerType: OwnerType; provisionalKey: string; guardianInvestorId: string | null; rule: string }
  | { kind: "exception"; code: OwnerException; reason: string; investorId?: string };

export type OwnerException =
  | "folio_owned_by_guardian"
  | "owner_type_conflict"
  | "folio_pan_conflict"
  | "placeholder_owner"
  | "huf_owner_pan_unverified"
  | "pan_matches_minor_record"
  | "identity_blocked"
  | "identity_ambiguous";

/** The provisional key of a folio-linked owner: registrar + AMC + folio, never a name. */
export function provisionalOwnerKey(rta: string, amcCode: string | null, folioNumber: string): string {
  return `FOLIO:${rta}:${(amcCode ?? "").trim()}:${folioNumber.trim()}`;
}

const realPan = (inv: KnownInvestor | null) => validPan(inv?.pan ?? null);
const investorType = (inv: KnownInvestor): OwnerType =>
  inv.isMinor || inv.category === "minor" ? "minor" : inv.category === "huf" ? "huf" : panHolderType(realPan(inv)) ?? "unknown";

export async function resolveOwner(
  dir: OwnerDirectory,
  row: { rta: string; amcCode: string | null; folioNumber: string },
  h: DerivedHolder,
): Promise<OwnerDecision> {
  // 1. The folio already on record.
  const folio = await dir.folioOwner(row.amcCode, row.folioNumber);
  if (folio.kind === "blocked") return { kind: "exception", code: "identity_blocked", reason: folio.reason };
  if (folio.kind === "ambiguous") return { kind: "exception", code: "identity_ambiguous", reason: folio.reason };
  if (folio.kind === "found") {
    const owner = dir.investor(folio.investorId);
    if (!owner) return { kind: "exception", code: "identity_ambiguous", reason: "the folio's owner record could not be read" };
    const ownerPan = realPan(owner);
    const ownerType = investorType(owner);
    if (h.ownerType === "minor") {
      if (h.guardianPan && ownerPan === h.guardianPan) {
        return { kind: "exception", code: "folio_owned_by_guardian", investorId: owner.id,
          reason: "the registrar says this folio belongs to a minor, but the CRM has it under the guardian's own client record — held for review; nothing reassigned" };
      }
      if (ownerType !== "minor" && ownerType !== "unknown" && !owner.placeholder) {
        return { kind: "exception", code: "owner_type_conflict", investorId: owner.id, reason: `the registrar says minor; the folio's CRM owner is recorded as ${ownerType} — held for review` };
      }
      if (h.ownerPan && ownerPan && ownerPan !== h.ownerPan) {
        return { kind: "exception", code: "folio_pan_conflict", investorId: owner.id, reason: "the minor's own PAN differs from the folio owner's PAN on record — held for review" };
      }
      return { kind: "existing_folio_owner", investorId: owner.id, folioId: folio.folioId ?? null, rule: "folio" };
    }
    if (owner.placeholder && h.ownerPan) {
      return { kind: "exception", code: "placeholder_owner", investorId: owner.id, reason: "the folio sits on a PAN-less placeholder and the row names an owner PAN — automatic reassignment is disabled; held for review" };
    }
    if (h.ownerType === "huf" && !h.ownerPan) {
      return { kind: "exception", code: "huf_owner_pan_unverified", investorId: owner.id, reason: "the registrar says HUF but the row carries no HUF PAN (an individual PAN is likely the Karta's) — held for review" };
    }
    if (h.ownerPan && ownerPan && ownerPan !== h.ownerPan) {
      return { kind: "exception", code: "folio_pan_conflict", investorId: owner.id, reason: "the folio is on record under a different owner PAN than the registrar's — held for review, nothing reassigned" };
    }
    if (ownerType === "minor" && h.ownerType !== "unknown") {
      return { kind: "exception", code: "owner_type_conflict", investorId: owner.id, reason: `the folio's CRM owner is a minor; the registrar's row says ${h.ownerType} — possibly a minor-to-major change: verify before updating` };
    }
    if (h.ownerType === "huf" && ownerType !== "huf" && ownerType !== "unknown") {
      return { kind: "exception", code: "owner_type_conflict", investorId: owner.id, reason: `the registrar says HUF; the folio's CRM owner is recorded as ${ownerType} — held for review` };
    }
    return { kind: "existing_folio_owner", investorId: owner.id, folioId: folio.folioId ?? null, rule: h.ownerPan ? "folio+owner_pan" : "folio" };
  }

  // 2. New folio: the owner's OWN PAN.
  if (h.ownerPan) {
    const found = await dir.byPan(h.ownerPan);
    if (found.kind === "blocked") return { kind: "exception", code: "identity_blocked", reason: found.reason };
    if (found.kind === "ambiguous") return { kind: "exception", code: "identity_ambiguous", reason: found.reason };
    if (found.kind === "found") {
      const inv = dir.investor(found.investorId);
      const t = inv ? investorType(inv) : "unknown";
      if (h.ownerType === "minor" && t !== "minor") return { kind: "exception", code: "owner_type_conflict", investorId: found.investorId, reason: "the minor's PAN matches a client not recorded as a minor — held for review" };
      if (h.ownerType !== "minor" && t === "minor") return { kind: "exception", code: "pan_matches_minor_record", investorId: found.investorId, reason: "the PAN matches a client recorded as a minor — a minor-to-major change? verify before attaching" };
      return { kind: "owner_by_pan", investorId: found.investorId, rule: "owner_pan" };
    }
    return { kind: "new_owner_by_pan", ownerType: h.ownerType, rule: "owner_pan_new" };
  }

  // 3. No own PAN: a provisional owner keyed on the folio. A minor's guardian is
  //    a LINK (found by the guardian's PAN), never the owner.
  if (h.ownerType === "huf") {
    return { kind: "exception", code: "huf_owner_pan_unverified", reason: "an HUF folio without an HUF PAN — the owner cannot be identified; held for review" };
  }
  let guardianInvestorId: string | null = null;
  if (h.ownerType === "minor" && h.guardianPan) {
    const g = await dir.byPan(h.guardianPan);
    if (g.kind === "found") guardianInvestorId = g.investorId;
  }
  return {
    kind: "new_provisional_owner", ownerType: h.ownerType, guardianInvestorId,
    provisionalKey: provisionalOwnerKey(row.rta, row.amcCode, row.folioNumber),
    rule: h.ownerType === "minor" ? "minor_folio_provisional" : "no_pan_folio_provisional",
  };
}

/** The holders named on one folio, in their roles — relationships, not owners. */
export function folioHolderRoles(h: DerivedHolder): Array<{ role: "first" | "second" | "third" | "guardian"; pan: string | null }> {
  const out: Array<{ role: "first" | "second" | "third" | "guardian"; pan: string | null }> = [{ role: "first", pan: h.ownerPan }];
  h.jointPans.slice(0, 2).forEach((p, i) => out.push({ role: i === 0 ? "second" : "third", pan: p }));
  if (h.ownerType === "minor") out.push({ role: "guardian", pan: h.guardianPan });
  return out;
}
