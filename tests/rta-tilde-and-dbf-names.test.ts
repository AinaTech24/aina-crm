import { describe, expect, it } from "vitest";
import { decodeRtaToText, sniffDelim } from "@/lib/rta/decode";
import { parseKfintechFeed } from "@/lib/integrations/cams-feed-parser";
import { parseRtaCsv } from "@/lib/rta";

// Two layouts found in the RTA import status report of 21 Nov 2026. All values are made up.

describe("KFintech transaction report, tilde-separated", () => {
  const header =
    "Product Code~Fund~Folio Number~Scheme Code~Fund Description~Transaction Head~Transaction Number~" +
    "Investor Name~Transaction Status~Transaction Date~Price~Units~Amount~PAN1";
  const line = "ABCD~ABC~1234567~GR~ABC Flexi Cap Fund - Growth~Purchase~987654321~Test Client One~Processed~14/11/2026~45.10~22.172~1000~ABCDE1234F";
  const raw = [header, line].join("\r\n");

  it("is read as tilde-separated", () => {
    expect(sniffDelim(raw)).toBe("~");
    // A comma file with a tilde in its data is not.
    expect(sniffDelim("A,B,C\n1~2,3,4")).toBe(",");
  });

  it("decodes to pipes and parses as a transaction", () => {
    const text = decodeRtaToText(Buffer.from(raw), "MFSD201_test.txt");
    expect(text.split("\n")[0].split("|")).toHaveLength(14);
    const rows = parseKfintechFeed(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].folioNumber).toBe("1234567");
    expect(rows[0].amount).toBe(1000);
    expect(rows[0].externalRef).toContain("987654321");
  });

  it("parses even when handed the raw tilde text", () => {
    expect(parseKfintechFeed(raw)).toHaveLength(1);
  });
});

describe("CAMS master saved as dBASE (column names cut to 10 characters)", () => {
  const header =
    "AMC_CODE,PRODUCT_CO,FOLIOCHK,INV_NAME,ADDRESS1,ADDRESS2,CITY,PINCODE,HOLDING_NA,PAN_PEKRN,TAX_STATUS,INV_DOB,NOM_NAME,RELATION,NOM_PERCEN,FH_KYC,CLOS_BAL,RUPEE_BAL";
  const row = "B,B51,1000000001,Test Client One,1 SAMPLE ROAD,,SAMPLECITY,400001,SI,ABCDE1234F,Individual,9/14/1982  12:00:00 AM,Test Nominee,Father,100,KYC OK,10,1000";

  it("is recognised and reads the truncated columns", () => {
    const r = parseRtaCsv([header, row].join("\n"));
    expect(r.source).toBe("cams");
    expect(r.kind).toBe("full");
    const f = r.folios[0];
    expect(f.schemes[0].schemeCode).toBe("B51");
    expect(f.investor.pan).toBe("ABCDE1234F");
    expect(f.aum).toBe(1000);
  });
});
