/**
 * Spreadsheet → rows reader (server-only).
 *
 * CAMS ships some mailback reports as legacy binary Excel `.xls` (OLE2/BIFF)
 * workbooks, or as `.dbf` (FoxPro/dBase — the CAMS folio-master format),
 * rather than CSV. SheetJS reads .xls/.xlsx/.dbf; we flatten the first
 * worksheet into rows of strings so the per-RTA parser sees the same shape it
 * gets from the CSV path. Date-formatted cells become YYYY-MM-DD; every other
 * number is kept as its plain string — the parser decides what each column is.
 *
 * This is the RICH (master/holdings) import path's file-type gate. It used to
 * be parallel to, and historically NARROWER than, decode.ts's extension list
 * used by the plain feed-processor path; both now decide by content
 * (file-kind.ts). It didn't recognise `.dbf` at all, so a DBF
 * master fell through to being decoded as latin-1 CSV TEXT: the binary field-
 * descriptor table (embedded NUL bytes, by DBF's own format) got treated as a
 * header row, failed classification, and then the "unrecognised format"
 * error — built from that same NUL-laden text — crashed the very UPDATE that
 * was trying to record the failure (Postgres text columns reject any embedded
 * NUL: "invalid byte sequence for encoding UTF8: 0x00"). The row was left
 * orphaned in `parsing` until the reaper cleaned it up, with no real reason
 * ever recorded. Recognising `.dbf` here fixes it at the source; `sanitizeText`
 * in rta-import-worker.ts is the second, independent layer — any OTHER file
 * format that manages to produce NUL-bearing text must never be able to crash
 * a status write like this again.
 */

import * as XLSX from "xlsx";
import { assertSpreadsheetSize, cellText, readWorkbook, workbookDate1904 } from "./decode";
import { detectRtaContainer } from "./file-kind";

/**
 * Is this file a workbook SheetJS should read? Decided by CONTENT
 * (`detectRtaContainer`): a CFB/BIFF .xls, an OOXML or ODS package, a DBF
 * table, or markup under a spreadsheet name. A plain zip archive is NOT a
 * spreadsheet (it is unpacked first), and neither is CSV text that happens to
 * be named .xls — the CSV path reads that correctly, SheetJS would guess its
 * dates month-first.
 */
export function isSpreadsheet(data: Uint8Array, filename = ""): boolean {
  return detectRtaContainer(data, filename).type === "workbook";
}

/**
 * Read a spreadsheet's first sheet into rows of strings.
 *
 * Guarded the same way as decode.ts's `decodeRtaToText`: XLSX.read() loads the
 * ENTIRE workbook into an in-memory cell graph — it does not stream — so a
 * very large file costs multiples of its own size in RAM and pins a core
 * synchronously for the whole parse, which starves the worker's event loop and
 * freezes every OTHER background job platform-wide (a 482MB CAMS `.dbf` did
 * exactly this for an hour before decode.ts's guard was added). Same limit,
 * same exported constant, one source of truth.
 *
 * Cells go through decode.ts's `cellText`, the same as the feed path: a cell
 * in a DATE number format becomes YYYY-MM-DD from its serial (pure arithmetic,
 * so no TZ or SheetJS version can move it a day), any other number is
 * `String(n)`. Before, a date cell reached the parsers as a bare serial
 * ("45567"): CAMS converted it, KFintech's D/M/YYYY reader did not, so every
 * KFintech .xls/.xlsx date of birth and report date was dropped.
 */
export function readSpreadsheetToRows(data: Uint8Array, filename = ""): string[][] {
  assertSpreadsheetSize(data.length);
  const kind = detectRtaContainer(data, filename);
  const wb = readWorkbook(data, kind.type === "workbook" ? kind.format : "xlsx");
  const name = wb.SheetNames[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws || !ws["!ref"]) return [];
  const date1904 = workbookDate1904(wb);
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows: string[][] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const row: string[] = new Array(range.e.c - range.s.c + 1);
    let present = false;
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = (ws as Record<string, XLSX.CellObject | undefined>)[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell != null) present = true;
      row[C - range.s.c] = cellText(cell, date1904);
    }
    if (present) rows.push(row); // blankrows: false
  }
  return rows;
}
