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

/** Kinds handled by the master/holdings "rich" engine rather than the feed processor. */
export const RICH_KINDS = new Set<RtaFileKind>(["folio_master_dump", "cas_holdings"]);

/** Resolve CAMS vs KFintech from the sending address's domain. */
export function sourceFromSender(fromAddress: string | undefined | null): RtaSource | null {
  const s = (fromAddress ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("cams")) return "cams";
  if (s.includes("kfin") || s.includes("karvy")) return "kfintech";
  return null;
}

/**
 * Resolve the RTA from a MANUALLY FORWARDED mail's quoted header block.
 *
 * A hand-forward (not an auto-forward rule) rewrites `From:` to the forwarder's own
 * address, so sourceFromSender sees the firm's mailbox and reports no RTA. The original
 * sender survives in the block Gmail / Zoho / Outlook insert:
 *
 *     ---------- Forwarded message ----------
 *     From: CAMS Mailback Server <donotreply@camsonline.com>
 *
 * Taken from the vittmantra self-hosted copy (2026-11-19). This is NOT a trust decision:
 * body text can be forged. It only lets a file be CLASSIFIED when the sender line cannot
 * say; the mail is still routed to a firm by its forward address, and a link is still
 * fetched only from an allow-listed registrar host (`mailback-download.ts`).
 */
export function sourceFromForwardedBody(body: string | undefined | null): RtaSource | null {
  const b = body ?? "";
  if (!b) return null;
  // Only the leading part: enough for the quoted header block, without scanning a big
  // HTML payload on every message. ANY address in it counts — in an HTML forward the
  // address sits inside markup, so a `From:`-anchored pattern would miss the common case.
  const head = b.slice(0, 4000);
  const addrs = head.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) ?? [];
  for (const a of addrs) {
    const hit = sourceFromSender(a);
    if (hit) return hit;
  }
  return null;
}

/** Resolve CAMS vs KFintech from the file name when the sender is ambiguous. */
function sourceFromFileName(name: string): RtaSource | null {
  const n = name.toLowerCase();
  // CAMS report codes are often GLUED to a long numeric prefix (e.g.
  // "…214436725R9.zip"), so match on a TRAILING boundary (separator or end) —
  // NOT a leading word boundary — mirroring the kind detector. `\br9\b` failed
  // exactly this case and quarantined real R9 masters as "unrecognised".
  //
  // r4 / r22 / r49 belong here too: a real WBR4 zip ("…BMB220633086R4.zip") has no "wbr"
  // or "cams" in its name, so without them a mail whose sender line is not the registrar
  // (a hand-forward) resolved to NO source and the file was quarantined as unrecognised.
  // CAMS also ships "Systematic_Registration_Status_P_….xls" with no report code at all.
  if (
    /r9(?=[._\-\s]|$)/.test(n) ||
    /wbr/.test(n) ||
    /r2(?=[._\-\s]|$)/.test(n) ||
    /r22(?=[._\-\s]|$)/.test(n) ||
    /r4(?=[._\-\s]|$)/.test(n) ||
    /r49(?=[._\-\s]|$)/.test(n) ||
    /r10(?=[._\-\s]|$)/.test(n) ||
    /cams/.test(n) ||
    /systematic[_\- ]?registration|registration[_\- ]?status/.test(n)
  ) {
    return "cams";
  }
  if (/mfsd|kfin|karvy/.test(n)) return "kfintech";
  return null;
}

// A report code is a "token" when followed by a separator or end-of-name —
// the same trailing-boundary idiom the manual upload route trusts (/r9(?=\.|_|-|$)/),
// so "WBR9", "1234_R9", "R9.xls" all match but "R90"/"R20" don't.
const B = "(?=[._\\-\\s]|$)";

// CAMS suffixes a single letter to mark a VARIANT of the same report — WBR9 /
// WBR9A / WBR9B / WBR9C are all the investor-static feed, WBR2 and WBR2C are both
// the transaction feed. Without allowing that letter, "WBR2C. Investor
// Transactions feed Lot level" downloaded fine and was then dropped as an unknown
// report code (seen in production for Attitude Financial Services). The trailing
// boundary still applies AFTER the optional letter, so a code glued to more
// characters ("R29…", "R2UTLDI…") still does not match — only a real variant does.
const V = "[a-z]?" + B;

/**
 * Full report TITLES as the registrars write them in the subject line, for the
 * mails that carry no report code at all. Deliberately whole-phrase patterns:
 * a bare /transaction/ would match almost any registrar mail, but "folio wise
 * transaction report" names exactly one report. Observed in production
 * 2026-08-03 — KFintech omits the MFSD code from several subjects.
 */
const REPORT_TITLES: Array<[RegExp, RtaFileKind, string]> = [
  [/folio\s*[-\s]?wise\s+transaction/i, "daily_transaction_feed", "Folio-wise transaction report"],
  [/investor\s+transactions?\s+for\s+a\s+period/i, "daily_transaction_feed", "Investor transactions for a period"],
  // WBR2C words it differently: "Investor Transactions feed Lot level for a Period".
  [/investor\s+transactions?\s+feed/i, "daily_transaction_feed", "Investor transactions feed (lot level)"],
  [/client\s*[-\s]?wise\s+aum/i, "cas_holdings", "Client-wise AUM report"],
  [/master\s+aum|investor\s+master\s+details/i, "folio_master_dump", "Master AUM / investor master details"],
  [/investors?\s+static\s+details/i, "folio_master_dump", "Investor static details"],
  [/aum\s+on\s+a\s+specific\s+date/i, "cas_holdings", "AUM on a specific date by scheme by investor"],
  [/sip\s*\/?\s*stp\s+procured/i, "monthly_sip_book", "SIP/STP procured for the period"],
  [/brokerage\s+(statement|report)|commission\s+(statement|report)/i, "monthly_brokerage", "Brokerage statement"],
  [/sip\s+(rejection|bounce|dishonour)/i, "sip_rejection_report", "SIP rejection report"],
  [/sip\s+registrations?/i, "monthly_sip_book", "SIP registrations report"],
  [/systematic\s*registration/i, "monthly_sip_book", "Systematic registration status"],
];

/**
 * Map a haystack (filename, or a mail's subject+body) to a report kind.
 *
 * `codesOnly` is set when the haystack is EMAIL TEXT rather than a filename.
 * Prose legitimately contains words like "daily" and "transaction" — e.g. CAMS'
 * own subject "Investor Transactions for a Period" — so matching the loose
 * keyword patterns against a body would mis-file reports. In text mode we
 * therefore trust ONLY explicit registrar report codes.
 */
/** File names (lower-cased) a SIP register goes by when it carries no report code. */
const SIP_REGISTER_NAME =
  /systematic[_\-\s]*(?:transaction[_\-\s]*)?regist|sip[_\-\s]*stp[_\-\s]*(?:procured|report|regist)|sip[_\-\s]*regist|sip[_\-\s]*(?:cease|cancel)/;

function detectKind(haystack: string, codesOnly: boolean): { kind: RtaFileKind; label: string } | null {
  const n = haystack.toLowerCase();

  // ── Master / holdings (RICH engine) — most specific, checked first ──────────
  //  CAMS WBR9/R9 = combined master + holdings.
  //  KFintech MFSD211 = folio master; MFSD311 is the same report delivered by
  //  email subscription ("Master AUM/Investor Master Details Report").
  //  WBR4 = "Investors Static Details with balance" — master + balances, same
  //  shape as WBR9 (observed arriving in production 2026-08-03).
  if (new RegExp(`r9${V}`).test(n) || new RegExp(`(?:wbr\\s*_?4|r4)${V}`).test(n) || /mfsd\s*_?(211|311)/.test(n)) {
    return { kind: "folio_master_dump", label: "Folio master (CAMS WBR9/WBR4 / KFintech MFSD211/311)" };
  }
  //  KFintech MFSD203 = holdings / valuation (MFSD310 = same, subscription mode).
  //  CAMS WBR22 = "AuM on a specific date by Scheme by Investor" — same shape
  //  (per-investor per-scheme units/value), observed in production 2026-08-04.
  if (/mfsd\s*_?(203|310)/.test(n)) {
    return { kind: "cas_holdings", label: "Holdings / AUM by investor (KFintech MFSD203/310)" };
  }
  //  CAMS WBR22 = "AuM on a specific date by Scheme by Investor". It carries
  //  the same facts as MFSD203 (folio · scheme · units · NAV · closing value)
  //  but its layout is BROK_DLR_CODE/PRODUCT/FOLIO/UNITS/NAV/CLOSING_ASSETS and
  //  — critically — it has NO PAN COLUMN.
  //
  //  It used to be routed to cas_holdings alongside MFSD203, which sends it to
  //  the rich engine. That engine resolves investors by PAN and counts a
  //  PAN-less row as skippedNoPan, so every row of a WBR22 was discarded: a
  //  real file carrying Rs 354 Cr imported nothing. The AUM-statement path is
  //  the right one — it groups by folio and resolveInvestorId() already falls
  //  back to the folio when the PAN is absent, which is exactly this shape.
  if (new RegExp(`(?:wbr\\s*_?22|r22)${V}`).test(n)) {
    return { kind: "monthly_aum_statement", label: "AUM by scheme by investor (CAMS WBR22)" };
  }

  //  SIP register — CAMS WBR49 ("SIP/STP procured for the period"),
  //  KFintech MFSD230/243/313 (313 observed in production 2026-08-05).
  if (new RegExp(`(?:wbr\\s*_?49|r49)${V}`).test(n) || /mfsd\s*_?(230|243|313)/.test(n)) {
    return { kind: "monthly_sip_book", label: "SIP register (CAMS WBR49 / KFintech MFSD313)" };
  }

  //  Daily transaction feed — CAMS WBR2/R2/R10, KFintech MFSD307/MFSD201.
  //  Checked before the looser keyword kinds so an explicit code always wins.
  if (new RegExp(`(?:wbr\\s*_?2|r2|r10)${V}`).test(n) || /mfsd\s*_?(307|201)/.test(n)) {
    return { kind: "daily_transaction_feed", label: "Daily transaction feed" };
  }

  if (codesOnly) {
    // No report code present. KFintech frequently omits it from the subject and
    // names the report in words instead ("Folio wise Transaction Report for
    // Ref.no. WTCAM…"), so fall back to a curated list of full report TITLES.
    // These are specific enough to be unambiguous — unlike the loose keyword
    // patterns below, which would mis-file ordinary prose.
    for (const [re, kind, label] of REPORT_TITLES) {
      if (re.test(n)) return { kind, label };
    }
    return null;
  }

  // ── Keyword kinds — filenames only ─────────────────────────────────────────
  if (/aum/.test(n)) return { kind: "monthly_aum_statement", label: "Monthly AUM statement" };
  if (/brok|commission|\bcomm[_\- ]|brmth|\bbr[_\- ]/.test(n)) {
    return { kind: "monthly_brokerage", label: "Monthly brokerage statement" };
  }
  if (/(sip.*(reject|rej\b|rej[_\-\s]|bounce|return|fail|dishon|unsuccess))|(reject.*(sip|nach))|(unsuccess.*sip)|((nach|ecs).*(reject|return|dishon|fail))/.test(n)) {
    return { kind: "sip_rejection_report", label: "SIP rejection report" };
  }
  // A SIP register named in WORDS, not by report code: "Systematic_Registration_Status_P_….xls" (the
  // name CAMS ships it under), "Systematic Transaction Registration", "SIP_STP_Procured", "SIP Registration
  // Report", "SIPSTP_Report", "SIP Cease Report". Each used to be quarantined as "unrecognised" (or,
  // with "transaction" in the name, read as a transaction feed) so its SIPs never reached the book.
  if (SIP_REGISTER_NAME.test(n) && !/mandate|umrn|nach/.test(n)) {
    return { kind: "monthly_sip_book", label: "SIP register" };
  }
  if (/mandate|umrn|nach.*(status|regist)/.test(n)) {
    return { kind: "nach_mandate_status", label: "NACH mandate status" };
  }
  if (/sip.*(book|register)|active.*sip/.test(n)) {
    return { kind: "monthly_sip_book", label: "Monthly SIP book" };
  }
  if (/trxn|transaction|\btxn\b|daily|feed/.test(n)) {
    return { kind: "daily_transaction_feed", label: "Daily transaction feed" };
  }
  return null;
}

/**
 * Classify by (filename, senderDomain). Returns null when unrecognised so the
 * caller can quarantine rather than mis-import.
 */
/**
 * Is this file name, taken ALONE, a SIP rejection / bounce report? For a file found inside a ZIP,
 * where the registrar is already known and the name carries no CAMS / KFintech marker.
 */
export function isSipRejectionFileName(fileName: string): boolean {
  return detectKind(fileName, false)?.kind === "sip_rejection_report";
}

/** Is this file name, taken ALONE, a SIP register (CAMS WBR49 / KFintech MFSD230 / 243 / 313, or a name in words)? */
export function isSipRegisterFileName(fileName: string): boolean {
  return detectKind(fileName, false)?.kind === "monthly_sip_book";
}

export function classifyMailback(
  fileName: string,
  fromAddress: string | undefined | null,
  /**
   * The RTA when it is known by other means than the From: header — a hand-forward
   * rewrites From:, so the poller reads it from the quoted "Forwarded message" block
   * (`sourceFromForwardedBody`) and passes it here.
   */
  knownSource?: RtaSource | null
): MailbackClass | null {
  const source = sourceFromSender(fromAddress) ?? knownSource ?? sourceFromFileName(fileName);
  if (!source) return null;
  const hit = detectKind(fileName, false);
  if (!hit) return null;
  return { source, kind: hit.kind, isRich: RICH_KINDS.has(hit.kind), label: hit.label };
}

/**
 * Classify from the EMAIL ITSELF — subject + body — for mailbacks delivered as a
 * download LINK rather than an attachment. Those arrive with an opaque filename
 * (CAMS: a long token ending in the report code; KFintech: none at all), while
 * the mail states the report explicitly ("Report No: MFSD311", "WBR2. Investor
 * Transactions for a Period").
 *
 * Used as the FALLBACK when the downloaded filename alone doesn't classify.
 */
export function classifyMailbackFromText(
  subject: string | undefined | null,
  body: string | undefined | null,
  fromAddress: string | undefined | null,
  knownSource?: RtaSource | null
): MailbackClass | null {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  const source =
    sourceFromSender(fromAddress) ?? knownSource ?? sourceFromForwardedBody(body) ?? sourceFromFileName(text);
  if (!source) return null;
  const hit = detectKind(text, true); // codes only — prose is too ambiguous
  if (!hit) return null;
  return { source, kind: hit.kind, isRich: RICH_KINDS.has(hit.kind), label: `${hit.label} (from mail text)` };
}

/** File extensions we treat as importable RTA data (inside or outside a zip). */
export function isImportableAttachment(fileName: string): boolean {
  return /\.(zip|csv|txt|xls|xlsx|xlsb|xlsm|dbf)$/i.test(fileName.trim());
}
