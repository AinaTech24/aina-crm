import { describe, expect, it } from "vitest";
import { parseAumStatement, parseSipBook, UnknownRtaLayoutError } from "@/lib/rta/parsers";

describe("CAMS 'C' layout (FOLIOCHK / PAN_PEKRN)", () => {
  it("reads the folio from FOLIOCHK, never the product code", () => {
    const text = [
      "AMC_CODE|PRODUCT_CODE|FOLIOCHK|INV_NAME|PAN_PEKRN|SCH_NAME|CLOS_BAL|NAV|RUPEE_BAL|BROK_DLR_CODE",
      "H|HHRERP|1234567890|A Client|ABCDE1234F|HDFC Balanced Advantage Fund - Regular Growth|100.5|500|50250|ARN-000001",
    ].join("\n");
    const [r] = parseAumStatement(text, "cams").rows;
    expect(r.folioNumber).toBe("1234567890");
    expect(r.schemeCode).toBe("HHRERP");
    expect(r.pan).toBe("ABCDE1234F");
    expect(r.units).toBe(100.5);
    expect(r.aumValue).toBe(50250);
    expect(r.arn).toBe("ARN-000001");
  });
});

describe("an unrecognised header is refused, not read by position", () => {
  it("AUM statement", () => {
    expect(() => parseAumStatement("AMC|PRODUCT_CODE|SOMETHING_ELSE|NAME_X\nH|HHRERP|12|A", "cams")).toThrow(UnknownRtaLayoutError);
  });
  it("SIP register", () => {
    expect(() => parseSipBook("Prodcode|Agent|Fund|Accountno|Scheme\n128MCGP|ARN-1|128|9101|MC", "kfintech")).toThrow(UnknownRtaLayoutError);
  });
  // B-1 integration (2026-10-12): main read a headerless AUM file by
  // position; the RTA release refuses it (no positional fallback — a
  // registrar file whose columns cannot be named is never guessed at).
  // This is a deliberate, documented behaviour change.
  it("a file with no header row is refused, never read by position", () => {
    expect(() => parseAumStatement("ABCDE1234F|9101234|128MCGP|Axis Mid Cap|10|100|1000", "kfintech")).toThrow(UnknownRtaLayoutError);
  });
});
