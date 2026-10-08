/**
 * E3 — what an uploaded RTA file IS comes from its content.
 *
 * A plain .xlsx starts with "PK" like any zip; the import paths unzipped it and
 * imported one of its internal XML parts. These tests pin the detector and the
 * decoder on SYNTHETIC files built in memory (see tests/rta-fixtures.ts).
 */
import { describe, expect, it } from "vitest";
import { detectRtaContainer, zipEntryNames, PASSWORD_PROTECTED_WORKBOOK } from "@/lib/rta/file-kind";
import { decodeRtaToText } from "@/lib/rta/decode";
import { isSpreadsheet, readSpreadsheetToRows } from "@/lib/rta/xls";
import { extractRtaFileFromZip, RtaArchiveError } from "@/lib/rta/unzip";
import { CSV_FEED, FAKE_FOLIO, makeEncryptedOoxmlLookalike, makeWorkbook, makeZip } from "./rta-fixtures";

const ROWS = [
  ["Folio", "Scheme", "Amount"],
  [FAKE_FOLIO, "Synthetic Equity Fund", 1000],
];

describe("detectRtaContainer", () => {
  it("an .xlsx is a workbook, not an archive — even though it starts with PK", () => {
    const xlsx = makeWorkbook(ROWS, "xlsx");
    expect(xlsx[0]).toBe(0x50);
    expect(xlsx[1]).toBe(0x4b);
    expect(zipEntryNames(xlsx)).toContain("xl/workbook.xml");
    expect(detectRtaContainer(xlsx, "feed.xlsx")).toEqual({ type: "workbook", format: "xlsx" });
    // The name does not decide it: an .xlsx renamed .zip or with no name is still a workbook.
    expect(detectRtaContainer(xlsx, "feed.zip")).toEqual({ type: "workbook", format: "xlsx" });
    expect(detectRtaContainer(xlsx)).toEqual({ type: "workbook", format: "xlsx" });
  });

  it("an .xlsm and .xlsb are workbooks too", () => {
    expect(detectRtaContainer(makeWorkbook(ROWS, "xlsm"), "a.xlsm")).toEqual({ type: "workbook", format: "xlsx" });
    expect(detectRtaContainer(makeWorkbook(ROWS, "xlsb"), "a.xlsb")).toEqual({ type: "workbook", format: "xlsb" });
  });

  it("a real zip of a CSV is an archive", async () => {
    const zip = await makeZip([{ name: "feed.csv", data: CSV_FEED }]);
    expect(detectRtaContainer(zip, "feed.zip")).toEqual({ type: "zip-archive" });
  });

  it("a zip holding an .xlsx FILE is an archive (the workbook is inside it)", async () => {
    const zip = await makeZip([{ name: "feed.xlsx", data: makeWorkbook(ROWS, "xlsx") }]);
    expect(detectRtaContainer(zip, "mail.zip")).toEqual({ type: "zip-archive" });
  });

  it("a BIFF8 .xls (CFB magic D0 CF 11 E0) is a workbook, whatever it is called", () => {
    const xls = makeWorkbook(ROWS, "biff8");
    expect([...xls.subarray(0, 8)]).toEqual([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(detectRtaContainer(xls, "feed.xls")).toEqual({ type: "workbook", format: "xls" });
    expect(detectRtaContainer(xls, "feed.csv")).toEqual({ type: "workbook", format: "xls" });
  });

  it("a DBF is recognised by its header, with or without the .dbf name", () => {
    const dbf = makeWorkbook([["FOLIO", "AMOUNT"], [FAKE_FOLIO, 1000]], "dbf");
    expect(detectRtaContainer(dbf, "nav.dbf")).toEqual({ type: "workbook", format: "dbf" });
    expect(detectRtaContainer(dbf, "nav.bin")).toEqual({ type: "workbook", format: "dbf" });
  });

  it("CSV / TXT is text; an HTML table named .xls is markup for SheetJS", () => {
    expect(detectRtaContainer(Buffer.from(CSV_FEED), "feed.csv")).toEqual({ type: "text" });
    expect(detectRtaContainer(Buffer.from(CSV_FEED), "feed.xls")).toEqual({ type: "text" });
    const html = Buffer.from("<html><table><tr><td>Folio</td><td>Amount</td><td>Scheme</td></tr></table></html>");
    expect(detectRtaContainer(html, "feed.xls")).toEqual({ type: "workbook", format: "markup" });
    expect(detectRtaContainer(html, "feed.csv")).toEqual({ type: "text" });
  });

  it("PDF and gzip are refused with a reason, not read as text", () => {
    expect(detectRtaContainer(Buffer.from("%PDF-1.7\n..."), "r.pdf").type).toBe("unsupported");
    expect(detectRtaContainer(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0]), "r.gz").type).toBe("unsupported");
  });
});

describe("decodeRtaToText / readSpreadsheetToRows on a plain .xlsx", () => {
  it("reads the workbook's cells — not an XML part of it", () => {
    const xlsx = makeWorkbook(ROWS, "xlsx");
    const text = decodeRtaToText(xlsx, "feed.xlsx");
    expect(text).toBe(`Folio|Scheme|Amount\n${FAKE_FOLIO}|Synthetic Equity Fund|1000`);
    expect(text).not.toContain("<?xml");
    expect(isSpreadsheet(xlsx, "feed.xlsx")).toBe(true);
    expect(readSpreadsheetToRows(xlsx, "feed.xlsx")).toEqual([
      ["Folio", "Scheme", "Amount"],
      [FAKE_FOLIO, "Synthetic Equity Fund", "1000"],
    ]);
  });

  it("the zip extractor refuses a workbook outright instead of importing xl/… parts", async () => {
    const xlsx = makeWorkbook(ROWS, "xlsx");
    await expect(extractRtaFileFromZip(xlsx)).rejects.toBeInstanceOf(RtaArchiveError);
  });

  it("a .xls read through the feed decoder", () => {
    expect(decodeRtaToText(makeWorkbook(ROWS, "biff8"), "feed.xls")).toBe(`Folio|Scheme|Amount\n${FAKE_FOLIO}|Synthetic Equity Fund|1000`);
  });

  it("a password-protected (encrypted OOXML in CFB) workbook is rejected with an explicit message", () => {
    const enc = makeEncryptedOoxmlLookalike();
    expect(detectRtaContainer(enc, "book.xlsx")).toEqual({ type: "workbook", format: "xls" });
    expect(() => decodeRtaToText(enc, "book.xlsx")).toThrow(PASSWORD_PROTECTED_WORKBOOK);
    expect(() => readSpreadsheetToRows(enc, "book.xlsx")).toThrow(PASSWORD_PROTECTED_WORKBOOK);
  });

  it("a zip inside the zip, a PDF: refused, not decoded as garbage text", async () => {
    const zip = await makeZip([{ name: "a.csv", data: CSV_FEED }]);
    expect(() => decodeRtaToText(zip, "inner.csv")).toThrow(/zip archive/);
    expect(() => decodeRtaToText(Buffer.from("%PDF-1.4 junk"), "r.pdf")).toThrow(/PDF/);
  });
});
