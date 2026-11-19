/**
 * Two things the vittmantra self-hosted copy had and this build lacked (2026-11-19):
 *  - the registrar of a HAND-forwarded mail, read from the quoted "Forwarded message" block;
 *  - a clear message for the CAMS demographics-only master (WBR9), not "unrecognised format".
 */
import { describe, it, expect } from "vitest";
import {
  classifyMailback,
  classifyMailbackFromText,
  sourceFromForwardedBody,
} from "@/lib/rta/classify-mailback";
import { isCamsStaticOnlyFile } from "@/lib/rta/cams";
import { parseRtaRows } from "@/lib/rta";

describe("sourceFromForwardedBody", () => {
  it("reads CAMS from a plain-text forward", () => {
    const body = "---------- Forwarded message ----------\nFrom: CAMS Mailback Server <donotreply@camsonline.com>\nSubject: x";
    expect(sourceFromForwardedBody(body)).toBe("cams");
  });
  it("reads KFintech from an HTML forward (address inside markup)", () => {
    const body = '<div>From: <a href="mailto:mfs@kfintech.com">KFin</a></div>';
    expect(sourceFromForwardedBody(body)).toBe("kfintech");
  });
  it("finds nothing in an ordinary body, or an empty one", () => {
    expect(sourceFromForwardedBody("Hi team, see attached. Thanks, Rahul <rahul@firm.in>")).toBeNull();
    expect(sourceFromForwardedBody(null)).toBeNull();
  });
  it("only looks at the top of the body", () => {
    expect(sourceFromForwardedBody("x".repeat(5000) + " donotreply@camsonline.com")).toBeNull();
  });
});

describe("classifyMailback with a hand-forward", () => {
  it("a WBR4 zip with no registrar name classifies once the registrar is known", () => {
    expect(classifyMailback("BMB220633086R4.zip", "ops@firm.in")?.kind).toBe("folio_master_dump");
    expect(classifyMailback("data.zip", "ops@firm.in")).toBeNull();
    expect(classifyMailback("BMB220633086R4.zip", "ops@firm.in", "cams")?.source).toBe("cams");
  });
  it("R22 / R49 names resolve CAMS even from the firm's own address", () => {
    expect(classifyMailback("214436725R22.zip", "ops@firm.in")?.source).toBe("cams");
    expect(classifyMailback("214436725R49.zip", "ops@firm.in")?.source).toBe("cams");
  });
  it("the sender still wins over a forged body", () => {
    expect(classifyMailback("214436725R9.zip", "x@kfintech.com", "cams")?.source).toBe("kfintech");
  });
  it("Systematic_Registration_Status resolves through the mail text", () => {
    const c = classifyMailbackFromText(
      "Systematic Registration Status report",
      "---------- Forwarded message ----------\nFrom: <donotreply@camsonline.com>",
      "ops@firm.in"
    );
    expect(c?.source).toBe("cams");
    expect(c?.kind).toBe("monthly_sip_book");
  });
});

describe("CAMS demographics-only master", () => {
  const header = ["AMC_CODE", "PRODUCT_CO", "FOLIOCHK", "INV_NAME", "ADDRESS1", "ADDRESS2"];
  it("is recognised and told apart from the with-balance one", () => {
    expect(isCamsStaticOnlyFile(header)).toBe(true);
    expect(isCamsStaticOnlyFile([...header, "RUPEE_BAL", "CLOS_BAL"])).toBe(false);
    expect(isCamsStaticOnlyFile(["Folio", "Name"])).toBe(false);
  });
  it("parseRtaRows says WBR4 is needed", () => {
    const r = parseRtaRows([header, ["A", "B", "123", "Ram", "x", "y"]]);
    expect(r.source).toBe("unknown");
    expect(r.warnings[0]).toMatch(/demographics-only/);
    expect(r.warnings[0]).toMatch(/WBR4/);
  });
});
