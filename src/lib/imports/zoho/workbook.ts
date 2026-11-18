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
import { FAMILY_SIGNATURE } from "./family-groups";
import { idDamagedByExcel } from "./values";

export type ZohoKind = "contacts" | "meetings" | "families";

const SIGNATURE: Record<ZohoKind, string[]> = { contacts: CONTACT_SIGNATURE, meetings: MEETING_SIGNATURE, families: FAMILY_SIGNATURE };
const NAME: Record<ZohoKind, string> = { contacts: "Contacts", meetings: "Meetings", families: "family sheet" };
const STEP: Record<ZohoKind, string> = { contacts: "Clients", meetings: "Meetings", families: "Families" };

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

  const missing = SIGNATURE[kind].filter((h) => !headers.includes(h));
  // A Contacts export also carries the family columns, so it is a valid family
  // sheet; only a Meetings export in another step is called out by name.
  if (missing.length) {
    const other = (Object.keys(SIGNATURE) as ZohoKind[]).find((k) => k !== kind && k !== "families" && SIGNATURE[k].every((h) => headers.includes(h)));
    throw new ZohoFileError(
      other
        ? `This looks like the Zoho ${NAME[other]} export. Upload it in the ${STEP[other]} step.`
        : `This is not a Zoho ${NAME[kind]} — missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`
    );
  }
  if (!rows.length) throw new ZohoFileError("The file has headers but no rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new ZohoFileError(`Too many rows (max ${MAX_IMPORT_ROWS.toLocaleString("en-IN")}).`);

  // Excel destroys 19-digit ids (5.72577E+18). Linking on them would join the wrong records.
  const idCols = kind === "contacts" ? ["Record Id", "Family Owner.id", "Referal Client Name.id"] : kind === "families" ? ["Record Id", "Family Owner.id"] : ["Record Id", "Contact Name.id"];
  for (const col of idCols) {
    if (rows.some((r) => idDamagedByExcel(r[col]))) {
      throw new ZohoFileError(
        `The "${col}" column was changed by Excel (long numbers turned into 5.7E+18), so records can't be matched. Export again from Zoho and upload that file without opening and saving it in Excel.`
      );
    }
  }
  return { headers, rows };
}

/**
 * Read EVERY sheet of a workbook — a Zoho export of a module with subforms
 * (MF Transactions + "SIP and SIP Stop" + "Purchase and Redemption") arrives as
 * one workbook with a sheet per form. Same raw reading and Excel-damage check
 * as readZohoFile.
 */
export async function readZohoWorkbook(file: unknown): Promise<{ sheets: Record<string, Record<string, unknown>[]>; headers: Record<string, string[]> }> {
  if (!(file instanceof File)) throw new ZohoFileError("Choose the Zoho export file.");
  if (file.size > MAX_IMPORT_BYTES) throw new ZohoFileError(`The file is too large (max ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB).`);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", raw: true, cellDates: false });
  } catch {
    throw new ZohoFileError("This file could not be read. Upload the .xlsx Zoho exported.");
  }
  const sheets: Record<string, Record<string, unknown>[]> = {};
  const headers: Record<string, string[]> = {};
  let total = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    sheets[name] = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
    headers[name] = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, range: 0, blankrows: false })[0] ?? []).map((h) => String(h ?? "").trim());
    total += sheets[name].length;
    for (const col of headers[name].filter((h) => /(^Record Id$|\.id$|^Parent ID$)/.test(h))) {
      if (sheets[name].some((r) => idDamagedByExcel(r[col]))) {
        throw new ZohoFileError(`Sheet "${name}", column "${col}" was changed by Excel (long numbers turned into 5.7E+18). Export again from Zoho and upload that file without opening and saving it in Excel.`);
      }
    }
  }
  if (total > MAX_IMPORT_ROWS * 2) throw new ZohoFileError(`Too many rows (max ${(MAX_IMPORT_ROWS * 2).toLocaleString("en-IN")}).`);
  return { sheets, headers };
}
