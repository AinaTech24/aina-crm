/**
 * RTA reverse-feed — entry point.
 *
 * Detects which RTA produced a mailback CSV (by header signature) and dispatches
 * to the matching parser, returning the normalized `RtaParseResult`. Add a new
 * RTA by writing its `is*` + `parse*` pair and wiring it in here.
 */

import { parseCsv } from "./csv";
import { isKfintechFolioMaster, parseKfintechFolioMaster, isKfintechHoldings, parseKfintechHoldings } from "./kfintech";
import { isCamsFile, parseCamsFile } from "./cams";
import type { RtaParseResult } from "./types";
import { maskPansInText } from "./values";

export * from "./types";
export { parseCsv } from "./csv";

/** Parse a delimited RTA file (Kfintech CSVs). */
export function parseRtaCsv(text: string): RtaParseResult {
  return parseRtaRows(parseCsv(text));
}

/**
 * How many leading rows to search for the real header before giving up. Real
 * files put it on row 0 (CSV) or row 1 (KFintech .xls banner); a small window
 * absorbs a registrar adding a second preamble line without letting a malformed
 * file scan its entire body.
 */
const HEADER_SCAN_ROWS = 10;

/**
 * Index of the first row that matches a known report signature — i.e. the real
 * header. Returns 0 when nothing matches, so an unrecognised file still reports
 * its actual first row in the error message.
 */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i++) {
    const h = rows[i].map((c) => (c ?? "").trim());
    if (isCamsFile(h) || isKfintechHoldings(h) || isKfintechFolioMaster(h)) return i;
  }
  return 0;
}

/**
 * Dispatch already-tabulated rows (from the CSV parser or the .xls reader) to
 * the matching RTA parser by header signature.
 */
export function parseRtaRows(allRows: string[][]): RtaParseResult {
  // Drop fully-empty trailing lines.
  const all = allRows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
  if (!all.length) {
    return { source: "unknown", kind: "unknown", reportType: "", totalRows: 0, folios: [], warnings: ["Empty file"], missingPan: 0 };
  }

  // The header is NOT always the first row. KFintech's .xls downloads open with
  // a one-cell title banner — "Client AUM" (MFSD203), "INVESTOR MASTER DETAILS"
  // (MFSD211), "TRANSACTION REPORT" (MFSD201) — and put the real header on row 1.
  // Reading row 0 as the header matched no signature, so every one of those files
  // was rejected as "Unrecognised RTA file format" and a firm's whole valuation
  // feed silently never imported. (The zipped CSV variants have no banner, which
  // is why the same report imports fine from the mailback and fails from the
  // portal download — the difference that made this hard to spot.)
  //
  // The banner row survives the empty-line filter because the sheet is padded to
  // the full column count, so it is a 37/87/123-cell row that happens to be blank
  // except for the title. Scan the first few rows for one that actually matches a
  // known signature and treat THAT as the header.
  const rows = all.slice(findHeaderRow(all));
  const header = rows[0].map((h) => h.trim());

  // CAMS folio statement (combined master + holdings).
  if (isCamsFile(header)) {
    const { reportType, folios, missingPan, warnings } = parseCamsFile(rows);
    return { source: "cams", kind: "full", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  // Kfintech holdings is checked before the master: it shares some columns but
  // adds Balance / NAV / AUM, so its signature is the more specific match.
  if (isKfintechHoldings(header)) {
    const { reportType, folios, missingPan, warnings } = parseKfintechHoldings(rows);
    return { source: "kfintech", kind: "holdings", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  if (isKfintechFolioMaster(header)) {
    const { reportType, folios, missingPan, warnings } = parseKfintechFolioMaster(rows);
    return { source: "kfintech", kind: "master", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  return {
    source: "unknown",
    kind: "unknown",
    reportType: "",
    totalRows: rows.length - 1,
    folios: [],
    // The "header" of an unrecognised file can be a data row; never echo a PAN from it.
    warnings: [
      maskPansInText(`Unrecognised RTA file format — header did not match any known report. First columns: ${header.slice(0, 6).join(", ")}`),
    ],
    missingPan: 0,
  };
}
