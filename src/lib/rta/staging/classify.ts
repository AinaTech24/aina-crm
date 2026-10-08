/**
 * Business classification of an RTA transaction row (Phase 3B-A).
 *
 * The existing importer's classifier (`classifyTransaction` in
 * integrations/cams-feed-parser.ts) answers "which `transactions.type`"; this
 * one answers the question the staging engine needs: which ECONOMIC event the
 * registrar reported, how sure we are, whether it is an external cash flow or
 * an internal transfer, and — when it should not be posted — why.
 *
 * Every rule is tied to evidence in the four real mailbacks verified on
 * 2026-10-08 (docs/rta/PHASE3A_DESIGN.md §4). Anything outside that evidence
 * is either classified with confidence `inferred` (the wording is plain, the
 * layout unobserved) or held as an exception. Nothing defaults.
 *
 *   CAMS R2   trxn_type_flag decides (its eight observed phrases); the
 *             systematic markers decide Switch vs STP, and ONLY when both
 *             agree (nature "Systematic…" AND a siptrxnno — true on 82/82
 *             observed rows). A switch with neither marker is an ordinary
 *             switch; with exactly one it is ambiguous and held.
 *   KFintech  the `Transaction Type` code (SIN ADD NEW FUL RED SWD STPA STPO,
 *             and the pre-rejection codes SIND STPAD STPOD), checked against
 *             `Transaction Head` (P / R). A code outside the table is held.
 */
import { isKfinReversalCode } from "../consolidation";

export const RTA_CLASSES = [
  "purchase", "sip_investment", "redemption", "swp_withdrawal",
  "switch_in", "switch_out", "stp_in", "stp_out",
  "idcw_payout", "idcw_reinvest",
  "rejection", "reversal", "cancellation", "unknown",
] as const;
export type RtaClass = (typeof RTA_CLASSES)[number];

export type LegacyType = "lumpsum" | "sip" | "stp" | "swp" | "redemption" | "switch" | "dividend_payout" | "dividend_reinvest";

/** How each class maps onto today's `transactions.type` / direction and reporting. */
export const CLASS_META: Record<RtaClass, { legacyType: LegacyType | null; direction: "inflow" | "outflow" | null; cashFlow: "external" | "internal" | "income" | "none" }> = {
  purchase: { legacyType: "lumpsum", direction: "inflow", cashFlow: "external" },
  sip_investment: { legacyType: "sip", direction: "inflow", cashFlow: "external" },
  redemption: { legacyType: "redemption", direction: "outflow", cashFlow: "external" },
  swp_withdrawal: { legacyType: "swp", direction: "outflow", cashFlow: "external" },
  switch_in: { legacyType: "switch", direction: "inflow", cashFlow: "internal" },
  switch_out: { legacyType: "switch", direction: "outflow", cashFlow: "internal" },
  stp_in: { legacyType: "stp", direction: "inflow", cashFlow: "internal" },
  stp_out: { legacyType: "stp", direction: "outflow", cashFlow: "internal" },
  idcw_payout: { legacyType: "dividend_payout", direction: "outflow", cashFlow: "income" },
  idcw_reinvest: { legacyType: "dividend_reinvest", direction: "inflow", cashFlow: "income" },
  rejection: { legacyType: null, direction: null, cashFlow: "none" },
  reversal: { legacyType: null, direction: null, cashFlow: "none" },
  cancellation: { legacyType: null, direction: null, cashFlow: "none" },
  unknown: { legacyType: null, direction: null, cashFlow: "none" },
};

/** Exception codes a classification can raise (the row is held, never posted). */
export type ClassException =
  | "pre_rejection_unlinked"
  | "instalment_rejected"
  | "reversal_unlinked"
  | "cancellation_unlinked"
  | "switch_stp_ambiguous"
  | "class_unverified_idcw"
  | "head_code_conflict"
  | "unknown_transaction_code"
  | "registrar_status_not_processed"
  | "folio_consolidation"
  | "rejection_semantics_unverified"
  | "non_financial_event";

/**
 * What a non-posting row IS, for the exception and rejection screens (Phase
 * 3E). Decided from codes, status, units, amount and — for a folio
 * correction — the whole group's figures (lib/rta/consolidation.ts); never
 * from a description or remark alone.
 */
export type EventCategory =
  | "failed_sip_instalment"
  | "failed_stp_leg"
  | "sip_registration_rejection"
  | "purchase_rejection"
  | "redemption_rejection"
  | "reversal_cancellation"
  | "folio_correction"
  | "unknown";

export type BusinessClass = {
  rtaClass: RtaClass;
  confidence: "verified" | "inferred";
  direction: "inflow" | "outflow" | null;
  /** Why the row may not be posted; absent when it may. */
  exception?: ClassException;
  /** One sentence for the exception list / the audit trail. */
  reason: string;
  /** Extra facts that qualify the class (e.g. inferredSwp). */
  notes?: Record<string, string | boolean>;
  /** Set on every row that may not be posted as an ordinary transaction. */
  category?: EventCategory;
};

const up = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
/** "S T P In" → "STP IN" (KFintech letter-spaces some acronyms). */
const spaced = (s: string) => s.replace(/\b(?:[A-Z] ){1,}[A-Z]\b/g, (m) => m.replace(/ /g, ""));

const REVERSAL = /REVERS|\bREV\b/;
const CANCEL = /CANCEL/;
const PRE_REJECT = /PRE[\s-]*REJECT/;
const REJECT_WORD = /REJECT/;

/** What an R-coded row would undo, by its base code. */
function categoryForBase(base: string): EventCategory {
  if (base === "SIN") return "failed_sip_instalment";
  if (base === "STPA" || base === "STPO") return "failed_stp_leg";
  if (base === "ADD" || base === "NEW") return "purchase_rejection";
  if (base === "FUL" || base === "RED" || base === "SWD") return "redemption_rejection";
  return "unknown";
}

function make(rtaClass: RtaClass, confidence: "verified" | "inferred", reason: string, extra: Partial<BusinessClass> = {}): BusinessClass {
  return { rtaClass, confidence, direction: CLASS_META[rtaClass].direction, reason, ...extra };
}

/** Registrar status → processed or not. Y / blank / the plain success words are processed. */
export function registrarProcessed(raw: string | null | undefined): boolean {
  const s = up(raw);
  return s === "" || ["Y", "YES", "PROCESSED", "SUCCESS", "SUCCESSFUL", "ALLOTTED", "CONFIRMED"].includes(s);
}

// ── CAMS ────────────────────────────────────────────────────────────────────

export type CamsClassInput = {
  flag: string;        // trxn_type_flag
  nature: string;      // trxn_nature
  typeCode: string;    // trxntype (P234ES, R1, SI55AS, SO1 …)
  sipTrxnNo: string;   // siptrxnno — the systematic registration reference
  status: string;      // trxnstat
  reversalCode?: string;
  originalTrxnNo?: string;
};

export function classifyCams(i: CamsClassInput): BusinessClass {
  const flag = up(i.flag);
  const nature = up(i.nature);
  if (!registrarProcessed(i.status)) {
    return make("unknown", "verified", `registrar status "${i.status.trim()}" is not processed — held, its effect is not established for this file`, { exception: "registrar_status_not_processed", direction: null, category: "unknown" });
  }
  if (up(i.reversalCode) || up(i.originalTrxnNo) || REVERSAL.test(nature) || REVERSAL.test(flag)) {
    return make("reversal", "verified", "reversal of an earlier transaction — held until it can be linked to its original", { exception: "reversal_unlinked", category: "reversal_cancellation" });
  }
  if (CANCEL.test(nature) || CANCEL.test(flag)) {
    return make("cancellation", "verified", "cancellation — held until it can be linked to its original", { exception: "cancellation_unlinked", category: "reversal_cancellation" });
  }
  // No CAMS rejection row has been seen (0 in 1,334 R2 rows): its kind is not
  // read from the wording — held as unknown until a sample shows its fields.
  if (/REJECT/.test(nature) || /REJECT/.test(flag)) {
    return make("rejection", "inferred", "CAMS rejection wording — no CAMS rejection row has been verified, so its effect is not read from the text; held", { exception: "pre_rejection_unlinked", category: "unknown" });
  }

  const natureSystematic = /^SYSTEMATIC/.test(nature);
  const hasSipRef = (i.sipTrxnNo ?? "").trim() !== "";

  const switchLeg = /\bSWITCH IN\b/.test(flag) ? "in" : /\bSWITCH OUT\b/.test(flag) ? "out" : null;
  if (switchLeg) {
    if (natureSystematic && hasSipRef) {
      return make(switchLeg === "in" ? "stp_in" : "stp_out", "verified",
        `CAMS ${i.flag.trim()} with a systematic description and a systematic registration — a systematic transfer (82/82 such rows in the verified R2)`);
    }
    if (!natureSystematic && !hasSipRef) {
      return make(switchLeg === "in" ? "switch_in" : "switch_out", "inferred",
        `CAMS ${i.flag.trim()} with no systematic marker — an ordinary switch (no such row was in the verified sample)`);
    }
    return make("unknown", "inferred",
      `CAMS ${i.flag.trim()} carries only one of the two systematic markers (description ${natureSystematic ? "says" : "does not say"} "Systematic", registration reference ${hasSipRef ? "present" : "absent"}) — switch or STP cannot be decided`,
      { exception: "switch_stp_ambiguous", category: "unknown", direction: switchLeg === "in" ? "inflow" : "outflow" });
  }

  if (/^(FULL|PARTIAL) REDEMPTION$/.test(flag)) {
    if (/SYSTEMATIC WITHDRAW/.test(nature)) return make("swp_withdrawal", "verified", "CAMS redemption described as a systematic withdrawal");
    if (natureSystematic && /INSTAL/.test(nature)) {
      return make("redemption", "inferred",
        "CAMS systematic redemption instalment without the word \"withdrawal\" — a redemption, possibly an SWP (not confirmed by the registrar)",
        { notes: { inferredSwp: true } });
    }
    return make("redemption", "verified", `CAMS ${i.flag.trim()}`);
  }
  if (/^(FRESH|ADDITIONAL) PURCHASE SYSTEMATIC$/.test(flag)) return make("sip_investment", "verified", `CAMS ${i.flag.trim()}`);
  if (/^(FRESH|ADDITIONAL) PURCHASE$/.test(flag)) {
    if (natureSystematic && /INSTAL/.test(nature)) return make("sip_investment", "verified", "CAMS purchase whose description is a systematic instalment");
    return make("purchase", "verified", `CAMS ${i.flag.trim()}`);
  }
  if (/(?:DIVIDEND|IDCW)/.test(flag) || /(?:DIVIDEND|IDCW)/.test(nature)) {
    const reinvest = /REINV/.test(flag) || /REINV/.test(nature);
    return make(reinvest ? "idcw_reinvest" : "idcw_payout", "inferred",
      "IDCW wording — no IDCW row was in the verified sample, so the layout is unconfirmed and the row is held",
      { exception: "class_unverified_idcw", category: "unknown" });
  }
  return make("unknown", "inferred", `CAMS transaction "${i.flag.trim() || i.typeCode.trim() || "(blank)"}" is not one the verified sample showed — held, not guessed`, { exception: "unknown_transaction_code", category: "unknown" });
}

// ── KFintech ────────────────────────────────────────────────────────────────

export type KfinClassInput = {
  typeCode: string;    // Transaction Type (SIN, FUL, STPA …)
  head: string;        // Transaction Head (P / R)
  description: string; // Transaction Description
  status: string;      // Transaction Status
  rejOriginalNo?: string; // RejTrnoOrgNo
  /** Units and amount as reported (only their signs are read). */
  units?: number | null;
  amount?: number | null;
};

const KFIN_CODES: Record<string, { cls: RtaClass; head: "P" | "R" }> = {
  SIN: { cls: "sip_investment", head: "P" },
  ADD: { cls: "purchase", head: "P" },
  NEW: { cls: "purchase", head: "P" },
  FUL: { cls: "redemption", head: "R" },
  RED: { cls: "redemption", head: "R" },
  SWD: { cls: "swp_withdrawal", head: "R" },
  STPA: { cls: "stp_in", head: "P" },
  STPO: { cls: "stp_out", head: "R" },
};
/**
 * Pre-rejection codes seen in MFSD201. Verified on the May 2026 sample
 * (Phase 3D): every SIND / STPAD / STPOD row is a FAILED INSTALMENT reported on
 * its own — status Y, no units allotted, the instalment amount, the reason in
 * Remarks ("Primary KYC Invalid…", "Required amount not available in source
 * fund"), RejTrnoOrgNo empty. It does not reverse an earlier processed row; it
 * IS the record that the instalment did not happen.
 */
const KFIN_PRE_REJECTION: Record<string, "sip" | "stp_in" | "stp_out"> = { SIND: "sip", STPAD: "stp_in", STPOD: "stp_out" };

export function classifyKfintech(i: KfinClassInput): BusinessClass {
  const code = up(i.typeCode);
  const head = up(i.head);
  const desc = spaced(up(i.description));
  if (!registrarProcessed(i.status)) {
    return make("unknown", "verified", `registrar status "${i.status.trim()}" is not processed — held, its effect is not established for this file`, { exception: "registrar_status_not_processed", category: "unknown" });
  }
  // A known code with an "R" suffix (SINR, FULR, NEWR in the newer MFSD201)
  // undoes a transaction of the base code. Every such row in the sample was a
  // FOLIO CORRECTION, but that is proved per group from the figures
  // (lib/rta/consolidation.ts, applied in group.ts), never assumed here. On
  // its own the row is an unverified rejection of its base type — held.
  if (isKfinReversalCode(code)) {
    const base = code.slice(0, -1);
    return make("rejection", "inferred", `KFintech ${code} undoes a ${base} transaction — held: its effect is decided only when the group proves a folio correction, and a genuine one has not been evidenced`,
      { exception: "rejection_semantics_unverified", category: categoryForBase(base), notes: { baseCode: base } });
  }
  if (KFIN_PRE_REJECTION[code] || PRE_REJECT.test(desc)) {
    const linked = (i.rejOriginalNo ?? "").trim() !== "";
    const of = KFIN_PRE_REJECTION[code];
    // The verified shape: names no original, allotted nothing, carries the
    // instalment amount. Only that shape is read as a failed instalment.
    if (of && !linked && (i.units ?? 0) === 0 && (i.amount ?? 0) > 0) {
      return make("rejection", "verified",
        `KFintech ${code}: a ${of === "sip" ? "SIP" : of === "stp_in" ? "STP-in" : "STP-out"} instalment the registrar refused (no units allotted) — a failed instalment for the SIP Rejection register, never a transaction; it does not stop the registration`,
        { exception: "instalment_rejected", category: of === "sip" ? "failed_sip_instalment" : "failed_stp_leg", notes: { rejectionOf: of, genuineRejection: true } });
    }
    return make("rejection", "verified",
      linked
        ? `KFintech pre-rejection ${code} naming its original — held: linking a rejection to its original is not implemented in this phase`
        : `KFintech pre-rejection ${code} outside the verified shape (no units, an amount, no original named) — held`,
      { exception: "pre_rejection_unlinked", category: of === "sip" ? "failed_sip_instalment" : of ? "failed_stp_leg" : "unknown" });
  }
  if (REVERSAL.test(desc)) return make("reversal", "verified", "KFintech reversal — held until it can be linked to its original", { exception: "reversal_unlinked", category: "reversal_cancellation" });
  if (CANCEL.test(desc)) return make("cancellation", "verified", "KFintech cancellation — held until it can be linked to its original", { exception: "cancellation_unlinked", category: "reversal_cancellation" });

  const known = KFIN_CODES[code];
  if (known) {
    if (head && head !== known.head) {
      return make("unknown", "verified", `KFintech code ${code} with Transaction Head "${head}" — the verified file always paired it with ${known.head}; held`, { exception: "head_code_conflict", category: "unknown" });
    }
    return make(known.cls, "verified", `KFintech ${code}`);
  }
  if (/(?:DIVIDEND|IDCW)/.test(desc)) {
    return make(/REINV/.test(desc) ? "idcw_reinvest" : "idcw_payout", "inferred",
      "IDCW wording — no IDCW row was in the verified sample, so the layout is unconfirmed and the row is held",
      { exception: "class_unverified_idcw", category: "unknown" });
  }
  return make("unknown", "inferred", `KFintech transaction code "${code || "(blank)"}" is not one the verified sample showed — held, not guessed`, { exception: "unknown_transaction_code", category: "unknown" });
}

/**
 * A row the registrar marks as non-financial (CAMS WBR10 trxn_sign "N" — e.g.
 * a nomination or contact change): no units, no money. Not a transaction for
 * any of the eight modules; the master reports carry the resulting state.
 */
export function nonFinancial(code: string): BusinessClass {
  return make("unknown", "verified", `non-financial registrar event "${code.trim() || "(blank)"}" — no units or money; not a transaction`, { exception: "non_financial_event" });
}

/** May a row of this class be proposed for posting (given no other exception)? */
export function postable(c: BusinessClass): boolean {
  return !c.exception && CLASS_META[c.rtaClass].legacyType !== null;
}
