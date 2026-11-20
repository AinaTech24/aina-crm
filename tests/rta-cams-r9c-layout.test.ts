import { describe, expect, it } from "vitest";
import { parseRtaCsv } from "@/lib/rta";

// CAMS "R9C" investor static details WITH balance (a firm's …R9C.csv,
// 20 Nov 2026). It names the PAN PAN_PEKRN, the scheme only by PRODUCT_CODE
// (no SCH_NAME), and prints dates month-first with a 12-hour clock. It was
// refused as "Unrecognised RTA file format — header did not match any known
// report. First columns: AMC_CODE, PRODUCT_CODE, FOLIOCHK, INV_NAME, ADDRESS1".
// All values below are made up.
const HEADER =
  "'AMC_CODE','PRODUCT_CODE','FOLIOCHK','INV_NAME','ADDRESS1','CITY','PINCODE','EMAIL','HOLDING_NATURE','PAN_PEKRN'," +
  "'TAX_STATUS','INV_DOB','MOBILE_NO','NOM_NAME','RELATION','NOM_PERCENTAGE','FOLIO_DATE','FH_KYC','CLOS_BAL','RUPEE_BAL','COUNTRY'";
const row = (product: string, folio: string, dob: string, units: number, value: number, kyc = "KYC OK") =>
  `'B','${product}','${folio}','Test Client One  ','1 SAMPLE ROAD, NEAR PARK','SAMPLECITY','400001','client@example.com','SI','ABCDE1234F',` +
  `'Individual','${dob}','+919000000000','Test Nominee  ','Father',100,'3/4/2013  12:00:00 AM','${kyc}',${units},${value},'India'`;

describe("CAMS R9C layout (PAN_PEKRN, PRODUCT_CODE, no SCH_NAME)", () => {
  const text = [
    HEADER,
    row("B1180B", "1000000001", "9/14/1982  12:00:00 AM", 1000.5, 65000.25),
    row("B51", "1000000001", "9/14/1982  12:00:00 AM", 10, 1000),
  ].join("\n");
  const r = parseRtaCsv(text);

  it("is recognised as a CAMS full (master + holdings) file", () => {
    expect(r.source).toBe("cams");
    expect(r.kind).toBe("full");
    expect(r.warnings).toEqual([]);
    expect(r.folios).toHaveLength(1);
  });

  it("reads PAN, schemes by product code, units and value", () => {
    const f = r.folios[0];
    expect(f.amcCode).toBe("B");
    expect(f.investor.pan).toBe("ABCDE1234F");
    expect(f.schemes.map((s) => s.schemeCode)).toEqual(["B1180B", "B51"]);
    expect(f.schemes[0].units).toBe(1000.5);
    expect(f.aum).toBeCloseTo(66000.25, 2);
    expect(f.investor.address.line1).toBe("1 SAMPLE ROAD, NEAR PARK");
  });

  it("leaves the AMC name blank rather than inventing 'Unknown AMC'", () => {
    expect(r.folios[0].amcName).toBe("");
  });

  it("reads the month-first date with a 12-hour clock", () => {
    expect(r.folios[0].investor.dob).toBe("1982-09-14");
  });

  it("takes KYC from FH_KYC", () => {
    expect(r.folios[0].investor.kycVerified).toBe(true);
    const pending = parseRtaCsv([HEADER, row("B51", "1", "1/2/1990  12:00:00 AM", 1, 1, "KYC Pending")].join("\n"));
    expect(pending.folios[0].investor.kycVerified).toBe(false);
    expect(pending.folios[0].investor.dob).toBe("1990-01-02");
  });

  it("still tells a demographics-only CAMS file apart", () => {
    const r9 = parseRtaCsv("'FOLIOCHK','INV_NAME','PAN_PEKRN','PRODUCT_CODE'\n'1','A','ABCDE1234F','B51'");
    expect(r9.source).toBe("unknown");
    expect(r9.warnings[0]).toMatch(/demographics-only/);
  });
});
