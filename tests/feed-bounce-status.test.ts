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
