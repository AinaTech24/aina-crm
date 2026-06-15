/**
 * Spreadsheet → rows reader (server-only).
 *
 * CAMS ships some mailback reports as legacy binary Excel `.xls` (OLE2/BIFF)
 * workbooks rather than CSV. SheetJS reads both .xls and .xlsx; we flatten the
 * first worksheet into rows of strings so the per-RTA parser sees the same shape
 * it gets from the CSV path. Numbers (incl. Excel date serials) are kept as raw
 * strings — the parser decides how to interpret each column.
 */

import * as XLSX from "xlsx";

export function isSpreadsheet(data: Uint8Array, filename = ""): boolean {
  // OLE2 (legacy .xls) magic D0 CF 11 E0, or a zip (.xlsx) named .xls/.xlsx.
  const ole2 = data.length > 7 && data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;
  return ole2 || /\.xls[xmb]?$/i.test(filename);
}

export function readSpreadsheetToRows(data: Uint8Array): string[][] {
  const wb = XLSX.read(data, { type: "array", cellDates: false, cellNF: false, cellHTML: false });
  const name = wb.SheetNames[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: false });
  return rows.map((row) => (Array.isArray(row) ? row.map((c) => (c == null ? "" : String(c))) : []));
}
