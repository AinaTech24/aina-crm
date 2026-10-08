/**
 * E2 — spreadsheet date cells must give the same calendar day in every TZ.
 *
 * decode.ts used to read with `cellDates: true` and print `toISOString()`. On
 * SheetJS 0.18.5 that Date is LOCAL midnight, so under TZ=Asia/Kolkata (the
 * Dockerfile's TZ) every date came out one day early. Dates are now converted
 * from the cell's serial by pure arithmetic when its number format is a date.
 *
 * Each case runs with process.env.TZ set to Asia/Kolkata, UTC and New York
 * (Node re-reads TZ when it changes). Run this file under
 * `TZ=Asia/Kolkata npx vitest run tests/rta-excel-dates.test.ts` too.
 *
 * SYNTHETIC workbooks built in memory; column names are only the ones the
 * parsers match on — they say nothing about real registrar layouts.
 */
import { afterAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { cellText, decodeRtaToText } from "@/lib/rta/decode";
import { readSpreadsheetToRows } from "@/lib/rta/xls";
import { parseRtaRows } from "@/lib/rta";
import { camsDate } from "@/lib/rta/cams";
import { dmyToIso } from "@/lib/rta/kfintech";
import { FAKE_FOLIO, FAKE_PAN, SERIAL, makeWorkbook, type CellSpec } from "./rta-fixtures";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ["Asia/Kolkata", "UTC", "America/New_York"];
const FORMATS: Array<{ bookType: XLSX.BookType; name: string }> = [
  { bookType: "xlsx", name: "feed.xlsx" },
  { bookType: "biff8", name: "feed.xls" },
  { bookType: "xlsb", name: "feed.xlsb" },
];

const FEED: CellSpec[][] = [
  ["Folio", "TrDate", "NavDate", "Since", "Amount", "Plain", "Stamp"],
  [
    FAKE_FOLIO,
    { date: SERIAL.oct2_2024 },
    { date: SERIAL.mar31_2025, fmt: "d-mmm-yy" },
    { date: SERIAL.jan1_2000, fmt: "mm/dd/yyyy" },
    { date: 1234567.89, fmt: "#,##0.00" }, // an amount in a thousands format is NOT a date
    45567, // a bare serial with no date format stays a number
    { date: SERIAL.oct2_2024 + 0.75, fmt: "dd/mm/yyyy hh:mm" }, // 6 pm on 2 Oct — still 2 Oct
  ],
];
const EXPECTED_FEED = `Folio|TrDate|NavDate|Since|Amount|Plain|Stamp\n${FAKE_FOLIO}|2024-10-02|2025-03-31|2000-01-01|1234567.89|45567|2024-10-02`;

describe.each(ZONES)("TZ=%s", (tz) => {
  describe.each(FORMATS)("$bookType", ({ bookType, name }) => {
    it("feed decoder emits the calendar day of each date cell", () => {
      process.env.TZ = tz;
      expect(new Date(2024, 0, 1).getTimezoneOffset()).toBe(tz === "Asia/Kolkata" ? -330 : tz === "UTC" ? 0 : 300);
      expect(decodeRtaToText(makeWorkbook(FEED, bookType), name)).toBe(EXPECTED_FEED);
    });

    it("rich-path reader emits the same ISO dates", () => {
      process.env.TZ = tz;
      const rows = readSpreadsheetToRows(makeWorkbook(FEED, bookType), name);
      expect(rows[1]).toEqual([FAKE_FOLIO, "2024-10-02", "2025-03-31", "2000-01-01", "1234567.89", "45567", "2024-10-02"]);
    });
  });

  it("DBF date fields", () => {
    process.env.TZ = tz;
    const dbf = makeWorkbook([["FOLIO", "TRDATE"], ["1", { date: SERIAL.oct2_2024, fmt: "yyyymmdd" }]], "dbf");
    expect(decodeRtaToText(dbf, "nav.dbf")).toBe("FOLIO|TRDATE\n1|2024-10-02");
  });

  it("KFintech master (.xlsx): date cells become dob / report date (they were null)", () => {
    process.env.TZ = tz;
    const wb = makeWorkbook(
      [
        ["Product Code", "Fund", "Folio", "Investor Name", "PAN Number", "Date of Birth", "Report Date", "Fund Description"],
        ["SYN1", "SYN", FAKE_FOLIO, "Synthetic Investor", FAKE_PAN, { date: SERIAL.jan1_2000 }, { date: SERIAL.mar31_2025 }, "Synthetic Equity Fund"],
      ],
      "xlsx"
    );
    const parsed = parseRtaRows(readSpreadsheetToRows(wb, "MFSD211.xlsx"));
    expect(parsed.source).toBe("kfintech");
    expect(parsed.folios[0].investor.dob).toBe("2000-01-01");
    expect(parsed.folios[0].reportDate).toBe("2025-03-31");
  });

  it("CAMS statement (.xls): date cells and bare serials", () => {
    process.env.TZ = tz;
    const wb = makeWorkbook(
      [
        ["foliochk", "inv_name", "pan_no", "sch_name", "product", "amc_code", "clos_bal", "rupee_bal", "inv_dob", "rep_date"],
        [FAKE_FOLIO, "Synthetic Investor", FAKE_PAN, "Synthetic Equity Fund", "SYN1", "S", 10, 1000, { date: SERIAL.jan1_2000 }, SERIAL.oct2_2024],
      ],
      "biff8"
    );
    const parsed = parseRtaRows(readSpreadsheetToRows(wb, "R9.xls"));
    expect(parsed.source).toBe("cams");
    expect(parsed.folios[0].investor.dob).toBe("2000-01-01");
    expect(parsed.folios[0].reportDate).toBe("2024-10-02");
  });
});

describe("type-d date cells, whichever way SheetJS anchors the Date", () => {
  it.each(ZONES)("TZ=%s: local midnight (SheetJS 0.18.x) and UTC midnight (0.20.x) both give the calendar day", (tz) => {
    process.env.TZ = tz;
    // 0.18.5 built LOCAL midnight; `toISOString()` of it is the previous day east of UTC — the original E2 bug.
    expect(cellText({ t: "d", v: new Date(2024, 9, 2) } as XLSX.CellObject, false)).toBe("2024-10-02");
    expect(cellText({ t: "d", v: new Date(Date.UTC(2024, 9, 2)) } as XLSX.CellObject, false)).toBe("2024-10-02");
    expect(cellText({ t: "d", v: "2024-10-02T00:00:00" } as unknown as XLSX.CellObject, false)).toBe("2024-10-02");
  });
});

describe("1904 date system", () => {
  it("a 1904-system workbook's serials are read in that system", () => {
    process.env.TZ = "Asia/Kolkata";
    const s1904 = SERIAL.oct2_2024 - 1462; // the 1904 system starts 1462 days later
    const wb = makeWorkbook([["Folio", "TrDate", "X"], [FAKE_FOLIO, { date: s1904 }, "y"]], "xlsx", { date1904: true });
    expect(XLSX.read(wb, { type: "buffer" }).Workbook?.WBProps?.date1904).toBeTruthy();
    expect(decodeRtaToText(wb, "f.xlsx")).toBe(`Folio|TrDate|X\n${FAKE_FOLIO}|2024-10-02|y`);
  });
});

describe("parser date readers accept ISO", () => {
  it("camsDate: ISO, D/M/YYYY, YYYYMMDD, serial; calendar-checked", () => {
    expect(camsDate("2024-10-02")).toBe("2024-10-02");
    expect(camsDate("02/10/2024")).toBe("2024-10-02");
    expect(camsDate("19850612")).toBe("1985-06-12");
    expect(camsDate("45567")).toBe("2024-10-02");
    expect(camsDate("45567.75")).toBe("2024-10-02"); // the old Math.round said 3 Oct
    expect(camsDate("31/02/2024")).toBeNull();
    expect(camsDate("")).toBeNull();
  });
  it("KFintech dmyToIso: ISO and D/M/YYYY; not a bare serial", () => {
    expect(dmyToIso("2024-10-02")).toBe("2024-10-02");
    expect(dmyToIso("2/10/2024")).toBe("2024-10-02");
    expect(dmyToIso("31/02/2024")).toBeNull(); // used to be "2024-02-31"
    expect(dmyToIso("45567")).toBeNull();
  });
});
