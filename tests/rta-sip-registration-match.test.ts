/**
 * Which stored SIP an incoming SIP-register row is (lib/rta/sip-match.ts) and the other pure rules
 * of the SIP register import: what is a transfer, what parses, what a file is called, what a file IS.
 *
 * Found on a review of why Ahpal's SIP book did not grow after every RTA file was uploaded.
 */
import { describe, expect, it } from "vitest";
import { matchRegistration, swapDayMonth, type FileFacts, type SipCandidate } from "@/lib/rta/sip-match";
import { hiddenSipsNote, isTransferRegistration } from "@/lib/rta/sip-left-out";
import { cleanTargetScheme, otherDateSpellings, parseSipBook } from "@/lib/rta/parsers";
import { isSipRegisterFileName } from "@/lib/rta/classify-mailback";
import { looksLikeSipRegister, reconcileSipKind } from "@/lib/rta/sip-kind";

const cand = (o: Partial<SipCandidate> = {}): SipCandidate => ({
  id: "a", status: "active", amount: 5000, startDate: "2024-01-05", sipDate: "5", closedBy: null, ...o,
});
const file = (starts: Record<string, number>, liveRows = 1): FileFacts => ({ starts: new Map(Object.entries(starts)), liveRows });
const live = (o: { startDate?: string; amount?: number; sipDate?: string } = {}) => ({ amount: 5000, sipDate: "5", live: true, ...o });
const cancelled = (o: { startDate?: string; amount?: number; sipDate?: string } = {}) => ({ amount: 2000, sipDate: "5", live: false, ...o });

describe("matchRegistration — which stored SIP is this row?", () => {
  it("the same start date is the same registration, and a step-up in amount does not change that", () => {
    const m = matchRegistration(live({ startDate: "2024-01-05", amount: 6000 }), [cand({ amount: 5000 })], file({ "2024-01-05": 1 }));
    expect(m?.id).toBe("a");
  });

  it("a CANCELLED registration never touches a live SIP with another start date", () => {
    const m = matchRegistration(
      cancelled({ startDate: "2020-05-01" }),
      [cand({ id: "live", startDate: "2024-07-05" })],
      file({ "2020-05-01": 1, "2024-07-05": 1 }),
    );
    expect(m).toBeNull();
  });

  it("…but it does stop ITS OWN row", () => {
    const m = matchRegistration(
      cancelled({ startDate: "2020-05-01" }),
      [cand({ id: "old", startDate: "2020-05-01" }), cand({ id: "live", startDate: "2024-07-05" })],
      file({ "2020-05-01": 1, "2024-07-05": 1 }),
    );
    expect(m?.id).toBe("old");
  });

  it("a live row with a NEW start date is a new registration, kept beside the others", () => {
    const m = matchRegistration(live({ startDate: "2024-09-05", amount: 3000 }), [cand({ startDate: "2024-01-05", amount: 5000 })], file({ "2024-01-05": 1, "2024-09-05": 1 }, 2));
    expect(m).toBeNull();
  });

  it("the same SIP re-dated at the registrar (same amount and day) is adopted, not doubled — if the file does not list the old date", () => {
    const m = matchRegistration(live({ startDate: "2024-03-05" }), [cand({ startDate: "2024-01-05" })], file({ "2024-03-05": 1 }));
    expect(m?.id).toBe("a");
    // …but when the file lists the old registration too, they are two.
    const two = matchRegistration(live({ startDate: "2024-03-05" }), [cand({ startDate: "2024-01-05" })], file({ "2024-03-05": 1, "2024-01-05": 1 }, 2));
    expect(two).toBeNull();
  });

  it("a SIP held with no start date (booked by hand) is adopted by a dated live row", () => {
    const m = matchRegistration(live({ startDate: "2024-01-05" }), [cand({ startDate: null })], file({ "2024-01-05": 1 }));
    expect(m?.id).toBe("a");
  });

  it("a cancelled row reaches an undated SIP only when it is the only live one and the file lists nothing live for the folio", () => {
    const only = matchRegistration(cancelled({ startDate: "2020-05-01" }), [cand({ startDate: null })], file({ "2020-05-01": 1 }, 0));
    expect(only?.id).toBe("a");
    const withLive = matchRegistration(cancelled({ startDate: "2020-05-01" }), [cand({ startDate: null })], file({ "2020-05-01": 1 }, 1));
    expect(withLive).toBeNull();
  });

  it("two SIPs that start the same day but debit on different days stay two", () => {
    const f = file({ "2024-01-05": 2 }, 2);
    const fifth = cand({ id: "fifth", sipDate: "5", amount: 5000 });
    // The 20th: no stored SIP has day 20, the file lists two rows for this start date → new registration.
    expect(matchRegistration(live({ startDate: "2024-01-05", sipDate: "20", amount: 3000 }), [fifth], f)).toBeNull();
    // The 5th finds its own row, and with both stored each finds its own.
    const twentieth = cand({ id: "twentieth", sipDate: "20", amount: 3000 });
    expect(matchRegistration(live({ startDate: "2024-01-05", sipDate: "5" }), [fifth, twentieth], f)?.id).toBe("fifth");
    expect(matchRegistration(live({ startDate: "2024-01-05", sipDate: "20", amount: 3000 }), [fifth, twentieth], f)?.id).toBe("twentieth");
  });

  it("where the file gives no start date it is the old folio + scheme rule: the same amount first", () => {
    const a = cand({ id: "a", amount: 5000, startDate: "2024-01-05" });
    const b = cand({ id: "b", amount: 3000, startDate: "2024-02-05" });
    expect(matchRegistration(live({ amount: 3000 }), [a, b], file({}))?.id).toBe("b");
    expect(matchRegistration(live({ amount: 9999 }), [a, b], file({}))?.id).toBe("a");
  });

  it("a closed SIP with the same start date is found when no live copy exists, and a swapped-date copy matches too", () => {
    const closed = cand({ id: "z", status: "stopped", startDate: "2024-01-05" });
    expect(matchRegistration(live({ startDate: "2024-01-05" }), [closed], file({ "2024-01-05": 1 }))?.id).toBe("z");
    // an older CAMS import read 5/1 as 1 May
    const swapped = cand({ id: "z", status: "stopped", startDate: "2024-05-01" });
    expect(swapDayMonth("2024-01-05")).toBe("2024-05-01");
    expect(matchRegistration(live({ startDate: "2024-01-05" }), [swapped], file({ "2024-01-05": 1 }))?.id).toBe("z");
  });

  it("a closed SIP held with no start date is the registration when it began before it closed", () => {
    const closed = cand({ id: "z", status: "completed", startDate: null, closedBy: "2025-06-01" });
    expect(matchRegistration(live({ startDate: "2024-01-05" }), [closed], file({ "2024-01-05": 1 }))?.id).toBe("z");
    expect(matchRegistration(live({ startDate: "2026-01-05" }), [closed], file({ "2026-01-05": 1 }))).toBeNull();
  });
});

describe("isTransferRegistration — only a transfer or withdrawal is not a SIP", () => {
  it.each(["SO", "SI", "R", "DTP", "TP", "STP", "STP Out", "SWP", "Systematic Withdrawal Plan", "Systematic Transfer", "Switch", "Dividend Transfer"])(
    "%s is a transfer / withdrawal",
    (t) => expect(isTransferRegistration(t)).toBe(true),
  );
  it.each(["", "P", "SIP", "XSIP", "ISIP", "Micro SIP", "Systematic Investment Plan", "Systematic Investment", "Normal SIP", "Perpetual", "SIP - Regular", "Regular", "SIP Top-up"])(
    "%j is a SIP",
    (t) => expect(isTransferRegistration(t)).toBe(false),
  );
});

describe("the SIP register parser", () => {
  const HEAD = "AMC_CODE|PRODUCT_CODE|FOLIO_NO|INV_NAME|PAN_NO|AUT_TRNTYP|SCHEME|TARGET_SCH|AUTO_AMOUN|PERIODICIT|PERIOD_DAY|FROM_DATE|TO_DATE|CEASE_DATE|REMARKS";
  const row = (o: Record<string, string> = {}) =>
    ["P", "1746", "1111", "A", "", o.type ?? "P", "Scheme X", o.tgt ?? "", o.amt ?? "5000", o.freq ?? "OM", "5", "1/5/2024 12:00 AM", "12/5/2040 12:00 AM", o.cease ?? "", ""].join("|");
  const one = (o: Record<string, string>) => parseSipBook([HEAD, row(o)].join("\n"), "cams")[0];

  it.each([
    ["5,000.00", 5000], ["Rs. 5,000", 5000], ["Rs 5000", 5000], ["₹5000", 5000], ["INR 5,000.50", 5000.5], ["5000", 5000],
  ])("the amount %j reads as %d", (raw, n) => expect(one({ amt: raw }).amount).toBe(n));

  it.each([
    ["OM", "monthly"], ["Monthly", "monthly"], ["Q", "quarterly"], ["Qtrly", "quarterly"], ["Quarterly", "quarterly"],
    ["OW", "weekly"], ["Wkly", "weekly"], ["Weekly", "weekly"], ["OF", "fortnightly"], ["Fortnightly", "fortnightly"],
    ["Half Yearly", "half_yearly"], ["Half-Yearly", "half_yearly"], ["Semi Annual", "half_yearly"],
    ["OY", "yearly"], ["Yearly", "yearly"], ["Annual", "yearly"], ["Annually", "yearly"],
  ])("the frequency %j is %s", (raw, f) => expect(one({ freq: raw }).frequency).toBe(f));

  it.each([
    ["13-Sep-26", "2026-09-13"], ["13/09/26", "2026-09-13"], ["13.09.2026", "2026-09-13"], ["20260913", "2026-09-13"],
    ["2026/09/13", "2026-09-13"], ["Sep 13, 2026", "2026-09-13"], ["13/09/2026", "2026-09-13"],
  ])("the cease date %j is %s, so the registration is read as cancelled", (raw, iso) => {
    expect(one({ cease: raw }).ceaseDate).toBe(iso);
  });

  it("a date nobody can read stays unread (not today)", () => {
    expect(otherDateSpellings("soon")).toBeNull();
    expect(otherDateSpellings("")).toBeNull();
    expect(one({ cease: "—" }).ceaseDate).toBeUndefined();
  });

  it("a 'target scheme' of 0, -, NA is no target — a plain SIP is not an STP", () => {
    for (const t of ["0", "-", "NA", "N/A", "NIL", "none", " "]) expect(one({ tgt: t }).targetScheme).toBeUndefined();
    expect(cleanTargetScheme("HDFC Liquid Fund")).toBe("HDFC Liquid Fund");
    expect(one({ tgt: "HDFC Liquid Fund" }).targetScheme).toBe("HDFC Liquid Fund");
  });
});

describe("a SIP register by its name", () => {
  it.each([
    "Systematic_Registration_Status_P_20261120.xls", "SIP_STP_Procured.xls", "SIP Registration Report.xlsx", "SIPSTP_Report.zip",
    "SIP_Cease_Report.xls", "Systematic Transaction Registration.xls", "WBR49.zip", "MFSD243.zip", "Active_SIPs.xlsx",
  ])("%s", (n) => expect(isSipRegisterFileName(n)).toBe(true));
  it.each(["NACH_Mandate_Registration.xls", "SIP_Rejection_Report.csv", "WBR2.zip", "Folio_Master.csv", "NACH_Status.xls"])(
    "%s is not one",
    (n) => expect(isSipRegisterFileName(n)).toBe(false),
  );
});

describe("a SIP register by what is inside it", () => {
  const CAMS = "AMC_CODE|PRODUCT_CODE|FOLIO_NO|INV_NAME|PAN_NO|AUT_TRNTYP|SCHEME|TARGET_SCH|AUTO_AMOUN|PERIODICIT|PERIOD_DAY|FROM_DATE|TO_DATE|CEASE_DATE\nP|1|1|A|X|P|S||5000|OM|5|1/5/2024|1/5/2030|";
  const KFIN =
    "Prodcode|Agent|Fund|Acno|SchCode|SchDesc|InvName|TrType|Freq|STARTDATE|ENDDATE|PAIDINST|PENDINST|INSTALNO|AMOUNT|IHNO|REMARKS|RegDate|ECSNO\nX|ARN|F|123|S|Desc|A|SIP|M|01/01/2024|01/01/2030|2|34|36|5000|1|r|d|e";
  const FEED = "FOLIO_NO|PAN_NO|SCH_CODE|TXN_TYPE|TRXNNO|TRADDATE|AMOUNT|UNITS|NAV|STATUS\n1|X|S|SIP|99|01-11-2026|5000|10|20|ALLOTTED";

  it("recognises the CAMS and KFintech SIP-register columns, and not a transaction feed", () => {
    expect(looksLikeSipRegister(CAMS)).toBe(true);
    expect(looksLikeSipRegister(KFIN)).toBe(true);
    expect(looksLikeSipRegister(FEED)).toBe(false);
  });

  it("a register uploaded as the default 'daily transaction feed' is read as a register", () => {
    expect(reconcileSipKind("daily_transaction_feed", "whatever.zip", CAMS)?.kind).toBe("monthly_sip_book");
    expect(reconcileSipKind("monthly_aum_statement", "whatever.zip", KFIN)?.kind).toBe("monthly_sip_book");
  });

  it("never touches a register already read as one, a rejection report, or a master / holdings upload", () => {
    expect(reconcileSipKind("monthly_sip_book", "x.zip", CAMS)).toBeNull();
    expect(reconcileSipKind("sip_rejection_report", "x.zip", CAMS)).toBeNull();
    expect(reconcileSipKind("folio_master_dump", "x.zip", CAMS)).toBeNull();
    expect(reconcileSipKind("cas_holdings", "x.zip", CAMS)).toBeNull();
  });

  it("the file NAME only decides for the dialog's default pick", () => {
    expect(reconcileSipKind("daily_transaction_feed", "Systematic_Registration_Status.xls", FEED)?.kind).toBe("monthly_sip_book");
    expect(reconcileSipKind("monthly_aum_statement", "Systematic_Registration_Status.xls", FEED)).toBeNull();
    expect(reconcileSipKind("daily_transaction_feed", "WBR2.zip", FEED)).toBeNull();
  });
});

describe("the note about SIPs a closed client holds", () => {
  it("says nothing when there are none, and names the count when there are", () => {
    expect(hiddenSipsNote(0, 0)).toBeNull();
    expect(hiddenSipsNote(1, 1)).toMatch(/1 live SIP belongs to 1 client who is closed/);
    expect(hiddenSipsNote(12, 3)).toMatch(/12 live SIPs belong to 3 clients who are closed/);
  });
});
