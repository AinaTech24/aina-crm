/**
 * RTA file decoder — turns ANY uploaded RTA artefact into a single canonical
 * pipe-delimited text that the kind parsers consume.
 *
 * Why this exists: real CAMS / KFintech / BSE / NSE files arrive as `.xls`
 * (BIFF or HTML-masquerading-as-xls), `.xlsx` (zip), `.dbf` (FoxPro NAV master)
 * and `.csv`. The old upload path did `buf.toString("utf8")`, which turns every
 * binary spreadsheet into garbage — so only plain CSV/pipe text ever imported.
 *
 * This module:
 *   1. Reads spreadsheets (xls/xlsx/xlsb/ods/dbf) via SheetJS.
 *   2. Picks the data sheet (the one with the most used cells — RTA exports
 *      often carry a meta "Sheet1" alongside the real data sheet).
 *   3. Detects the header row, skipping leading title/banner rows
 *      ("Next Freedom Lifex Private Limited", "Report Date: …", merged titles).
 *   4. Re-emits header + data as PIPE-delimited text with ISO dates, so every
 *      downstream parser sees one uniform, quote-safe delimiter regardless of
 *      whether the source was xls, xlsx, dbf or a comma CSV.
 *
 * CSV/TXT inputs are re-parsed (quote-aware) and re-emitted as pipe text too,
 * which neutralises embedded commas inside quoted fields.
 */
import * as XLSX from "xlsx";
import { excelSerialToIso, isoFromParts, readDate } from "./values";
import {
  detectRtaContainer,
  decodeTextBytes,
  isEncryptedWorkbook,
  PASSWORD_PROTECTED_WORKBOOK,
  RtaUnreadableFileError,
  type RtaWorkbookFormat,
} from "./file-kind";

const FORMAT_LABEL: Record<RtaWorkbookFormat, string> = {
  xlsx: "Excel (.xlsx)",
  xlsb: "Excel binary (.xlsb)",
  ods: "OpenDocument spreadsheet",
  xls: "Excel 97-2003 (.xls)",
  dbf: "DBF table",
  markup: "HTML / XML spreadsheet",
};

/**
 * Read a workbook with SheetJS — the ONE place both import engines do it.
 *
 * `cellDates: false` on purpose. With `cellDates: true` SheetJS hands back a JS
 * Date, and turning that into a calendar day depends on the SheetJS version and
 * the server's TZ: on 0.18.5 the Date is LOCAL midnight, so under
 * TZ=Asia/Kolkata `toISOString()` printed the day before (2 Oct 2024 →
 * 2024-10-01), and the Dockerfile runs the worker in Asia/Kolkata. Reading the
 * raw serial and converting it with pure arithmetic (`excelSerialToIso`) gives
 * the same day on every version, in every TZ. `cellNF: true` keeps each cell's
 * number format, which is how a date cell is told apart from an amount.
 *
 * `raw: true` for an HTML / XML-2003 "xls": without it SheetJS guesses types
 * in markup and reads "02/10/2024" month-first. The text goes to the parsers,
 * which know the registrar's day-first order.
 *
 * Failures are explicit: a password-protected workbook says so, anything else
 * names the format and SheetJS's reason. (The old feed path swallowed the error
 * and fed the binary to the CSV parser as text.)
 */
export function readWorkbook(buf: Uint8Array, format: RtaWorkbookFormat): XLSX.WorkBook {
  const opts: XLSX.ParsingOptions = { type: "array", cellDates: false, cellNF: true, cellHTML: false };
  if (format === "markup") opts.raw = true;
  try {
    return XLSX.read(buf, opts);
  } catch (e) {
    if (isEncryptedWorkbook(buf, e)) throw new RtaUnreadableFileError(PASSWORD_PROTECTED_WORKBOOK);
    const why = e instanceof Error ? e.message : String(e);
    throw new RtaUnreadableFileError(`Could not read this ${FORMAT_LABEL[format]} file — ${why}.`);
  }
}

/** The workbook's date system: true for the 1904 system (old Mac Excel). */
export function workbookDate1904(wb: XLSX.WorkBook): boolean {
  return !!wb.Workbook?.WBProps?.date1904;
}

/** A Date from a type-"d" cell → its calendar day, whichever way SheetJS anchored it. */
function dateObjectToIso(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  // 0.20.x anchors date cells at UTC midnight; 0.18.x at LOCAL midnight. Read
  // the components in whichever frame the value is a whole day in.
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  const localMidnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  const iso =
    !utcMidnight && localMidnight
      ? isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate())
      : isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return iso ?? "";
}

function numberFormatOf(cell: XLSX.CellObject): string | null {
  const z = cell.z as unknown;
  if (typeof z === "string") return z;
  if (typeof z === "number") {
    const table = (XLSX.SSF as unknown as { get_table?: () => Record<number, string> }).get_table?.();
    return table?.[z] ?? null;
  }
  return null;
}

/**
 * One cell → canonical text.
 *   - a number in a DATE format → YYYY-MM-DD from the serial (timezone-proof)
 *   - any other number → the number itself, `String(n)`: no thousands
 *     separators, no locale, no rounding to the displayed format
 *   - a type-"d" date cell → its calendar day
 *   - text → trimmed, line breaks flattened to spaces
 */
export function cellText(cell: XLSX.CellObject | undefined, date1904: boolean): string {
  if (!cell) return "";
  switch (cell.t) {
    case "n": {
      const v = cell.v as number;
      if (typeof v !== "number" || !Number.isFinite(v)) return "";
      const fmt = numberFormatOf(cell);
      if (fmt && XLSX.SSF.is_date(fmt)) {
        const iso = excelSerialToIso(v, date1904);
        // A date format on a value no calendar day fits (a bare time, a
        // pre-1900 serial): keep what the sheet displays rather than invent one.
        return iso ?? flatten(cell.w ?? String(v));
      }
      return String(v);
    }
    case "d": {
      const v = cell.v as unknown;
      if (v instanceof Date) return dateObjectToIso(v);
      const r = readDate(String(v ?? ""));
      return r.ok && r.value ? r.value : flatten(String(v ?? ""));
    }
    case "e":
      return flatten(cell.w ?? "");
    case "z":
      return "";
    default:
      return flatten(String(cell.v ?? ""));
  }
}

const flatten = (s: string) => s.replace(/\r?\n/g, " ").trim();

function spreadsheetToPipeText(buf: Uint8Array, format: RtaWorkbookFormat): string {
  const wb = readWorkbook(buf, format);
  if (!wb.SheetNames.length) return "";
  const date1904 = workbookDate1904(wb);

  // Pick the sheet with the largest used range (rows × cols).
  let sheetName = wb.SheetNames[0];
  let bestCells = -1;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const r = XLSX.utils.decode_range(ws["!ref"]);
    const cells = (r.e.r - r.s.r + 1) * (r.e.c - r.s.c + 1);
    if (cells > bestCells) {
      bestCells = cells;
      sheetName = name;
    }
  }

  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"]) return "";
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // Stream the sheet row-by-row directly into pipe-delimited lines. We read
  // cells off the worksheet ourselves instead of XLSX.utils.sheet_to_json,
  // which would materialise the ENTIRE sheet as a JS matrix AND a second
  // string[][] copy — on a large RTA master (tens of thousands of rows) those
  // intermediates pile on top of an already-heavy SheetJS workbook and helped
  // push big imports into a heap OOM. One pass, one output array, no copies.
  const lines: string[] = [];
  // Non-empty VALUE count per emitted line, kept only for the first 20 lines,
  // to locate the header row below (banner/title rows fill 1–2 cells; the real
  // header fills many). This replaces the old findHeaderRow(rows[][]) scan.
  const headScores: number[] = [];
  const cells: string[] = new Array(range.e.c - range.s.c + 1);
  for (let R = range.s.r; R <= range.e.r; R++) {
    let present = 0; // cells that EXIST in the sheet (matches blankrows:false)
    let nonEmptyVal = 0; // cells with a non-empty value (header heuristic)
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = (ws as Record<string, XLSX.CellObject | undefined>)[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell != null) present++;
      const v = cellText(cell, date1904);
      cells[C - range.s.c] = v;
      if (v !== "") nonEmptyVal++;
    }
    if (present === 0) continue; // skip truly blank rows (no cells at all)
    if (headScores.length < 20) headScores.push(nonEmptyVal);
    lines.push(cells.join("|"));
  }
  if (!lines.length) return "";

  // Header = first of the top-20 emitted lines with the most populated cells
  // (≥3 to qualify) — title banners have far fewer.
  let headerIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < headScores.length; i++) {
    if (headScores[i] >= 3 && headScores[i] > bestScore) {
      bestScore = headScores[i];
      headerIdx = i;
    }
  }
  return lines.slice(headerIdx).join("\n");
}

/**
 * Quote-aware split for a delimited line, handling BOTH `"` and `'` quoting.
 *
 * CAMS mailback CSVs quote every text field with SINGLE quotes:
 *   'FOLIOCHK','INV_NAME','ADDRESS1',…
 *   '3409723/63','Swapan Kumar Das','S/O JITENDRA NATH DAS FLAT N-5,3RD FLOOR',…
 *
 * Treating `'` as ordinary text broke these files two ways: header cells kept
 * their literal quotes so no report signature ever matched ("header did not match
 * any known report"), and any address containing a comma was split into extra
 * columns, shifting every field after it.
 *
 * A quote character only opens a field when it appears at the START of that
 * field, so apostrophes inside names (O'Brien, D'Souza) are still just text.
 */
function splitDelimited(line: string, delim: string): string[] {
  if (delim !== ",") return line.split(delim);
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let atFieldStart = true;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quote) {
      // Doubled quote inside a quoted field is a literal quote.
      if (ch === quote && line[i + 1] === quote) {
        cur += quote;
        i++;
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }

    if (atFieldStart && (ch === '"' || ch === "'")) {
      quote = ch as '"' | "'";
      atFieldStart = false;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      atFieldStart = true;
      continue;
    }
    // Leading spaces before a quote still count as "before the field".
    if (!(atFieldStart && ch === " ")) atFieldStart = false;
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Detect a delimited file's delimiter from its first populated line. */
function sniffDelim(text: string): "|" | "\t" | "," {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const pipes = (line.match(/\|/g) ?? []).length;
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  if (pipes >= commas && pipes >= tabs && pipes > 0) return "|";
  if (tabs >= commas && tabs > 0) return "\t";
  return ",";
}

/** Re-emit a delimited text file as pipe-delimited (neutralising quoted commas). */
function normalizeDelimitedText(raw: string): string {
  const delim = sniffDelim(raw);
  if (delim === "|") return raw; // already canonical
  return raw
    .split(/\r?\n/)
    .map((line) => (line.trim() === "" ? "" : splitDelimited(line, delim).map((c) => c.trim()).join("|")))
    .join("\n");
}

/**
 * Refusal to decode a spreadsheet that is too large to hold in memory.
 * Distinct type so the caller can report it as actionable config advice rather
 * than an opaque crash.
 */
export class RtaFileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RtaFileTooLargeError";
  }
}

/**
 * Ceiling for SheetJS input. XLSX.read() materialises the ENTIRE workbook as an
 * in-memory cell graph — it does not stream — so a very large spreadsheet costs
 * multiples of its own size in RAM and pins a core for the whole parse.
 *
 * A real 482MB CAMS `.dbf` (inside a 28MB zip) held one core at 100% for an hour
 * at ~3GB RSS and, because the parse is synchronous, starved the worker's event
 * loop — freezing every other background job platform-wide. Failing fast with
 * advice the operator can act on beats taking the platform down.
 *
 * CSV/text is NOT subject to this: it's read as a string and never enters SheetJS.
 */
export const SPREADSHEET_MAX_BYTES = Number(process.env.RTA_SPREADSHEET_MAX_BYTES ?? 150 * 1024 * 1024);

/** Refuse a workbook too large for SheetJS (see SPREADSHEET_MAX_BYTES). */
export function assertSpreadsheetSize(bytes: number, label = "spreadsheet"): void {
  if (bytes <= SPREADSHEET_MAX_BYTES) return;
  const mb = (n: number) => `${Math.round(n / 1048576)}MB`;
  throw new RtaFileTooLargeError(
    `This ${label} file is ${mb(bytes)}, over the ${mb(SPREADSHEET_MAX_BYTES)} limit for spreadsheet formats. ` +
      `Re-request this report from the RTA with File Type = CSV — CSV imports at any size, ` +
      `and a file this large in a binary format would stall every background job while it parsed.`
  );
}

/**
 * Decode an uploaded RTA file (already unpacked from any zip) to canonical
 * pipe-delimited text.
 *
 * What the file IS comes from its bytes (`detectRtaContainer`), not its name:
 * a workbook goes through SheetJS, delimited text through the BOM / UTF-8 /
 * UTF-16 aware text decoder. Anything it cannot read THROWS with a reason the
 * operator can act on — a password-protected workbook, a PDF, a zip inside the
 * zip, an oversized spreadsheet. (It used to fall back to "the bytes as UTF-8
 * text", which turned every unreadable binary into an "unrecognised header".)
 */
export function decodeRtaToText(buf: Uint8Array, fileName: string): string {
  const kind = detectRtaContainer(buf, fileName);
  switch (kind.type) {
    case "zip-archive":
      throw new RtaUnreadableFileError(
        "This file is itself a zip archive. Archives are unpacked once — a zip inside a zip is not read; upload the inner file."
      );
    case "unsupported":
      throw new RtaUnreadableFileError(kind.reason);
    case "workbook":
      assertSpreadsheetSize(buf.length, FORMAT_LABEL[kind.format]);
      return spreadsheetToPipeText(buf, kind.format);
    case "text":
      return normalizeDelimitedText(decodeTextBytes(buf));
  }
}
