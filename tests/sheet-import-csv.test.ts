/**
 * CSV uploads for the Excel imports (2026-11-24): the text is decoded, the separator found, the records parsed,
 * and the headings and rows built the same way as from a workbook — dates kept as typed.
 */
import { describe, expect, it } from "vitest";
import { decodeText, detectDelimiter, parseCsv } from "@/lib/imports/sheet/csv";
import { gridToRows, isWorkbook } from "@/lib/imports/sheet/grid";
import { matchHeaders } from "@/lib/imports/sheet/spec";
import { tasksSpec } from "@/lib/imports/sheet/specs/tasks";
import { parseDay } from "@/lib/imports/sheet/values";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("decodeText", () => {
  it("reads UTF-8, with or without the BOM Excel adds", () => {
    expect(decodeText(bytes("Name\nRamesh ₹5,000"))).toBe("Name\nRamesh ₹5,000");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Name")]))).toBe("Name");
  });
  it("falls back to Windows-1252, what an older Excel saves", () => {
    // "Café" with é as the single byte 0xE9 is not valid UTF-8.
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
  });
});

describe("detectDelimiter", () => {
  it("picks the separator the first record uses", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
  it("ignores separators inside quotes", () => {
    expect(detectDelimiter('"a;b;c;d",e,f\n1,2,3')).toBe(",");
  });
  it("is a comma when there is no separator at all", () => {
    expect(detectDelimiter("just one column\nvalue")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("splits records and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("reads CRLF, bare CR and a missing final newline alike", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("reads quoted fields: commas, doubled quotes and new lines inside them", () => {
    expect(parseCsv('t,d\n"Call, then email","He said ""yes"""\n"line1\nline2",x')).toEqual([
      ["t", "d"], ["Call, then email", 'He said "yes"'], ["line1\nline2", "x"],
    ]);
  });
  it("keeps empty fields and trims spaces", () => {
    expect(parseCsv("a,b,c\n 1 ,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });
  it("reads Excel's =\"…\" long-number form as the number text", () => {
    expect(parseCsv('mobile\n="9876543210"')).toEqual([["mobile"], ["9876543210"]]);
  });
  it("reads a semicolon file like a comma one", () => {
    expect(parseCsv("Title;Priority\nCall client;High")).toEqual([["Title", "Priority"], ["Call client", "High"]]);
  });
  it("a blank line is a record of one empty field — the sheet reader skips it", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"], [""]]);
  });
  it("leaves a date exactly as typed, so the importer reads it day first", () => {
    const [, row] = parseCsv("Due Date\n05/06/2026");
    expect(row[0]).toBe("05/06/2026");
    const d = parseDay(row[0]);
    expect(d.ok && d.value).toBe("2026-06-05");
  });
});

describe("gridToRows", () => {
  it("takes the first row with text as the headings and numbers rows by their place in the file", () => {
    const r = gridToRows([["", ""], ["Title *", "Priority"], ["Call", "High"], ["", ""], ["Email", ""]], "CSV");
    expect(r).toEqual({
      sheetName: "CSV",
      headers: ["Title *", "Priority"],
      rows: [{ n: 3, cells: { "Title *": "Call", Priority: "High" } }, { n: 5, cells: { "Title *": "Email", Priority: "" } }],
    });
  });
  it("offsets the row numbers by where the sheet's range starts", () => {
    const r = gridToRows([["Title"], ["Call"]], "Data", 4);
    expect(r).toMatchObject({ rows: [{ n: 5 }] }); // the heading is sheet row 4, the first data row 5
  });
  it("ignores a repeated heading and columns with no heading", () => {
    const r = gridToRows([["Title", "", "Title", "Notes"], ["A", "x", "B", "C"]], "CSV");
    expect(r).toMatchObject({ headers: ["Title", "Notes"], rows: [{ cells: { Title: "A", Notes: "C" } }] });
  });
  it("says so when there is nothing in the file", () => {
    expect(gridToRows([], "CSV")).toEqual({ error: "The sheet is empty." });
    expect(gridToRows([[""], [""]], "CSV")).toEqual({ error: "The sheet is empty." });
  });
  it("matches a CSV's headings to the columns like a workbook's", () => {
    const grid = parseCsv("Title *,Task Type,Assigned To,Due Date,Whatever\nCall,Follow-up,rahul@x.in,24-11-2026,z");
    const r = gridToRows(grid, "CSV");
    if ("error" in r) throw new Error(r.error);
    const m = matchHeaders(r.headers, tasksSpec);
    expect(m.missing).toEqual([]);
    expect(m.ignored).toEqual(["Whatever"]);
    expect(m.map).toMatchObject({ "Title *": "title", "Task Type": "type", "Assigned To": "assignee", "Due Date": "dueAt" });
  });
});

describe("isWorkbook", () => {
  it("is true for a zip (.xlsx) and an OLE file (.xls), false for text", () => {
    expect(isWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true);
    expect(isWorkbook(bytes("Title,Priority\n"))).toBe(false);
    expect(isWorkbook(new Uint8Array([0xef, 0xbb, 0xbf, 0x54]))).toBe(false);
  });
});
