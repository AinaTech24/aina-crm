/**
 * RTA Phase 2 — transaction-feed and report parsers, no database.
 *
 * Every layout here is INVENTED (column names taken from the importer's own
 * alias tables). Passing these proves the parsers refuse to guess; it does not
 * prove compatibility with any real CAMS or KFintech report.
 */
import { describe, expect, it } from "vitest";
import {
  parseReverseFeed,
  classifyTransaction,
  directionFor,
  RtaLayoutError,
} from "@/lib/integrations/cams-feed-parser";
import {
  parseSipRejectionReport,
  parseBrokerageStatement,
  parseSipBook,
  parseMandateStatus,
  parseAumStatement,
} from "@/lib/rta/parsers";

const H = "FOLIO_NO|PAN|SCH_CODE|SCH_NAME|TRXN_TYPE|TRXN_NATURE|TRADDATE|AMOUNT|UNITS|NAV|TRXNNO|TRXNSTAT";
const row = (o: Partial<Record<string, string>>) =>
  [
    o.folio ?? "9999999/99", o.pan ?? "AAAPA1234A", o.code ?? "S01", o.name ?? "Example Scheme - Growth",
    o.type ?? "PURCHASE", o.nature ?? "", o.date ?? "02/10/2024", o.amount ?? "1,00,000.00", o.units ?? "1,234.5678",
    o.nav ?? "81.0000", o.ref ?? "T-1", o.status ?? "",
  ].join("|");
const feed = (...rows: string[]) => [H, ...rows].join("\n");

describe("transaction feed — identity and layout", () => {
  it("reads Indian-formatted amounts and units exactly", () => {
    const { rows, rejects } = parseReverseFeed(feed(row({})));
    expect(rejects).toEqual([]);
    expect(rows[0]).toMatchObject({ amount: 100000, units: 1234.5678, nav: 81, orderDate: "2024-10-02", externalRef: "T-1", type: "lumpsum", direction: "inflow", status: "successful" });
  });

  it("refuses a feed with no registrar transaction-number column (line numbers are never an identity)", () => {
    const noRef = "FOLIO_NO|SCH_CODE|TRXN_TYPE|TRADDATE|AMOUNT|UNITS\n1|S|PURCHASE|01/01/2026|10|1";
    expect(() => parseReverseFeed(noRef)).toThrow(RtaLayoutError);
    expect(() => parseReverseFeed(noRef)).toThrow(/registrar transaction number/);
  });

  it("refuses an unrecognised layout instead of reading fixed column positions", () => {
    expect(() => parseReverseFeed("A|B|C|D|E|F|G|H|I|J|K|L|M|N\n1|2|3|4|5|6|7|8|9|10|11|12|13|14")).toThrow(/Unrecognised/);
  });

  it("finds the header below registrar title rows", () => {
    const { rows } = parseReverseFeed(["TRANSACTION REPORT", "Period: Oct 2024", H, row({})].join("\n"));
    expect(rows).toHaveLength(1);
  });

  it("rejects a row with no transaction number instead of synthesising one", () => {
    const { rows, rejects } = parseReverseFeed(feed(row({ ref: "" })));
    expect(rows).toHaveLength(0);
    expect(rejects[0].reason).toMatch(/no registrar transaction number/);
  });

  it("two files with rows in identical positions carry their own registrar refs", () => {
    const a = parseReverseFeed(feed(row({ ref: "A-1" }), row({ ref: "A-2" })));
    const b = parseReverseFeed(feed(row({ ref: "B-1", folio: "8888888/88" }), row({ ref: "B-2" })));
    expect(a.rows.map((r) => r.externalRef)).toEqual(["A-1", "A-2"]);
    expect(b.rows.map((r) => r.externalRef)).toEqual(["B-1", "B-2"]);
  });
});

describe("transaction feed — values never defaulted", () => {
  it.each([
    [{ date: "" }, /date is blank/],
    [{ date: "31/02/2024" }, /real calendar date/],
    [{ date: "15-OCT-24" }, /two-digit year/],
    [{ amount: "" }, /amount is blank/],
    [{ amount: "12,34" }, /comma/],
    [{ units: "" }, /units are blank/],
    [{ folio: "" }, /no folio number/],
  ])("%o is rejected", (o, why) => {
    const { rows, rejects } = parseReverseFeed(feed(row(o as any)));
    expect(rows).toHaveLength(0);
    expect(rejects[0].reason).toMatch(why);
  });

  it("a file written both day-first and month-first accepts only self-evident dates", () => {
    const { rows, rejects } = parseReverseFeed(
      feed(row({ ref: "1", date: "15/05/2026" }), row({ ref: "2", date: "03/15/2026" }), row({ ref: "3", date: "04/05/2026" }))
    );
    expect(rows.map((r) => r.orderDate)).toEqual(["2026-05-15", "2026-03-15"]);
    expect(rejects[0].reason).toMatch(/ambiguous/);
  });
});

describe("transaction classification — no default to purchase", () => {
  it.each([
    ["PURCHASE", "", "lumpsum"],
    ["P234ES", "Systematic Investment", "sip"],
    ["R1", "", "redemption"],
    ["", "Redemption", "redemption"],
    ["TICOB", "", "switch"],
    ["", "IDCW Reinvestment", "dividend_reinvest"],
    ["DIVPAYOUT", "", "dividend_payout"],
    ["", "Systematic Withdrawal Plan", "swp"],
  ])("%s / %s → %s", (code, desc, type) => {
    expect(classifyTransaction(code, desc)).toEqual({ kind: "ok", type });
  });

  it.each([["P"], ["ZZ9"], ["", "Bonus"], ["", "Dividend"], ["", ""], ["TRFI"]])(
    "unknown code %s %s is held back, never a purchase",
    (code, desc = "") => {
      expect(classifyTransaction(code, desc).kind).toBe("unknown");
    }
  );

  it.each([["NEWR", "Purchase Reversal"], ["", "Purchase Rejection"], ["", "Redemption Cancelled"]])(
    "%s %s is a reversal/cancellation, not booked",
    (code, desc) => {
      expect(classifyTransaction(code, desc).kind).toBe("reversal");
    }
  );

  it("a row the STATUS marks rejected keeps its type and is stored as rejected", () => {
    const { rows } = parseReverseFeed(feed(row({ type: "SIP", nature: "SIP Rejection", status: "REJECTED" })));
    expect(rows[0]).toMatchObject({ type: "sip", status: "rejected" });
  });

  it.each(["REVERSED", "CANCELLED", "R", "XYZ"])("status %s is not assumed successful", (status) => {
    const { rows, rejects } = parseReverseFeed(feed(row({ status })));
    expect(rows).toHaveLength(0);
    expect(rejects).toHaveLength(1);
  });

  it("a switch with no IN/OUT leg is not guessed as inflow", () => {
    expect(directionFor("switch", "SWITCH", "", "")).toBeNull();
    expect(directionFor("switch", "TOCOB", "", "")).toBe("outflow");
    expect(directionFor("switch", "", "Switch In", "")).toBe("inflow");
  });

  it("negative amount on a money-in row is held back; on a money-out row it is the outflow", () => {
    const a = parseReverseFeed(feed(row({ amount: "-5,000.00" })));
    expect(a.rows).toHaveLength(0);
    expect(a.rejects[0].reason).toMatch(/could be a reversal/);
    const b = parseReverseFeed(feed(row({ type: "REDEMPTION", amount: "(5,000.00)", units: "-61.7284" })));
    expect(b.rows[0]).toMatchObject({ type: "redemption", direction: "outflow", amount: 5000, units: -61.7284 });
  });
});

describe("report parsers — strict layouts and values", () => {
  it("SIP rejection: blank date is a reject, never today; blank reason code keeps the text", () => {
    const text = [
      "FOLIO_NO|PAN|SCH_NAME|REJECT_DATE|AMOUNT|REASON_CODE|REASON",
      "9999999/99|AAAPA1234A|Example|02/10/2024|5,000.00||Insufficient balance",
      "9999999/99|AAAPA1234A|Example||5,000.00|01|",
    ].join("\n");
    const p = parseSipRejectionReport(text, "cams");
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ rejectionDate: "2024-10-02", amount: 5000, reason: "Insufficient balance" });
    expect(p.rejects[0].reason).toMatch(/blank/);
  });

  it("brokerage: a statement with no brokerage-amount column is refused (it used to import every row at ₹0)", () => {
    expect(() =>
      parseBrokerageStatement("FOLIO_NO|PAN|SCH_CODE|FROM_DATE|TO_DATE|Amount\n1|AAAPA1234A|S|01/09/2024|30/09/2024|100", "cams")
    ).toThrow(/brokerage amount/);
  });

  it("AUM statement: Indian-formatted units and value are read exactly", () => {
    const p = parseAumStatement("FOLIO_NO|SCH_CODE|SCH_NAME|UNITS|NAV|AUM\n9999999/99|S01|Example|1,234.567|81.00|1,00,000.00", "cams");
    expect(p.rows[0]).toMatchObject({ units: 1234.567, nav: 81, aumValue: 100000 });
  });

  it("mandate status: 'Inactive' and 'Not Approved' no longer read as active", () => {
    const p = parseMandateStatus(
      ["PAN|UMRN|STATUS", "AAAPA1234A|U1|Active", "AAAPA1234A|U2|Not Approved", "AAAPA1234A|U3|Inactive"].join("\n"),
      "cams"
    );
    expect(p.rows.map((r) => [r.mandateRefNo, r.status])).toEqual([["U1", "active"], ["U2", "rejected"]]);
    expect(p.rejects[0].reason).toMatch(/Inactive/);
  });

  it("SIP register: unknown frequency is a reject, not monthly; no frequency column is noted", () => {
    const withFreq = parseSipBook(["FOLIO_NO|SCH_CODE|AMOUNT|FREQUENCY", "1|S|1,000|OM", "2|S|1,000|D"].join("\n"), "cams");
    expect(withFreq.rows.map((r) => r.frequency)).toEqual(["monthly"]);
    expect(withFreq.rejects[0].reason).toMatch(/frequency "D"/);
    const noFreq = parseSipBook(["FOLIO_NO|SCH_CODE|AMOUNT", "1|S|1,000"].join("\n"), "cams");
    expect(noFreq.notes[0]).toMatch(/no frequency column/);
  });

  it("an unrecognised report layout throws instead of reading positions", () => {
    expect(() => parseAumStatement("A|B|C\n1|2|3", "cams")).toThrow(/Unrecognised/);
    expect(() => parseSipRejectionReport("A|B|C\n1|2|3", "cams")).toThrow(/Unrecognised/);
  });
});
