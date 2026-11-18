/**
 * A CAMS .xls that is an ENCRYPTED workbook used to be filed as "49 data lines, layout not
 * recognised" (the decoder swallowed SheetJS's "File is password-protected" and read the
 * binary as text). It is now recognised, opened with the saved passwords, and — when no
 * password fits — refused with a message that says so.
 */
import { describe, expect, it } from "vitest";
import * as officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";
import { decodeRtaToText, RtaUnreadableSpreadsheetError } from "@/lib/rta/decode";
import { encryptedOfficeMessage, isEncryptedOffice, openEncryptedOffice } from "@/lib/rta/office-decrypt";

function workbook(): Buffer {
  const rows = [["Folio", "Scheme", "Amount", "Date"], ...Array.from({ length: 6 }, (_, i) => [`123${i}/45`, "Fund A", 1000 + i, "2026-11-17"])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("password-protected Excel from a registrar", () => {
  const plain = workbook();
  const locked = Buffer.from(officeCrypto.encrypt(plain, { password: "Secret@12" }));

  it("recognises an encrypted workbook and not a plain one", () => {
    expect(isEncryptedOffice(locked)).toBe(true);
    expect(isEncryptedOffice(plain)).toBe(false);
    expect(isEncryptedOffice(Buffer.from("a|b\n1|2\n"))).toBe(false);
  });

  it("opens it with the right saved password, among several", async () => {
    const r = await openEncryptedOffice(locked, ["Other#1", "Secret@12"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(decodeRtaToText(r.data, "WebTrxns_H.xls")).toContain("Folio|Scheme|Amount|Date");
  });

  it("finds the password when it was saved without its trailing space", async () => {
    const withSpace = Buffer.from(officeCrypto.encrypt(plain, { password: "Secret@12 " }));
    const r = await openEncryptedOffice(withSpace, ["Secret@12"]);
    expect(r.ok).toBe(true);
  });

  it("says no saved password fits instead of inventing a layout problem", async () => {
    const r = await openEncryptedOffice(locked, ["nope", "also-nope"]);
    expect(r).toEqual({ ok: false, triedCount: 2 });
    expect(encryptedOfficeMessage(2)).toMatch(/password-protected.*none of the 2 saved passwords/s);
    expect(encryptedOfficeMessage(0)).toMatch(/no password is saved/);
  });

  it("the decoder no longer turns a binary workbook into garbage text", () => {
    let err: unknown;
    try { decodeRtaToText(locked, "WebTrxns_H_ARN-110756_17-Nov-2026.xls"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RtaUnreadableSpreadsheetError);
    expect((err as Error).message).toMatch(/password-protected/i);
  });

  it("still hands plain text named .xls to the text reader", () => {
    const t = decodeRtaToText(Buffer.from("Folio|Amount\n1|2\n3|4\n"), "x.xls");
    expect(t).toContain("Folio");
  });
});
