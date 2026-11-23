/**
 * A registrar words a bounced SIP many ways. Any status the parser did not know used to fall to
 * "successful", so the bounce was counted as money collected and never reached SIP Rejections.
 */
import { describe, expect, it } from "vitest";
import { parseReverseFeed } from "@/lib/integrations/cams-feed-parser";

const HEAD = "PAN|FOLIO_NO|AMC_CODE|PRODUCT_CODE|SCHEME_NAME|TRXN_TYPE|TRXN_DATE|AMOUNT|UNITS|NAV|STATUS";
const row = (status: string) => `ABCDE1234F|1234567|C|PC1|Some Fund|SIP|17/11/2026|5000|50.0|100.0|${status}`;

function statusOf(status: string) {
  const out = parseReverseFeed([HEAD, row(status)].join("\n"), "t");
  expect(out).toHaveLength(1);
  return out[0].status;
}

describe("a SIP row's status", () => {
  it("keeps the words it always knew", () => {
    expect(statusOf("REJECTED")).toBe("rejected");
    expect(statusOf("FAILED")).toBe("failed");
    expect(statusOf("ALLOTTED")).toBe("successful");
  });

  it("reads the other ways a bounce is worded", () => {
    expect(statusOf("REJ")).toBe("rejected");
    expect(statusOf("Rejected by bank")).toBe("rejected");
    expect(statusOf("SIP DISHONOURED")).toBe("failed");
    expect(statusOf("Unsuccessful")).toBe("failed");
    expect(statusOf("Payment failed")).toBe("failed");
  });

  it("still treats an unknown word on a posted row as processed", () => {
    expect(statusOf("")).toBe("successful");
    expect(statusOf("Units allotted")).toBe("successful");
  });
});

describe("a bounce written in the transaction's type text", () => {
  const H2 = "PAN|FOLIO_NO|AMC_CODE|PRODUCT_CODE|SCHEME_NAME|TRXN_TYPE|TRXN_DATE|AMOUNT|UNITS|NAV|STATUS";
  const r = (type: string, status = "ALLOTTED") => `ABCDE1234F|1234567|C|PC1|Some Fund|${type}|17/11/2026|5000|50.0|100.0|${status}`;
  const out = (type: string, status?: string) => parseReverseFeed([H2, r(type, status)].join("\n"), "t")[0];

  it("reads a SIP row whose type says rejection as rejected, though the status column says allotted", () => {
    expect(out("SIP Rejection").type).toBe("sip");
    expect(out("SIP Rejection").status).toBe("rejected");
    expect(out("Systematic Investment - Dishonoured").status).toBe("failed");
  });

  it("leaves an ordinary SIP instalment alone", () => {
    expect(out("SIP").status).toBe("successful");
    expect(out("Systematic Investment Purchase").status).toBe("successful");
  });
});

describe("other header spellings and the reason a bounce carries", () => {
  const H = "PAN|FOLIO_NO|AMC_CODE|PRODUCT_CODE|SCHEME_NAME|TRXN_TYPE|TRAN_DATE|AMOUNT|UNITS|NAV|TRXN_STATUS|REJECTION_REASON";
  const r = (status: string, reason: string) => `ABCDE1234F|1234567|C|PC1|Some Fund|SIP|17/11/2026|5000|50.0|100.0|${status}|${reason}`;
  const one = (status: string, reason: string) => parseReverseFeed([H, r(status, reason)].join("\n"), "t")[0];

  it("finds the date and status under their other names", () => {
    const t = one("REJECTED", "Insufficient balance");
    expect(t.status).toBe("rejected");
    expect(t.orderDate).toBe("2026-11-17");
  });

  it("carries the reason on a bounce, and none on a processed instalment", () => {
    expect(one("REJECTED", "Insufficient balance").reasonDescription).toBe("Insufficient balance");
    expect(one("ALLOTTED", "").reasonDescription ?? "").toBe("");
  });
});
