/**
 * Read an RTA file into its header and data rows, keeping every row's position.
 *
 * A row's number (`rowNo`, 1-based among the data rows after the header) is
 * its position inside THIS immutable file — the batch's checksum pins the
 * file. It is a source reference only, never an economic transaction id.
 *
 * Workbooks go through the same SheetJS reader as the existing importer
 * (date cells become YYYY-MM-DD from the serial, numbers String(n)); delimited
 * text through the same BOM/UTF-16-aware decoder and quote-aware CSV parser.
 * A blank line is not a data row; nothing else is dropped.
 */
import { createHash } from "node:crypto";
import { detectRtaContainer, decodeTextBytes, RtaUnreadableFileError } from "../file-kind";
import { readSpreadsheetToRows } from "../xls";
import { parseCsv } from "../csv";
import { STAGING_MAX_ROWS } from "./config";

export type SourceRow = { rowNo: number; cells: string[] };
export type SourceTable = {
  header: string[];
  /** 0-based index of the header among the file's non-blank lines. */
  headerIndex: number;
  rows: SourceRow[];
};

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Every line of the file as cells, blank lines removed. */
export function readLines(buf: Uint8Array, fileName: string): string[][] {
  const kind = detectRtaContainer(buf, fileName);
  if (kind.type === "zip-archive") throw new RtaUnreadableFileError("This file is a zip archive — the staging pipeline reads the extracted data file.");
  if (kind.type === "unsupported") throw new RtaUnreadableFileError(kind.reason);
  const lines = kind.type === "workbook" ? readSpreadsheetToRows(buf, fileName) : parseCsv(decodeTextBytes(buf));
  return lines.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
}

/** Split lines at the header the caller located; refuse a file over the row cap. */
export function tableFrom(lines: string[][], headerIndex: number): SourceTable {
  const data = lines.slice(headerIndex + 1);
  if (data.length > STAGING_MAX_ROWS) {
    throw new RtaUnreadableFileError(`This file has ${data.length} data rows — more than the staging limit of ${STAGING_MAX_ROWS}. Split it before importing.`);
  }
  return {
    header: lines[headerIndex].map((h) => (h ?? "").trim()),
    headerIndex,
    rows: data.map((cells, i) => ({ rowNo: i + 1, cells })),
  };
}
