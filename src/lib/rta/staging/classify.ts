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
};

const up = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
/** "S T P In" → "STP IN" (KFintech letter-spaces some acronyms). */
const spaced = (s: string) => s.replace(/\b(?:[A-Z] ){1,}[A-Z]\b/g, (m) => m.replace(/ /g, ""));

const REVERSAL = /REVERS|\bREV\b/;
const CANCEL = /CANCEL/;
const PRE_REJECT = /PRE[\s-]*REJECT/;
const REJECT_WORD = /REJECT/;

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
    return make("unknown", "verified", `registrar status "${i.status.trim()}" is not processed — held, its effect is not established for this file`, { exception: "registrar_status_not_processed", direction: null });
  }
  if (up(i.reversalCode) || up(i.originalTrxnNo) || REVERSAL.test(nature) || REVERSAL.test(flag)) {
    return make("reversal", "verified", "reversal of an earlier transaction — held until it can be linked to its original", { exception: "reversal_unlinked" });
  }
  if (CANCEL.test(nature) || CANCEL.test(flag)) {
    return make("cancellation", "verified", "cancellation — held until it can be linked to its original", { exception: "cancellation_unlinked" });
  }
  if (/REJECT/.test(nature) || /REJECT/.test(flag)) {
    return make("rejection", "verified", "rejection — held until it can be linked to its original", { exception: "pre_rejection_unlinked" });
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
      { exception: "switch_stp_ambiguous", direction: switchLeg === "in" ? "inflow" : "outflow" });
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
      { exception: "class_unverified_idcw" });
  }
  return make("unknown", "inferred", `CAMS transaction "${i.flag.trim() || i.typeCode.trim() || "(blank)"}" is not one the verified sample showed — held, not guessed`, { exception: "unknown_transaction_code" });
}

// ── KFintech ────────────────────────────────────────────────────────────────

export type KfinClassInput = {
  typeCode: string;    // Transaction Type (SIN, FUL, STPA …)
  head: string;        // Transaction Head (P / R)
  description: string; // Transaction Description
  status: string;      // Transaction Status
  rejOriginalNo?: string; // RejTrnoOrgNo
  /** The row's Remarks say it was re-reported because folios were consolidated. */
  consolidation?: boolean;
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
/** Pre-rejection codes seen in MFSD201: the row refuses an earlier one, which it does not name. */
const KFIN_PRE_REJECTION = new Set(["SIND", "STPAD", "STPOD"]);

export function classifyKfintech(i: KfinClassInput): BusinessClass {
  const code = up(i.typeCode);
  const head = up(i.head);
  const desc = spaced(up(i.description));
  if (!registrarProcessed(i.status)) {
    return make("unknown", "verified", `registrar status "${i.status.trim()}" is not processed — held, its effect is not established for this file`, { exception: "registrar_status_not_processed" });
  }
  // Folio consolidation (verified, newer MFSD201 of 2026-10-08): the registrar
  // re-reports an old folio's transactions — the original, its reversal under a
  // code ending in R ("SIP Rejection", "Redemption Rejection", "Purchase
  // Rejection") with the SAME transaction number, and a re-post into the
  // surviving folio — all remarked "Trxn triggered now due to consolidation of
  // folios". Those R rows are NOT bank or registrar rejections.
  if (i.consolidation) {
    const base = KFIN_CODES[code] ?? (code.endsWith("R") ? KFIN_CODES[code.slice(0, -1)] : undefined);
    return make(code.endsWith("R") && REJECT_WORD.test(desc) ? "reversal" : (base?.cls ?? "unknown"), "verified",
      "re-reported because the registrar consolidated folios (original, reversal and re-post share one transaction number) — held: posting needs a folio-move rule, not a new transaction",
      { exception: "folio_consolidation" });
  }
  // A known code with an R suffix whose description says "… Rejection" (SINR,
  // FULR, NEWR in the newer MFSD201): a rejection of that transaction. Every
  // such row in the sample was a consolidation reversal, so the meaning of a
  // genuine one (a bounced SIP debit?) is not yet evidenced — held.
  if (code.length > 3 && code.endsWith("R") && KFIN_CODES[code.slice(0, -1)] && REJECT_WORD.test(desc)) {
    return make("rejection", "inferred", `KFintech ${code} ("${i.description.trim()}") rejects a ${KFIN_CODES[code.slice(0, -1)].cls.replace("_", " ")} — held until a non-consolidation sample shows what it means`, { exception: "rejection_semantics_unverified" });
  }
  if (KFIN_PRE_REJECTION.has(code) || PRE_REJECT.test(desc)) {
    const linked = (i.rejOriginalNo ?? "").trim() !== "";
    return make("rejection", "verified",
      linked
        ? `KFintech pre-rejection ${code} naming its original — held: linking a rejection to its original is not implemented in this phase`
        : `KFintech pre-rejection ${code} that does not name the transaction it rejects — held`,
      { exception: "pre_rejection_unlinked" });
  }
  if (REVERSAL.test(desc)) return make("reversal", "verified", "KFintech reversal — held until it can be linked to its original", { exception: "reversal_unlinked" });
  if (CANCEL.test(desc)) return make("cancellation", "verified", "KFintech cancellation — held until it can be linked to its original", { exception: "cancellation_unlinked" });

  const known = KFIN_CODES[code];
  if (known) {
    if (head && head !== known.head) {
      return make("unknown", "verified", `KFintech code ${code} with Transaction Head "${head}" — the verified file always paired it with ${known.head}; held`, { exception: "head_code_conflict" });
    }
    return make(known.cls, "verified", `KFintech ${code}`);
  }
  if (/(?:DIVIDEND|IDCW)/.test(desc)) {
    return make(/REINV/.test(desc) ? "idcw_reinvest" : "idcw_payout", "inferred",
      "IDCW wording — no IDCW row was in the verified sample, so the layout is unconfirmed and the row is held",
      { exception: "class_unverified_idcw" });
  }
  return make("unknown", "inferred", `KFintech transaction code "${code || "(blank)"}" is not one the verified sample showed — held, not guessed`, { exception: "unknown_transaction_code" });
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
