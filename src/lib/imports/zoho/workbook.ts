/**
 * Read a Zoho export (.xlsx or .csv) into rows, server side.
 *
 * Cells are read RAW: a date cell arrives as its Excel serial (read by
 * values.ts as Indian wall-clock time), text stays text. The library's own
 * formatted text would print dates in the US m/d/yy form and its Date objects
 * in the server's zone.
 */

import * as XLSX from "xlsx";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/investors/import-limits";
import { CONTACT_SIGNATURE } from "./contacts";
import { MEETING_SIGNATURE } from "./meetings";
import { idDamagedByExcel } from "./values";

export type ZohoKind = "contacts" | "meetings";

export class ZohoFileError extends Error {
  status = 400;
}

export async function readZohoFile(file: unknown, kind: ZohoKind): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  if (!(file instanceof File)) throw new ZohoFileError("Choose the Zoho export file.");
  if (file.size > MAX_IMPORT_BYTES) throw new ZohoFileError(`The file is too large (max ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB).`);
  const buf = Buffer.from(await file.arrayBuffer());
  let wb: XLSX.WorkBook;
  try {
    // raw: a CSV's "15/03/2024" stays text instead of being guessed as a US date.
    wb = XLSX.read(buf, { type: "buffer", raw: true, cellDates: false });
  } catch {
    throw new ZohoFileError("This file could not be read. Upload the .xlsx or .csv Zoho exported.");
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new ZohoFileError("The file has no sheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  const headers = (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, blankrows: false })[0] ?? []).map((h) => String(h ?? "").trim());

  const signature = kind === "contacts" ? CONTACT_SIGNATURE : MEETING_SIGNATURE;
  const missing = signature.filter((h) => !headers.includes(h));
  if (missing.length) {
    const other = kind === "contacts" ? MEETING_SIGNATURE : CONTACT_SIGNATURE;
    const wrongFile = other.every((h) => headers.includes(h));
    throw new ZohoFileError(
      wrongFile
        ? `This looks like the Zoho ${kind === "contacts" ? "Meetings" : "Contacts"} export. Upload it in the ${kind === "contacts" ? "Meetings" : "Clients"} step.`
        : `This is not a Zoho ${kind === "contacts" ? "Contacts" : "Meetings"} export — missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`
    );
  }
  if (!rows.length) throw new ZohoFileError("The file has headers but no rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new ZohoFileError(`Too many rows (max ${MAX_IMPORT_ROWS.toLocaleString("en-IN")}).`);

  // Excel destroys 19-digit ids (5.72577E+18). Linking on them would join the wrong records.
  const idCols = kind === "contacts" ? ["Record Id", "Family Owner.id", "Referal Client Name.id"] : ["Record Id", "Contact Name.id"];
  for (const col of idCols) {
    if (rows.some((r) => idDamagedByExcel(r[col]))) {
      throw new ZohoFileError(
        `The "${col}" column was changed by Excel (long numbers turned into 5.7E+18), so records can't be matched. Export again from Zoho and upload that file without opening and saving it in Excel.`
      );
    }
  }
  return { headers, rows };
}
