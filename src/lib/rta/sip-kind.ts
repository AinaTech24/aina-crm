/**
 * "This file is a SIP register, whatever it was uploaded as" — pure, used by the import worker.
 *
 * The upload dialog starts on "Daily transaction feed", and the server only refuses a master /
 * holdings file under a feed kind. A SIP register uploaded under the default went to the
 * transaction-feed engine, which read its rows as ₹0 transactions: the import showed
 * "completed", wrote no SIP, and the SIP book did not move — for a firm that had just uploaded
 * "all its RTA files". Here the file's own columns (or, for the default pick only, its name)
 * decide, so the SIPs reach the book whichever kind was ticked.
 */
import type { RtaFileKind } from "@/db/schema/rta_imports";
import { RICH_KINDS, isSipRegisterFileName } from "./classify-mailback";

/** The header tokens (upper-case, only A–Z 0–9 _) of the first few lines. */
function headerTokens(text: string): Set<string> {
  const out = new Set<string>();
  let from = 0;
  for (let line = 0; line < 6 && from < text.length; line++) {
    let nl = text.indexOf("\n", from);
    if (nl < 0) nl = text.length;
    for (const cell of text.slice(from, Math.min(nl, from + 4000)).split(/[|,\t;]/)) {
      const t = cell.replace(/["'\r]/g, "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
      if (t) out.add(t);
    }
    from = nl + 1;
  }
  return out;
}

const has = (t: Set<string>, ...names: string[]) => names.some((n) => t.has(n));

/** Do the first lines carry a SIP register's columns (CAMS WBR49 / KFintech MFSD230)? */
export function looksLikeSipRegister(text: string): boolean {
  const t = headerTokens(text);
  // A transaction feed has these; a SIP register does not.
  if (has(t, "TRXNNO", "TRXN_TYPE_CODE", "TRADDATE", "TRXN_NO")) return false;
  // CAMS WBR49: AUT_TRNTYP + AUTO_AMOUNT (headers are often cut to ten characters: AUTO_AMOUN, PERIODICIT).
  if (has(t, "AUT_TRNTYP", "AUTO_TRNTYP", "AUTO_TRN_TYPE") && has(t, "AUTO_AMOUN", "AUTO_AMOUNT", "AUTO_AMT")) return true;
  // KFintech MFSD230 "SIP/STP Report": folio is ACNO, TrType, Freq, and the instalment counters.
  if (has(t, "TRTYPE") && has(t, "ACNO") && has(t, "FREQ", "FREQUENCY") && has(t, "PAIDINST", "PENDINST", "INSTALNO")) return true;
  return false;
}

export type SipKindFix = { kind: RtaFileKind; why: string };

/**
 * The kind a file should be read as when it is really a SIP register, or null to leave it alone.
 * A master / holdings upload, a rejection report and a file already read as a register are never touched.
 */
export function reconcileSipKind(declared: RtaFileKind, fileName: string, text: string): SipKindFix | null {
  if (declared === "monthly_sip_book" || declared === "sip_rejection_report" || RICH_KINDS.has(declared)) return null;
  if (looksLikeSipRegister(text)) return { kind: "monthly_sip_book", why: "its own columns are a SIP register's" };
  // The name only decides for the dialog's default pick: a deliberately chosen kind is not second-guessed by a name.
  if (declared === "daily_transaction_feed" && isSipRegisterFileName(fileName)) {
    return { kind: "monthly_sip_book", why: `its name (${fileName.slice(0, 80)}) is a SIP register's` };
  }
  return null;
}
