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

export * from "./types";
export { parseCsv } from "./csv";

export function parseRtaCsv(text: string): RtaParseResult {
  const all = parseCsv(text);
  // Drop fully-empty trailing lines.
  const rows = all.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
  if (!rows.length) {
    return { source: "unknown", kind: "unknown", reportType: "", totalRows: 0, folios: [], warnings: ["Empty file"], missingPan: 0 };
  }
  const header = rows[0].map((h) => h.trim());

  // Holdings is checked first: it shares some columns with the master but adds
  // Balance / NAV / AUM, so its signature is the more specific match.
  if (isKfintechHoldings(header)) {
    const { reportType, folios, missingPan, warnings } = parseKfintechHoldings(rows);
    return { source: "kfintech", kind: "holdings", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  if (isKfintechFolioMaster(header)) {
    const { reportType, folios, missingPan, warnings } = parseKfintechFolioMaster(rows);
    return { source: "kfintech", kind: "master", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  if (isCamsFile(header)) {
    const { reportType, folios, missingPan, warnings } = parseCamsFile(rows);
    return { source: "cams", kind: "unknown", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  return {
    source: "unknown",
    kind: "unknown",
    reportType: "",
    totalRows: rows.length - 1,
    folios: [],
    warnings: [`Unrecognised RTA file format — header did not match any known report. First columns: ${header.slice(0, 6).join(", ")}`],
    missingPan: 0,
  };
}
