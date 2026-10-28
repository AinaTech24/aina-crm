import { describe, expect, it } from "vitest";
import { sipRejectionEmail, switchEmail, emailDate, NOT_RECORDED, OPEN_SIP_STATUSES } from "@/lib/comms/record-email";

describe("the email about a rejected SIP", () => {
  const rec = {
    rejectionDate: "2026-10-05",
    rejectionAmount: "10000.00",
    rejectionReason: "Insufficient funds",
    reasonCategory: "insufficient_balance",
    schemeName: "HDFC Flexi Cap Fund",
    folioNumber: "1234567/89",
    amcName: "HDFC",
  };

  it("carries the record's own scheme, amount, folio, date and reason", () => {
    const e = sipRejectionEmail(rec);
    expect(e.templateKey).toBe("sip_rejection");
    expect(e.variables["transaction.scheme_name"]).toBe("HDFC Flexi Cap Fund");
    expect(e.variables["transaction.amount"]).toBe("10,000");
    expect(e.variables["transaction.folio_number"]).toBe("1234567/89");
    expect(e.variables["transaction.rejection_reason"]).toBe("Insufficient funds");
    expect(e.variables["transaction.transaction_date"]).toBe("05 Oct 2026");
  });

  it("states a reason in words when the file gave none", () => {
    const e = sipRejectionEmail({ ...rec, rejectionReason: null });
    expect(e.variables["transaction.rejection_reason"]).toMatch(/Insufficient balance/);
    expect(sipRejectionEmail({ ...rec, rejectionReason: " ", reasonCategory: "mandate_expired" }).variables["transaction.reason"]).toMatch(/mandate/i);
    expect(sipRejectionEmail({ ...rec, rejectionReason: null, reasonCategory: null }).variables["transaction.rejection_reason"]).not.toBe("");
  });

  it("sends a dash for a blank folio, scheme or AMC rather than letting another record's fill it", () => {
    const e = sipRejectionEmail({ ...rec, folioNumber: null, schemeName: null, amcName: "", rejectionAmount: null, rejectionDate: null });
    for (const v of Object.values(e.variables)) expect(v.trim()).not.toBe("");
    expect(e.variables["transaction.folio_number"]).toBe(NOT_RECORDED);
  });

  it("uses Indian digit grouping", () => {
    expect(sipRejectionEmail({ ...rec, rejectionAmount: 1250000 }).variables["transaction.amount"]).toBe("12,50,000");
  });
});

describe("the email about a switch / STP / SWP", () => {
  const t = { type: "switch", status: "processed", amount: "50000", schemeName: "Axis Bluechip Fund", folioNumber: "99/1", amcName: "Axis", orderDate: "2026-10-12" };

  it("names the kind of transaction and the record's details", () => {
    const e = switchEmail(t)!;
    expect(e.templateKey).toBe("switch_stp_swp");
    expect(e.variables["transaction.type"]).toBe("Switch");
    expect(e.variables["transaction.amount"]).toBe("50,000");
    expect(e.variables["transaction.transaction_date"]).toBe("12 Oct 2026");
    expect(switchEmail({ ...t, type: "stp" })!.variables["transaction.type"]).toBe("STP");
    expect(switchEmail({ ...t, type: "swp" })!.variables["transaction.type"]).toBe("SWP");
  });

  it("refuses any other kind of transaction", () => {
    expect(switchEmail({ ...t, type: "purchase" })).toBeNull();
    expect(switchEmail({ ...t, type: "sip" })).toBeNull();
  });

  it("refuses one that has not happened — a confirmation for a pending, rejected or cancelled switch would be false", () => {
    for (const status of ["pending", "submitted", "rejected", "failed", "cancelled", "", null, undefined]) {
      expect(switchEmail({ ...t, status: status as string | null | undefined })).toBeNull();
    }
    expect(switchEmail({ ...t, status: "successful" })).not.toBeNull();
  });

  it("sends a dash, never a blank, for a value the record lacks", () => {
    // A blank caller variable is treated as 'not supplied' and filled from the
    // client's latest transaction — another record's folio in this email.
    const e = switchEmail({ ...t, amount: null, folioNumber: null, schemeName: " ", amcName: null, orderDate: null })!;
    for (const v of Object.values(e.variables)) expect(v.trim()).not.toBe("");
    expect(e.variables["transaction.folio_number"]).toBe(NOT_RECORDED);
    expect(e.variables["transaction.amount"]).toBe(NOT_RECORDED);
  });
});

describe("which SIP rejections the client is told about", () => {
  it("only those still being worked", () => {
    expect([...OPEN_SIP_STATUSES]).toEqual(["pending", "client_contacted", "bank_issue", "mandate_issue"]);
  });
});

describe("emailDate", () => {
  it("formats a date and passes a non-date through", () => {
    expect(emailDate("2026-01-09")).toBe("09 Jan 2026");
    expect(emailDate(null)).toBe(NOT_RECORDED);
    expect(emailDate("not a date")).toBe("not a date");
  });
});
