/**
 * Is a KFintech "… Rejection" (R-coded) row a FOLIO CORRECTION? — pure, and
 * decided from the figures, never from the wording.
 *
 * Verified on the October 2026 MFSD201 (Phase 3E, 18 of 18 groups):
 * when the registrar consolidates folio A into folio B, it re-reports each
 * affected transaction under ONE transaction number as
 *   - the original row in folio A (SIN / FUL / NEW …, as first reported),
 *   - a row with the same code + "R" in folio A that negates it exactly
 *     (units and amount, lot by lot for a redemption), and
 *   - a re-post in folio B with exactly the original's units and amount,
 * all in one scheme. Folio A then nets to zero and MFSD203 shows it at zero;
 * folio B is in MFSD211. The R rows' description ("SIP Rejection",
 * "Redemption Rejection", "Purchase Rejection") is NOT their meaning.
 *
 * A group is a folio correction only when every one of those facts holds. Any
 * other R-coded group — an R row with no re-post, a re-post that does not
 * equal the original, a second scheme or a third folio — is NOT proved and
 * stays an unverified rejection / reversal, held.
 */

/** KFintech base transaction codes whose "R" form has been seen (SIN, FUL, NEW) or follows the same scheme. */
export const KFIN_BASE_CODES = new Set(["SIN", "ADD", "NEW", "FUL", "RED", "SWD", "STPA", "STPO"]);

/** Is this KFintech code a known base code with an "R" suffix? */
export function isKfinReversalCode(code: string | null | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase();
  return c.length > 3 && c.endsWith("R") && KFIN_BASE_CODES.has(c.slice(0, -1));
}

export type ConsolidationRow = {
  folio: string;
  scheme: string;
  /** KFintech `Transaction Type` (SIN, SINR …). */
  code: string;
  units: number | null;
  amount: number | null;
};

export type ConsolidationProof =
  | { proved: true; fromFolio: string; toFolio: string; baseCodes: string[]; reason: string }
  | { proved: false; reason: string };

// Units are printed to 3–4 places and amounts to 2; compare in integer
// thousandths / hundredths so float noise never decides.
const u = (x: number) => Math.round(x * 10_000);
const a = (x: number) => Math.round(x * 100);

export function proveFolioConsolidation(rows: ConsolidationRow[]): ConsolidationProof {
  const no = (reason: string): ConsolidationProof => ({ proved: false, reason });
  if (rows.some((r) => r.units === null || r.amount === null)) return no("a row of the group has no units or amount");
  const rRows = rows.filter((r) => isKfinReversalCode(r.code));
  if (!rRows.length) return no("no R-coded row in the group");
  if (new Set(rows.map((r) => r.scheme)).size !== 1) return no("the group spans more than one scheme");
  const from = new Set(rRows.map((r) => r.folio));
  if (from.size !== 1) return no("the R-coded rows are in more than one folio");
  const fromFolio = [...from][0];
  if (rRows.some((r) => r.units! >= 0 || r.amount! >= 0)) return no("an R-coded row does not carry negative units and amount");
  const bases = new Set(rRows.map((r) => r.code.trim().toUpperCase().slice(0, -1)));
  const originals = rows.filter((r) => r.folio === fromFolio && !isKfinReversalCode(r.code));
  if (!originals.length) return no("the R-coded rows have no original in the same folio and file");
  if (originals.some((r) => !bases.has(r.code.trim().toUpperCase()))) return no("an original's code differs from the R-coded rows' base code");
  const sum = (list: ConsolidationRow[], f: "units" | "amount") => list.reduce((s, r) => s + (f === "units" ? u(r.units!) : a(r.amount!)), 0);
  if (sum(originals, "units") + sum(rRows, "units") !== 0 || sum(originals, "amount") + sum(rRows, "amount") !== 0) {
    return no("the R-coded rows do not negate the original exactly");
  }
  const others = rows.filter((r) => r.folio !== fromFolio);
  const to = new Set(others.map((r) => r.folio));
  if (to.size !== 1) return no(to.size ? "the transaction is re-posted into more than one other folio" : "the transaction is not re-posted into another folio");
  const toFolio = [...to][0];
  if (others.some((r) => isKfinReversalCode(r.code) || !bases.has(r.code.trim().toUpperCase()))) return no("the re-post's code differs from the original's");
  if (sum(others, "units") !== sum(originals, "units") || sum(others, "amount") !== sum(originals, "amount")) {
    return no("the re-post does not equal the original in units and amount");
  }
  return {
    proved: true, fromFolio, toFolio, baseCodes: [...bases].sort(),
    reason: `folio correction: the registrar moved this ${[...bases].join("/")} transaction from one folio to another (original, an exact negating ${[...bases].map((b) => b + "R").join("/")} row and an equal re-post, one scheme) — not a rejection and not a new transaction`,
  };
}
