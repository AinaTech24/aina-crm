/**
 * The operator's file manifest (scripts/rta-file-manifest.ts): daily MFSD201
 * completeness comes from each file's own Report Date — never from the span of
 * its transaction dates — and nothing personal is printed.
 */
import { describe, expect, it } from "vitest";
import { MFSD201_HEADER, MFSD211_HEADER, csvOf, P } from "./rta-real-layouts";
import { calendar, isoDate, manifestOf, maskArn, weekdays } from "../scripts/rta-file-manifest";

const txn = (no: string, date: string, report: string) => ({
  "Fund": "117", "Folio Number": "96000001", "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": date,
  "Nav": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": no, PAN1: P.adult, "Agent Code": "ARN-990004", "Report Date": report,
});

describe("RTA file manifest", () => {
  it("reads dates strictly and lists weekdays only", () => {
    expect(isoDate("8/10/2026")).toBe("2026-10-08");
    expect(isoDate("2026-10-08")).toBe("2026-10-08");
    expect(isoDate("46303")).toBe("2026-10-08");
    expect(isoDate("next week")).toBeNull();
    expect(weekdays("2026-10-09", "2026-10-13")).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
    expect(maskArn("ARN-990004")).toBe("ARN-****04");
  });

  it("one file spanning many trade dates covers ONE report day; the other weekdays are MISSING", () => {
    const m = manifestOf("MFSD201.csv", csvOf(MFSD201_HEADER, [txn("1", "05/10/2026", "08/10/2026"), txn("2", "06/10/2026", "08/10/2026"), txn("3", "07/10/2026", "08/10/2026")]));
    expect(m.report).toBe("MFSD201");
    expect(m.reportDates).toEqual(["2026-10-08"]);
    expect(m.tradeDates).toMatchObject({ min: "2026-10-05", max: "2026-10-07", distinct: 3 });
    const days = calendar([m], "2026-10-05", "2026-10-09");
    expect(days.filter((d) => d.status === "MISSING").map((d) => d.day)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09"]);
    expect(days.find((d) => d.day === "2026-10-08")?.mfsd201).toEqual([m.sha256.slice(0, 12)]);
  });

  it("a master file never counts as a transaction delivery, and no PAN or name is in the manifest", () => {
    const master = manifestOf("MFSD211.csv", csvOf(MFSD211_HEADER, [{ "Fund": "117", "Folio": "96000001", "Product Code": "117EQGR", "Investor Name": "Synthetic Person", "PAN Number": P.adult, "Report Date": "08/10/2026", "Broker Code": "ARN-990004" }]));
    expect(master.report).toBe("MFSD211");
    expect(calendar([master], "2026-10-08", "2026-10-08")[0].status).toBe("MISSING");
    // What the tool writes (--json / stdout) leaves out the raw ARN digits it compares with --arn.
    const { arnDigits: _raw, ...printable } = master;
    const printed = JSON.stringify(printable);
    expect(printed).not.toContain(P.adult);
    expect(printed).not.toContain("Synthetic Person");
    expect(printed).not.toContain("990004");
  });
});
