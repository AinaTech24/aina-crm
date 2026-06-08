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

const SPREADSHEET_EXT = new Set(["xls", "xlsx", "xlsb", "xlsm", "ods", "dbf"]);

/** Cell → canonical string. Dates → YYYY-MM-DD; numbers stringified as-is. */
function cellToStr(c: unknown): string {
  if (c == null) return "";
  if (c instanceof Date) {
    // Guard against Excel's 1899/1900 epoch noise — only emit a real date.
    const t = c.getTime();
    return Number.isFinite(t) ? c.toISOString().slice(0, 10) : "";
  }
  return String(c).replace(/\r?\n/g, " ").trim();
}

/** A header row is the first row (scanning the top 20) with the most non-empty
 *  cells — title banners have 1–2 filled cells, the real header has many. */
function findHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const scan = Math.min(rows.length, 20);
  for (let i = 0; i < scan; i++) {
    const nonEmpty = rows[i].filter((c) => c && c.trim() !== "").length;
    // Require at least 3 populated columns to qualify as a header.
    if (nonEmpty >= 3 && nonEmpty > bestScore) {
      bestScore = nonEmpty;
      best = i;
    }
  }
  return best;
}

function spreadsheetToPipeText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  if (!wb.SheetNames.length) return "";

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
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][];
  const rows: string[][] = matrix.map((r) => r.map(cellToStr));
  if (!rows.length) return "";

  const headerIdx = findHeaderRow(rows);
  const out = rows.slice(headerIdx).map((r) => r.join("|"));
  return out.join("\n");
}

/** Quote-aware split for a delimited line. */
function splitDelimited(line: string, delim: string): string[] {
  if (delim !== ",") return line.split(delim);
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
    else if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
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
 * Decode an uploaded RTA file to canonical pipe-delimited text.
 * Always safe to call — falls back to UTF-8 text on any decode error.
 */
export function decodeRtaToText(buf: Buffer, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  try {
    if (SPREADSHEET_EXT.has(ext)) return spreadsheetToPipeText(buf);
    return normalizeDelimitedText(buf.toString("utf8"));
  } catch {
    // Last-ditch: hand back raw text so the parser at least tries.
    return buf.toString("utf8");
  }
}
