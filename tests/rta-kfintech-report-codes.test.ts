/** KFintech report codes the firm can subscribe to, and what the importer makes of each. */
import { describe, expect, it } from "vitest";
import { classifyMailback, classifyMailbackFromText } from "@/lib/rta/classify-mailback";

const K = "mfs@kfintech.com";
describe("KFintech subscription reports", () => {
  it.each([
    ["MFSD307_WBTRN1_1.zip", "daily_transaction_feed"],
    ["MFSD310_WBX1_1.zip", "cas_holdings"],
    ["MFSD311_WBX1_1.zip", "folio_master_dump"],
    ["MFSD313_WBX1_1.zip", "monthly_sip_book"],
    ["MFSD314_WBX1_1.zip", "sip_rejection_report"],
    ["MFSD305_WBBRR1_1.zip", "monthly_brokerage"],
    ["MFSD205_WBBRR1_1.zip", "monthly_brokerage"],
  ])("%s -> %s", (file, kind) => {
    expect(classifyMailback(file, K)?.kind).toBe(kind);
  });

  it("a SIP Registration REJECTION report is not filed as the SIP register", () => {
    expect(classifyMailbackFromText("MFSD 314 -SIP Registration Rejection Report", "", K)?.kind).toBe("sip_rejection_report");
    expect(classifyMailbackFromText("Subscribed SIP Registrations Report", "", K)?.kind).toBe("monthly_sip_book");
  });

  it("reports the CRM has no importer for are left unclassified, not mis-filed", () => {
    for (const f of ["MFSD308_X.zip", "MFSD309_X.zip", "MFSD315_X.zip", "MFSD316_X.zip", "MFSD331_X.zip", "MFSD339_X.zip", "MFSD345_X.zip", "MFSD352_X.zip"]) {
      expect(classifyMailback(f, K)).toBeNull();
    }
  });
});
