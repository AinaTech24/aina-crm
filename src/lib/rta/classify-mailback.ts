/**
 * Classify a forwarded RTA mailback attachment → (source, kind) by its filename
 * report-code and the sender's domain.
 *
 * This mirrors the detection the manual upload route already trusts
 * (src/app/api/rta-imports/upload/route.ts uses `/r9/i` + `/mfsd\s*(211|203)/i`)
 * and the per-source file-name hints in src/lib/rta/file-types.ts. We deliberately
 * do NOT guess when nothing matches — an unrecognised file is quarantined for a
 * human rather than mis-imported (a master mis-routed as a feed silently skips
 * tens of thousands of rows).
 *
 * Master / holdings (folio_master_dump / cas_holdings) route to the RICH engine
 * (creates the client book); everything else routes to the feed processor.
 */

import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";

export type MailbackClass = {
  source: RtaSource;
  kind: RtaFileKind;
  /** True → the master/holdings "rich" engine; false → the feed processor. */
  isRich: boolean;
  /** Human label for logs / the import row remarks. */
  label: string;
};

const RICH_KINDS = new Set<RtaFileKind>(["folio_master_dump", "cas_holdings"]);

/** Resolve CAMS vs KFintech from the sending address's domain. */
export function sourceFromSender(fromAddress: string | undefined | null): RtaSource | null {
  const s = (fromAddress ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("cams")) return "cams";
  if (s.includes("kfin") || s.includes("karvy")) return "kfintech";
  return null;
}

/** Resolve CAMS vs KFintech from the file name when the sender is ambiguous. */
function sourceFromFileName(name: string): RtaSource | null {
  const n = name.toLowerCase();
  // CAMS report codes are often GLUED to a long numeric prefix (e.g.
  // "…214436725R9.zip"), so match on a TRAILING boundary (separator or end) —
  // NOT a leading word boundary — mirroring the kind detector. `\br9\b` failed
  // exactly this case and quarantined real R9 masters as "unrecognised".
  if (/r9(?=[._\-\s]|$)/.test(n) || /wbr/.test(n) || /r2(?=[._\-\s]|$)/.test(n) || /r10(?=[._\-\s]|$)/.test(n) || /cams/.test(n)) {
    return "cams";
  }
  if (/mfsd|kfin|karvy/.test(n)) return "kfintech";
  return null;
}

/**
 * Classify by (filename, senderDomain). Returns null when unrecognised so the
 * caller can quarantine rather than mis-import.
 */
export function classifyMailback(
  fileName: string,
  fromAddress: string | undefined | null
): MailbackClass | null {
  const source = sourceFromSender(fromAddress) ?? sourceFromFileName(fileName);
  if (!source) return null;

  const n = fileName.toLowerCase();
  const mk = (kind: RtaFileKind, label: string): MailbackClass => ({
    source,
    kind,
    isRich: RICH_KINDS.has(kind),
    label,
  });

  // A report code is a "token" when followed by a separator or end-of-name —
  // the same trailing-boundary idiom the manual upload route trusts (/r9(?=\.|_|-|$)/),
  // so "WBR9", "1234_R9", "R9.xls" all match but "R90"/"R20" don't.
  const B = "(?=[._\\-\\s]|$)";

  // ── Master / holdings (RICH engine) — most specific, checked first ──────────
  //  CAMS WBR9/R9 = combined master + holdings; KFintech MFSD211 = folio master.
  if (new RegExp(`r9${B}`).test(n) || /mfsd\s*_?211/.test(n)) {
    return mk("folio_master_dump", "Folio master (CAMS WBR9/R9 / KFintech MFSD211)");
  }
  //  KFintech MFSD203 = holdings / valuation.
  if (/mfsd\s*_?203/.test(n)) {
    return mk("cas_holdings", "Holdings (KFintech MFSD203)");
  }

  // ── Feed kinds ──────────────────────────────────────────────────────────────
  if (/aum/.test(n)) return mk("monthly_aum_statement", "Monthly AUM statement");
  if (/brok|commission|\bcomm[_\- ]|brmth|\bbr[_\- ]/.test(n)) {
    return mk("monthly_brokerage", "Monthly brokerage statement");
  }
  if (/(sip.*(reject|bounce|return|fail|dishon))|(reject.*(sip|nach))|nach.*(reject|return|dishon)/.test(n)) {
    return mk("sip_rejection_report", "SIP rejection report");
  }
  if (/mandate|umrn|nach.*(status|regist)/.test(n)) {
    return mk("nach_mandate_status", "NACH mandate status");
  }
  if (/sip.*(book|register)|active.*sip/.test(n)) {
    return mk("monthly_sip_book", "Monthly SIP book");
  }
  //  Daily transaction feed — CAMS WBR2/R2/R10, KFintech MFSD307/MFSD201.
  if (
    new RegExp(`(?:wbr\\s*_?2|r2|r10)${B}`).test(n) ||
    /mfsd\s*_?307|mfsd\s*_?201|trxn|transaction|\btxn\b|daily|feed/.test(n)
  ) {
    return mk("daily_transaction_feed", "Daily transaction feed");
  }

  return null;
}

/** File extensions we treat as importable RTA data (inside or outside a zip). */
export function isImportableAttachment(fileName: string): boolean {
  return /\.(zip|csv|txt|xls|xlsx|xlsb|xlsm|dbf)$/i.test(fileName.trim());
}
