/**
 * Read an uploaded .xlsx, .xls or .csv into rows of text, keyed by the sheet's own
 * headings. A workbook's data is on the sheet called "Data" when there is one (the
 * sample has Data, Example and a hidden Lists), else the first sheet. What kind of
 * file it is comes from its first bytes, not its name: a zip (.xlsx) or an OLE
 * container (.xls) goes to the spreadsheet library, anything else is read as CSV text
 * by ./csv.
 */
import * as XLSX from "xlsx";
import { cellText } from "./cell";
import { decodeText, parseCsv } from "./csv";
import { gridToRows, isWorkbook, type SheetRow, type SheetRows } from "./grid";

export type { SheetRow, SheetRows };

const SKIP_SHEETS = /^(instructions|lists|example|examples|sample)$/i;
/** A sheet that formats a million empty rows is still empty: stop after this many in a row. */
const BLANK_RUN_LIMIT = 1000;

function readWorkbook(buf: Buffer): SheetRows | { error: string } {
  let wb: XLSX.WorkBook;
  try {
    // cellNF keeps the number format (it is what says a number is a date).
    wb = XLSX.read(buf, { type: "buffer", raw: true, cellNF: true });
  } catch {
    return { error: "This file could not be read. Upload an Excel (.xlsx) or CSV file." };
  }
  const sheetName =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === "data") ??
    wb.SheetNames.find((n) => !SKIP_SHEETS.test(n.trim())) ??
    wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws || !ws["!ref"]) return { error: "The sheet is empty." };

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const grid: string[][] = [];
  let blankRun = 0;
  for (let r = range.s.r; r <= range.e.r && blankRun < BLANK_RUN_LIMIT; r++) {
    const line: string[] = [];
    let any = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const t = cellText(ws[XLSX.utils.encode_cell({ r, c })] as never);
      line.push(t);
      if (t) any = true;
    }
    grid.push(line);
    blankRun = any ? 0 : blankRun + 1;
  }
  return gridToRows(grid, sheetName, range.s.r + 1);
}

export function readSheetRows(buf: Buffer): SheetRows | { error: string } {
  if (isWorkbook(buf)) return readWorkbook(buf);
  if (buf.length === 0) return { error: "The file is empty." };
  const text = decodeText(buf);
  if (text.includes("\u0000")) return { error: "This file could not be read. Upload an Excel (.xlsx) or CSV file." };
  return gridToRows(parseCsv(text), "CSV");
}
