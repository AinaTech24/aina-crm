import { describe, expect, it } from "vitest";
import { parseSipBook } from "@/lib/rta/parsers";

// The header KFintech ships in MFSD230 ("SIP/STP Report"), verbatim; data rows
// are invented.
const HEADER =
  "Prodcode|Agent|Fund|Acno|SchCode|SchDesc|InvName|Add1|Add2|Add3|City|State|Pin|Email|OffPhone|ResPhone|TrType|Freq|STARTDATE|ENDDATE|PAIDINST|PENDINST|INSTALNO|AMOUNT|ChqType|SubBroker|IHNO|REMARKS|RegDate|ECSNO|ECSBANKNAMe|ECSACNO|ECSHolderName|SIPType|STPInScheme|StpInPlan|StpInProdCode|CityCategory";
const row = (acno: string, trType: string, amount: string) =>
  `128MCGP|ARN-000001|128|${acno}|MC|Axis Mid Cap Fund - Regular Growth|A Client|1 Road|||Pune|Maharashtra|411001|a@b.in|||${trType}|Monthly|05/01/2020|05/12/2040|60|120|61|${amount}|Normal|12345|100000001|By SIP|01/01/2020|900000001|HDFC Bank|00011122233|A Client|Normal|||||A01`;

describe("KFintech MFSD230 SIP/STP report", () => {
  const rows = parseSipBook([HEADER, row("91012345678", "SIP", "5000.00"), row("91087654321", "STP", "2500.00")].join("\n"), "kfintech").rows;

  it("reads the folio from ACNO, never the ARN", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0].folioNumber).toBe("91012345678");
    expect(rows.every((r) => !r.folioNumber.startsWith("ARN"))).toBe(true);
  });

  it("maps scheme, amount, dates, mandate and the SIP/STP type", () => {
    const r = rows[0];
    expect(r.schemeCode).toBe("128MCGP");
    expect(r.schemeName).toBe("Axis Mid Cap Fund - Regular Growth");
    expect(r.amount).toBe(5000);
    expect(r.frequency).toBe("monthly");
    expect(r.startDate).toBe("2020-01-05");
    expect(r.endDate).toBe("2040-12-05");
    expect(r.mandateRefNo).toBe("900000001");
    expect(r.registrationType).toBe("SIP");
    expect(rows[1].registrationType).toBe("STP");
  });
});
