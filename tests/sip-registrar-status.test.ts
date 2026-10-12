import { describe, expect, it } from "vitest";
import { parseSipBook } from "@/lib/rta/parsers";
import { registrarSipState } from "@/lib/rta/sip-registrar-status";

const TODAY = "2026-10-09";

// KFintech MFSD243 ("SIP registration report") header, verbatim; rows invented.
const MFSD243 =
  "Zone|Branch|Location|Ihno|Folio|Investor Name|RegistrationDate|Start Date|End Date|No Of Installments|Amount|Scheme|Plan|AgentCode|AgentName|Subbroker|Scheme Name|PAN|SipType|SIP Mode|Fund Code|Product Code|Frequency|Trtype|To Scheme|To Plan|TerminateDate|Status|ToProductCode|ToSchemeName|ECSNO|ECSBankName|ECSAcno|ECSHolderName|RegSlno|InvDpId|InvClientId|DP_InvName|ModifyFlag|umrncode";
const kRow = (folio: string, amount: string, terminate: string, status: string) =>
  `W|Pune|Pune|1|${folio}|A Client|01/01/2020|05/01/2020|05/12/2040|240|${amount}|BC|GP|ARN-1|X||Sundaram Business Cycle Fund|ABCDE1234F|EXISTING FOLIO WITH SIP|ECS|176|176BCGP|Monthly|SIP|||${terminate}|${status}||||||||||||`;

describe("KFintech MFSD243 status", () => {
  const rows = parseSipBook([MFSD243, kRow("6101", "5000", "", "Live SIP"), kRow("6102", "2000", "12/03/2024", "Terminated by Investor")].join("\n"), "kfintech").rows;

  it("reads the Status and TerminateDate columns", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0].registrarStatus).toBe("Live SIP");
    expect(rows[1].registrarStatus).toBe("Terminated by Investor");
    expect(rows[1].registrarEndDate).toBe("2024-03-12");
    expect(rows[1].ceaseDate).toBeUndefined(); // shown, never used to stop the SIP
  });

  it("keeps a live SIP live and says so explicitly", () => {
    expect(registrarSipState(rows[0], "kfintech", TODAY)).toEqual({ status: "active", reason: null, explicitLive: true });
  });

  it("reads a terminated SIP with KFintech's words (a label; the import does not close it)", () => {
    const s = registrarSipState(rows[1], "kfintech", TODAY);
    expect(s.status).toBe("stopped");
    expect(s.reason).toBe("KFintech: Terminated by Investor · ceased 12 Mar 2024");
  });
});

describe("registrar statuses", () => {
  const st = (registrarStatus: string) => registrarSipState({ registrarStatus }, "kfintech", TODAY);
  it("maps each KFintech status", () => {
    expect(st("Terminated").status).toBe("stopped");
    expect(st("Cancelled").status).toBe("stopped");
    expect(st("Process Rejection").status).toBe("rejected");
    expect(st("Bank Rejection").status).toBe("rejected");
    expect(st("Expired").status).toBe("completed");
    expect(st("Live SIP").status).toBe("active");
  });

  it("lets a past cease date outrank a stale live label", () => {
    expect(registrarSipState({ registrarStatus: "Live SIP", ceaseDate: "2025-01-01" }, "kfintech", TODAY).status).toBe("stopped");
  });

  it("an unknown status with no cease date stays active, not explicitly", () => {
    expect(registrarSipState({ registrarStatus: "Normal" }, "kfintech", TODAY)).toEqual({ status: "active", reason: null, explicitLive: false });
  });
});

describe("CAMS WBR49 cease date + remark", () => {
  it("uses the remark as the reason", () => {
    const s = registrarSipState({ ceaseDate: "2024-03-12", registrarRemark: "Customer opted Cancellation." }, "cams", TODAY);
    expect(s).toEqual({ status: "stopped", reason: "CAMS: Customer opted Cancellation · ceased 12 Mar 2024", explicitLive: false });
  });

  it("reads reversals as rejected", () => {
    expect(registrarSipState({ ceaseDate: "2024-03-12", registrarRemark: "Three consecutive  reversals" }, "cams", TODAY).status).toBe("rejected");
  });

  it("a remark without a cease date does not stop a SIP", () => {
    expect(registrarSipState({ registrarRemark: "Goal Achieved (SEBI)" }, "cams", TODAY).status).toBe("active");
  });

  it("a future cease date is not yet a stop", () => {
    expect(registrarSipState({ ceaseDate: "2027-01-01" }, "cams", TODAY).status).toBe("active");
  });
});
