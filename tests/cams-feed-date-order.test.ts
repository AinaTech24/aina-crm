/**
 * Which way round a feed writes its dates. A daily CAMS feed whose trades all
 * fall on the 1st–12th of a month has no date over 12 to settle it, and read
 * day-first it put real trades months into the future (Anmol Money, Sandeep
 * Garg: 255 rows found on 15 Oct 2026).
 */
import { describe, expect, it } from "vitest";
import { detectDateOrder, parseCamsFeed } from "@/lib/integrations/cams-feed-parser";

const today = "2026-10-15";

describe("detectDateOrder", () => {
  it("a component over 12 settles it", () => {
    expect(detectDateOrder(["25/08/2026", "08/11/2026"], { today })).toBe("dmy");
    expect(detectDateOrder(["08/25/2026", "08/11/2026"], { today })).toBe("mdy");
  });

  it("a one-day CAMS file with a clock is month-first", () => {
    expect(detectDateOrder(["8/11/2026 12:00:00 AM", "8/11/2026 12:00:00 AM"], { today, usClock: true })).toBe("mdy");
  });

  it("the clock is a CAMS clue only", () => {
    expect(detectDateOrder(["8/09/2026 12:00:00 AM"], { today })).toBe("dmy");
  });

  it("a reading that puts trades in the future is the wrong one", () => {
    // 10/12/2026 day-first is 10 Dec (future); month-first is 12 Oct.
    expect(detectDateOrder(["10/12/2026", "10/12/2026"], { today })).toBe("mdy");
  });

  it("with nothing to go on, keeps the Indian day-first default", () => {
    expect(detectDateOrder(["05/06/2026", "05/06/2026"], { today })).toBe("dmy");
  });
});

describe("parseCamsFeed on a one-day month-first file", () => {
  it("dates the trade on 11 Aug, not 8 Nov", () => {
    const text = [
      "FOLIO_NO,PAN,AMC_CODE,PRODCODE,SCHEME,TRXNTYPE,AMOUNT,UNITS,TRADDATE",
      "1234567/89,ABCDE1234F,H,H02,HDFC Flexi Cap Fund,P,5000,10.5,8/11/2026 12:00:00 AM",
      "1234568/89,ABCDE1235F,H,H02,HDFC Flexi Cap Fund,P,2000,4.2,8/11/2026 12:00:00 AM",
    ].join("\n");
    const rows = parseCamsFeed(text);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.orderDate)).toEqual(["2026-08-11", "2026-08-11"]);
  });
});
