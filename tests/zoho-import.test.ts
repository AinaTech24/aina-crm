import { describe, expect, it } from "vitest";
import { idDamagedByExcel, istInstant, isoDate, mobile, yesNo, zohoId } from "@/lib/imports/zoho/values";
import { BASE_LEAD_SOURCES, BASE_SALUTATIONS, PICKLISTS, leadSourceOption, leadSourceOptions, mapZohoContact, picklistOption, picklistOptions, reviewFrequencyFromZoho, riskFromZoho } from "@/lib/imports/zoho/contacts";
import { mapZohoMeeting, meetingModeFromZoho, meetingTypeFromZoho } from "@/lib/imports/zoho/meetings";
import { planFamilies } from "@/lib/imports/zoho/family-groups";
import { buildClientMatcher } from "@/lib/imports/zoho/client-match";
import { mapPurchaseRow, mapSipRow, planBusiness } from "@/lib/imports/zoho/business";
import { buildSchemeIndex, matchScheme, schemeBase, statedVariant } from "@/lib/imports/zoho/scheme-match";

const NOW = new Date("2026-11-14T10:00:00+05:30");

describe("Zoho cell readers", () => {
  it("reads Zoho ids with or without the zcrm_ prefix", () => {
    expect(zohoId("zcrm_5725767000000412001")).toBe("5725767000000412001");
    expect(zohoId(" 5725767000000412001 ")).toBe("5725767000000412001");
    expect(zohoId("")).toBe("");
  });

  it("spots ids Excel turned into 5.7E+18", () => {
    expect(idDamagedByExcel(5.725767000000412e18)).toBe(true);
    expect(idDamagedByExcel("5.72577E+18")).toBe(true);
    expect(idDamagedByExcel("zcrm_5725767000000412001")).toBe(false);
  });

  it("reads dates day-first, ISO, month names and Excel serials", () => {
    expect(isoDate("15/03/1985")).toBe("1985-03-15");
    expect(isoDate("1985-03-15")).toBe("1985-03-15");
    expect(isoDate("15-Mar-1985")).toBe("1985-03-15");
    expect(isoDate("Mar 15, 1985")).toBe("1985-03-15");
    expect(isoDate(31121)).toBe("1985-03-15");
    expect(isoDate("31/02/2020")).toBeNull();
    expect(isoDate("")).toBeNull();
  });

  it("reads a meeting time as Indian time, whatever zone the server runs in", () => {
    expect(istInstant("2026-03-15 10:30:00")?.toISOString()).toBe("2026-03-15T05:00:00.000Z");
    expect(istInstant("15/03/2026 04:30 PM")?.toISOString()).toBe("2026-03-15T11:00:00.000Z");
    expect(istInstant("Mar 15, 2026 12:15 AM")?.toISOString()).toBe("2026-03-14T18:45:00.000Z");
    // Excel serial 46096.4375 = 2026-03-15 10:30
    expect(istInstant(46096.4375)?.toISOString()).toBe("2026-03-15T05:00:00.000Z");
  });

  it("normalises Indian mobiles and yes/no", () => {
    expect(mobile("+91 98765 43210")).toBe("9876543210");
    expect(mobile(919876543210)).toBe("9876543210");
    expect(mobile("09876543210")).toBe("9876543210");
    expect(yesNo("Yes")).toBe(true);
    expect(yesNo("no")).toBe(false);
    expect(yesNo("")).toBeNull();
    expect(yesNo("maybe")).toBeNull();
  });
});

describe("Zoho Contacts → client", () => {
  const base = {
    "Record Id": "zcrm_1001",
    "Contact Owner": "Nikhil Vasudev Thakkar",
    "Contact Name": "Ramesh  Patel",
    Salutation: "Mr.",
    Email: "Ramesh.Patel@Example.com",
    Mobile: "+91-98250 12345",
    "Date of Birth": "12/07/1975",
    "Pan Card No": "abcpp1234k",
    "Mailing Street": "12 Shanti Nagar",
    "Mailing City": "",
    "Other City": "Ahmedabad",
    "Mailing State": "Gujarat",
    "Mailing Zip": 380015,
    "Adhaar Card": "1234 5678 9012",
    "Date of Onboarding": "01-04-2019",
    "Family Owner.id": "zcrm_1001",
    "Family Owner": "Ramesh Patel",
    PMS: "No",
    SIP: "Yes",
    "Health Insurance": "Yes",
    "Super Top Up": "Yes",
    "Vehicle Insurance": "Yes",
    "Risk Profile": "Moderate",
    "Client Category": "A",
    "Review Type": "Half Yearly",
    "Family or Individual": "Family",
    "Nominee Details": "Sunita Patel",
    "Nominee Relation": "Spouse",
    "Lead Source": "Referral",
    "Total Current Value": "5000000",
    "CAN/IIN No": "CAN123, IIN456",
  };

  it("maps the client master and keeps the Zoho id", () => {
    const m = mapZohoContact(base, NOW);
    expect(m.zohoId).toBe("1001");
    expect(m.name).toBe("Ramesh Patel");
    expect(m.gender).toBe("M");
    expect(m.email).toBe("ramesh.patel@example.com");
    expect(m.phone).toBe("9825012345");
    expect(m.pan).toBe("ABCPP1234K");
    expect(m.dob).toBe("1975-07-12");
    expect(m.aadhaarLast4).toBe("9012");
    expect(m.address).toEqual({ line1: "12 Shanti Nagar", city: "Ahmedabad", state: "Gujarat", pincode: "380015", country: "India" });
    expect(m.onboardedAt?.toISOString()).toBe("2019-03-31T18:30:00.000Z");
    expect(m.custom.cf_zoho_record_id).toBe("1001");
    expect(m.custom.cf_zoho_lead_source).toBe("Referral");
    expect(m.uccCodes).toEqual(["CAN123", "IIN456"]);
    expect(m.familyOwnerZohoId).toBe("1001");
  });

  it("turns Yes product columns into Cross-sell held with us, and keeps each as a checkbox", () => {
    const m = mapZohoContact(base, NOW);
    expect(m.crossSell).toEqual({ mutual_funds: "held_with_us", health_insurance: "held_with_us", general_insurance: "held_with_us" });
    expect(m.custom.cf_zoho_sip).toBe(true);
    expect(m.custom.cf_zoho_super_top_up).toBe(true);
    expect(m.custom.cf_zoho_pms).toBeUndefined();
  });

  it("maps the judgement columns or keeps them as text", () => {
    const m = mapZohoContact(base, NOW);
    expect(m.riskProfile).toBe("moderate");
    expect(m.clientCategory).toBe("A");
    expect(m.reviewFrequency).toBe("half_yearly");
    expect(m.householdType).toBe("Family");
    const odd = mapZohoContact({ ...base, "Risk Profile": "Moderately Aggressive", "Client Category": "Platinum", "Review Type": "As needed" }, NOW);
    expect(odd.riskProfile).toBeNull();
    expect(odd.custom.cf_zoho_risk_profile).toBe("Moderately Aggressive");
    expect(odd.custom.cf_zoho_client_category).toBe("Platinum");
    expect(odd.custom.cf_zoho_review_type).toBe("As needed");
  });

  it("never imports Zoho's money figures", () => {
    const m = mapZohoContact(base, NOW) as any;
    expect(JSON.stringify(m)).not.toContain("5000000");
  });

  it("makes a client under 18 with a guardian a Minor, without a nominee", () => {
    const m = mapZohoContact({ ...base, "Date of Birth": "01/01/2015", "Guardian Name": "Ramesh Patel" }, NOW);
    expect(m.isMinor).toBe(true);
    expect(m.investorCategory).toBe("minor");
    expect(m.guardianName).toBe("Ramesh Patel");
    expect(m.nominee).toBeNull();
  });

  it("an adult with a Guardian Name stays an individual and keeps the text", () => {
    const m = mapZohoContact({ ...base, "Guardian Name": "Someone" }, NOW);
    expect(m.isMinor).toBe(false);
    expect(m.custom.cf_zoho_guardian_name).toBe("Someone");
    expect(m.nominee?.name).toBe("Sunita Patel");
  });

  it("drops an invalid PAN or email with a note instead of storing it", () => {
    const m = mapZohoContact({ ...base, "Pan Card No": "NA", Email: "not an email" }, NOW);
    expect(m.pan).toBeNull();
    expect(m.email).toBeNull();
    expect(m.warnings.length).toBe(2);
  });

  it("reads risk and review wording", () => {
    expect(riskFromZoho("Very Aggressive")).toBe("very_aggressive");
    expect(riskFromZoho("high")).toBe("aggressive");
    expect(riskFromZoho("Balanced")).toBe("moderate");
    expect(reviewFrequencyFromZoho("Yearly")).toBe("annual");
    expect(reviewFrequencyFromZoho("Quarterly")).toBe("quarterly");
  });
});

describe("Lead Source picklist", () => {
  it("matches the CRM list ignoring case, spacing and known aliases", () => {
    expect(leadSourceOption("seminar", BASE_LEAD_SOURCES)).toBe("Seminar");
    expect(leadSourceOption("WALK IN", BASE_LEAD_SOURCES)).toBe("Walk-in");
    expect(leadSourceOption("Referral", BASE_LEAD_SOURCES)).toBe("Client Referral");
    expect(leadSourceOption("Existing Client", BASE_LEAD_SOURCES)).toBe("Client Referral");
    expect(leadSourceOption("Trade Show", BASE_LEAD_SOURCES)).toBe("Trade Show");
  });

  it("builds the list: existing, then the CRM sources, then new values from the file — no near-duplicates", () => {
    const opts = leadSourceOptions(["Partner"], ["seminar", "Trade Show", "trade  show", "referral"]);
    expect(opts.slice(0, 2)).toEqual(["Partner", "Client Referral"]);
    expect(opts).toContain("Trade Show");
    expect(opts.filter((o) => o.toLowerCase().includes("trade"))).toHaveLength(1);
    expect(opts).not.toContain("seminar");
    expect(opts).not.toContain("referral");
  });

  it("Salutation is a picklist too: Mr / mrs. / DR read as the list entries", () => {
    const sal = PICKLISTS[1];
    expect(picklistOption("Mr", BASE_SALUTATIONS, sal.aliases)).toBe("Mr.");
    expect(picklistOption("mrs.", BASE_SALUTATIONS, sal.aliases)).toBe("Mrs.");
    expect(picklistOption("DR", BASE_SALUTATIONS, sal.aliases)).toBe("Dr.");
    expect(picklistOption("Doctor", BASE_SALUTATIONS, sal.aliases)).toBe("Dr.");
    expect(picklistOptions([], BASE_SALUTATIONS, ["Mr", "Prof."], sal.aliases)).toEqual([...BASE_SALUTATIONS, "Prof."]);
  });

  it("the mapper keeps the Zoho text for the run to place on the list", () => {
    expect(mapZohoContact({ "Record Id": "1", "Contact Name": "A B", Salutation: "Mr" }).custom.cf_zoho_salutation).toBe("Mr");
    expect(mapZohoContact({ "Record Id": "1", "Contact Name": "A B", Salutation: "Mr" }).gender).toBe("M");
    expect(mapZohoContact({ "Record Id": "1", "Contact Name": "A B", "Lead Source": "Seminar" }).custom.cf_zoho_lead_source).toBe("Seminar");
  });
});

describe("Zoho Meetings → review meeting", () => {
  const base = {
    "Record Id": "zcrm_9001",
    Host: "Nikhil Vasudev Thakkar",
    Title: "Annual portfolio review",
    "Contact Name.id": "zcrm_1001",
    "Contact Name": "Ramesh Patel",
    From: "2026-03-15 10:30:00",
    To: "2026-03-15 11:15:00",
    "Meeting Type": "Portfolio Review",
    "Meeting Status": "",
    "Meeting Venue": "Client Residence",
    Location: "Ahmedabad",
    Description: "Discussed rebalancing",
    "All day": "false",
  };

  it("maps a past contact meeting and closes it as completed", () => {
    const m = mapZohoMeeting(base, NOW);
    expect(m.skip).toBeNull();
    expect(m.contactZohoId).toBe("1001");
    expect(m.start?.toISOString()).toBe("2026-03-15T05:00:00.000Z");
    expect(m.durationMinutes).toBe(45);
    expect(m.meetingType).toBe("portfolio_review");
    expect(m.meetingMode).toBe("client_place");
    expect(m.status).toBe("completed");
    expect(m.closedAsPast).toBe(true);
    expect(m.discussionPoints).toBe("Discussed rebalancing");
  });

  it("keeps a future meeting scheduled and honours Zoho's own status", () => {
    expect(mapZohoMeeting({ ...base, From: "2026-12-01 10:00", To: "2026-12-01 10:30" }, NOW).status).toBe("scheduled");
    expect(mapZohoMeeting({ ...base, "Meeting Status": "Cancelled" }, NOW).status).toBe("cancelled");
    const done = mapZohoMeeting({ ...base, "Meeting Status": "Completed" }, NOW);
    expect(done.status).toBe("completed");
    expect(done.closedAsPast).toBe(false);
  });

  it("skips a lead's meeting (no contact)", () => {
    const m = mapZohoMeeting({ ...base, "Contact Name.id": "", "Contact Name": "", "Related To": "Some Lead" }, NOW);
    expect(m.skip).toBe("Linked to a lead or deal, not a contact");
  });

  it("puts an all-day meeting at 10:00 IST for an hour", () => {
    const m = mapZohoMeeting({ ...base, From: "2026-03-15", To: "2026-03-15", "All day": "true" }, NOW);
    expect(m.start?.toISOString()).toBe("2026-03-15T04:30:00.000Z");
    expect(m.durationMinutes).toBe(60);
  });

  it("reads type and mode wording", () => {
    expect(meetingTypeFromZoho("Goal Planning")).toBe("goal_review");
    expect(meetingTypeFromZoho("Follow up call")).toBe("follow_up_call");
    expect(meetingTypeFromZoho("Insurance renewal chat")).toBe("other");
    expect(meetingModeFromZoho("Zoom", "")).toBe("online");
    expect(meetingModeFromZoho("Our Office", "")).toBe("office");
    expect(meetingModeFromZoho("", "Phone")).toBe("phone");
  });
});

describe("Zoho family sheet → households", () => {
  const row = (id: string, name: string, owner = "", ownerName = "") => ({ "Record Id": `zcrm_${id}`, "Contact Name": name, "Family Owner.id": owner ? `zcrm_${owner}` : "", "Family Owner": ownerName });

  it("groups members under their Family Owner and skips a family of one", () => {
    const p = planFamilies([
      row("1", "Ramesh", "1", "Ramesh"),
      row("2", "Sunita", "1", "Ramesh"),
      row("3", "Aarav", "1", "Ramesh"),
      row("4", "Alone", "4", "Alone"),
      row("5", "Nobody"),
    ]);
    expect(p.groups).toEqual([{ headZohoId: "1", headName: "Ramesh", memberZohoIds: ["2", "3"], nestedHeads: 0 }]);
    expect(p.aloneSkipped).toBe(1);
    expect(p.noFamily).toBe(1);
  });

  it("a head listed under another family joins that family with their members", () => {
    const p = planFamilies([
      row("1", "Grandfather", "1"),
      row("2", "Son", "1"),
      row("3", "Grandson", "2"),
      row("4", "Son's wife", "2"),
    ]);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].headZohoId).toBe("1");
    expect(p.groups[0].memberZohoIds.sort()).toEqual(["2", "3", "4"]);
    expect(p.groups[0].nestedHeads).toBe(1);
  });

  it("a loop stops where it closes; a missing head is reported", () => {
    const p = planFamilies([row("1", "A", "2"), row("2", "B", "1"), row("3", "C", "9", "Not Here")]);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].memberZohoIds).toHaveLength(1);
    expect(p.headMissing).toEqual([{ headZohoId: "9", headName: "Not Here", rows: 1 }]);
  });
});

describe("We Care meetings: Existing / New and the client matcher", () => {
  it("Existing → Review / Portfolio review, New → New / New client kickoff", () => {
    const base = { "Record Id": "zcrm_1", Host: "X", "Contact Name.id": "zcrm_2", "Contact Name": "A", From: "23-05-2023 15:00", To: "23-05-2023 15:30", "Meeting Venue": "Client location" };
    const ex = mapZohoMeeting({ ...base, "Meeting Type": "Existing" }, NOW);
    expect([ex.category, ex.meetingType, ex.meetingMode, ex.start?.toISOString()]).toEqual(["review", "portfolio_review", "client_place", "2023-05-23T09:30:00.000Z"]);
    const nw = mapZohoMeeting({ ...base, "Meeting Type": "New", "Meeting Venue": "In-office" }, NOW);
    expect([nw.category, nw.meetingType, nw.meetingMode]).toEqual(["new", "new_client_kickoff", "office"]);
    expect(mapZohoMeeting({ ...base, "Meeting Type": "", Title: "Goal planning" }, NOW).category).toBe("review");
  });

  it("matches by Zoho id, else by a name only one client and one contact have", () => {
    const c = (id: string, name: string, zoho: string | null = null) => ({ id, name, family_id: null, rm_id: null, zoho_id: zoho });
    const m = buildClientMatcher(
      [c("a", "Ramesh Patel", "100"), c("b", "Sunita  Patel"), c("c", "Rahul Patel"), c("d", "rahul patel"), c("e", "Kiran Shah"), c("f", "Old Name", "999")],
      new Map([["100", "Whatever"], ["200", "SUNITA PATEL"], ["300", "Rahul Patel"], ["400", "Kiran Shah"], ["401", "Kiran Shah"], ["500", "Old Name"], ["600", "Nobody"]])
    );
    expect(m.resolve("100")?.id).toBe("a");
    expect(m.resolve("200")?.id).toBe("b");
    expect(m.resolve("300")).toBeUndefined();
    expect(m.why("300")).toBe("several clients in the CRM have this name");
    expect(m.resolve("400")).toBeUndefined();
    expect(m.why("400")).toBe("several Zoho contacts in the file have this name");
    expect(m.resolve("500")).toBeUndefined();
    expect(m.why("500")).toBe("the client with this name has a different Zoho Record ID");
    expect(m.resolve("600")).toBeUndefined();
    expect(m.why("600")).toBe("no client with this name in the CRM");
    expect([m.matchedById(), m.matchedByName()]).toEqual([1, 1]);
    expect(m.stamps()).toEqual([{ id: "b", zoho: "200" }]);
  });
});

describe("Zoho MF Transactions → Business Entries", () => {
  const parent = (mft: string, extra: Record<string, unknown> = {}) => ({
    "Record Id": `zcrm_${mft}`, "MF Transaction Name": mft, "MF Transaction Owner": "Tushar Shah", "Client Name.id": "zcrm_c1", "Client Name": "Ramesh Patel",
    Date: 45796, "Transact Through": "MFU", "Transaction Type": "Online", Remarks: "", ...extra,
  });
  const pr = (mft: string, extra: Record<string, unknown>) => ({ "Parent ID.id": `zcrm_${mft}`, "Parent ID": mft, Scheme: "DSP Large Cap Fund", Type: "Equity", ...extra });
  const sip = (mft: string, extra: Record<string, unknown>) => ({ "Parent ID": mft, "Scheme Name": "Parag Parikh Flexi Cap Fund", ...extra });

  it("maps Zoho's own kinds to a counted type and keeps their label", () => {
    expect(mapPurchaseRow(pr("M1", { "Purchase/Redemption": "Red. Done by Client", "Redemption Amount": 5000 })).line).toMatchObject({ txnType: "redemption", typeLabel: "Red. Done by Client", amount: 5000 });
    expect(mapPurchaseRow(pr("M1", { "Purchase/Redemption": "Transfer Out from Our Code", "Redemption Amount": 7000 })).line).toMatchObject({ txnType: "redemption", typeLabel: "Transfer Out from Our Code" });
    expect(mapPurchaseRow(pr("M1", { "Purchase/Redemption": "Broker Code Change in Our Code", "Purchase Amount": 9000 })).line).toMatchObject({ txnType: "lumpsum", typeLabel: "Broker Code Change in Our Code" });
    expect(mapPurchaseRow(pr("M1", { "Purchase/Redemption": "Switch In Our Code", "Purchase Amount": 9000 })).line).toMatchObject({ txnType: "switch", typeLabel: "Switch In Our Code" });
    expect(mapPurchaseRow(pr("M1", { "Purchase/Redemption": "Purchase", "Purchase Amount": 1000, Type: "Liquid" })).line).toMatchObject({ txnType: "lumpsum", assetClass: "liquid" });
    expect(mapPurchaseRow(pr("M1", { "Purchase/Redemption": "SIF", "Purchase Amount": 1e6 })).product).toBe("sif");
  });

  it("STP and switch go from the source scheme into the To Scheme", () => {
    const stp = mapPurchaseRow(pr("M1", { "Purchase/Redemption": "Purchase", "Purchase Amount": 100000, "STP/SWP Amount": 5000, Options: "Normal STP - Weekly", Type: "Liquid to Equity", Scheme: "DSP Liquid", "To Scheme": "DSP Large Cap Fund" })).line;
    expect(stp).toMatchObject({ txnType: "stp", amount: 5000, schemeName: "DSP Large Cap Fund", fromSchemeName: "DSP Liquid", assetClass: "equity", fromAssetClass: "liquid", frequency: "weekly" });
  });

  it("a rejected line is kept but never counts", () => {
    const l = mapPurchaseRow(pr("M1", { "Purchase/Redemption": "Purchase", "Purchase Amount": 2000, Status: "Rejected" })).line;
    expect(l).toMatchObject({ txnType: "other", typeLabel: "Purchase (rejected)", rtaNotApplicable: "Rejected in Zoho" });
  });

  it("SIP rows: SIP, Daily SIP, SIP Stop, Auto Stop and Pause", () => {
    expect(mapSipRow(sip("M2", { Type: "SIP", "SIP Amount": 2500, "Auto Debit Date": 10, "Auto Start Date": 45848 }))).toMatchObject({ txnType: "sip", amount: 2500, sipDate: "10", frequency: "monthly" });
    expect(mapSipRow(sip("M2", { Type: "SIP", "SIP Amount": 2500, "Auto Debit Date": 30 })).sipDate).toBeNull();
    expect(mapSipRow(sip("M2", { Type: "Daily SIP", "SIP Amount": 100 }))).toMatchObject({ txnType: "sip", typeLabel: "Daily SIP" });
    expect(mapSipRow(sip("M2", { Type: "SIP Stop", "SIP Stop/Pause Amount": 3000 }))).toMatchObject({ txnType: "sip_stop", amount: 3000 });
    expect(mapSipRow(sip("M2", { Type: "SIP Auto Stop", "SIP Stop/Pause Amount": 1000 }))).toMatchObject({ txnType: "sip_stop", typeLabel: "SIP Auto Stop" });
    const pause = mapSipRow(sip("M2", { Type: "SIP Pause", "SIP Stop/Pause Amount": 4000, "SIP Pause (Months)": 3 }));
    expect(pause).toMatchObject({ txnType: "other", typeLabel: "SIP Pause", amount: 4000 });
    expect(pause.notes).toContain("Paused 3 months");
  });

  it("builds one entry per MFT and product, from both subforms", () => {
    const p = planBusiness(
      [parent("MFT1"), parent("MFT2", { Date: "" }), parent("MFT3"), parent("MFT4", { "PMS Amount": 5000000, "PMS Scheme": "ICICI PMS" })],
      [sip("MFT1", { Type: "SIP", "SIP Amount": 2500 })],
      [pr("MFT1", { "Purchase/Redemption": "Purchase", "Purchase Amount": 10000 }), pr("MFT1", { "Purchase/Redemption": "SIF", "Purchase Amount": 1e6 }), pr("MFT2", { "Purchase/Redemption": "Purchase", "Purchase Amount": 1 })]
    );
    expect(p.entries.map((e) => `${e.mft}:${e.product}:${e.lines.length}`).sort()).toEqual(["MFT1:mutual_fund:2", "MFT1:sif:1", "MFT4:pms:1"]);
    expect(p.skipped).toEqual(expect.arrayContaining([{ mft: "MFT2", reason: "No date on the Zoho record" }, { mft: "MFT3", reason: "No scheme lines on the Zoho record" }]));
    expect(p.entries[0].notes.startsWith("Zoho MFT1")).toBe(true);
    expect(p.entries[0].businessDate).toBe("2025-05-19");
  });
});

describe("Zoho scheme names → Scheme Master", () => {
  const ms = (code: string, name: string, plan: string | null = null, option: string | null = null, closed = false) => ({ scheme_code: code, scheme_name: name, amc_code: name.split(" ")[0], category: "Equity Scheme - Flexi Cap Fund", plan, option, is_closed: closed });
  const master = [
    ms("1", "WhiteOak Capital Flexi Cap Fund - Direct Plan - Growth Option", "direct", "growth"),
    ms("2", "WhiteOak Capital Flexi Cap Fund - Regular Plan - Growth Option", "regular", "growth"),
    ms("3", "WhiteOak Capital Flexi Cap Fund - Regular Plan - IDCW Option", "regular", "idcw_payout"),
    ms("4", "Aditya Birla Sun Life Frontline Equity Fund - Regular Plan - Growth"),
    ms("5", "Aditya Birla Sun Life Frontline Equity Fund - Direct Plan - Growth"),
    ms("6", "HDFC Mid Cap Fund - Regular Plan - Growth Option"),
    ms("7", "Kotak Banking and Financial Services Fund - Regular Plan - Growth"),
    ms("8", "Parag Parikh Flexi Cap Fund - Regular Plan - Growth", null, null, true),
    ms("9", "Parag Parikh Flexi Cap Fund - Regular Plan - Growth"),
  ];
  const idx = buildSchemeIndex(master);

  it("a name without plan or option maps to Regular · Growth", () => {
    expect(matchScheme("WhiteOak Capital Flexi Cap Fund", idx)).toMatchObject({ confidence: "exact", scheme: { scheme_code: "2" } });
  });
  it("a name that states Direct or IDCW keeps it", () => {
    expect(matchScheme("WHITEOAK CAPITAL FLEXI CAP FUND DIRECT PLAN GROWTH", idx).scheme?.scheme_code).toBe("1");
    expect(matchScheme("WhiteOak Capital Flexi Cap Fund - IDCW", idx).scheme?.scheme_code).toBe("3");
  });
  it("short forms, '&' and spacing read the same; an open scheme beats a closed one", () => {
    expect(matchScheme("ABSL Frontline Equity Fund", idx).scheme?.scheme_code).toBe("4");
    expect(matchScheme("Kotak Banking & Financial Services Fund", idx).scheme?.scheme_code).toBe("7");
    expect(matchScheme("Parag Parikh Flexi Cap Fund", idx).scheme?.scheme_code).toBe("9");
  });
  it("a renamed fund is only a suggestion; another house's fund is never matched", () => {
    expect(matchScheme("HDFC Mid-Cap Opportunities Fund", idx)).toMatchObject({ confidence: "close", scheme: { scheme_code: "6" } });
    expect(matchScheme("Axis Mid Cap Fund", idx).confidence).toBe("none");
  });
  it("reads plan and option from free text", () => {
    expect(statedVariant("NIPPON INDIA SMALL CAP FUND - GROWTH PLAN - GROWTH OPTION")).toEqual({ plan: null, option: "growth" });
    expect(schemeBase("ICICI Pru Bluechip Fund - Regular Plan - Growth")).toBe("icici prudential bluechip");
  });
});

describe("scheme matcher — renames and guards (real AMFI shapes)", () => {
  const ms = (code: string, name: string, amc: string) => ({ scheme_code: code, scheme_name: name, amc_code: amc, category: null, plan: /direct/i.test(name) ? "direct" : "regular", option: null });
  const idx = buildSchemeIndex([
    ms("1", "ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Regular Plan - Growth", "ICICI Prudential Mutual Fund"),
    ms("2", "ICICI Prudential Value Fund (erstwhile Value Discovery Fund) - Regular Plan - Growth", "ICICI Prudential Mutual Fund"),
    ms("3", "Kotak Ultra Short to Short Term Fund - Regular Plan - Growth", "Kotak Mahindra Mutual Fund"),
    ms("4", "WhiteOak Capital Ultra Short Term Fund - Regular Plan - Growth Option", "WhiteOak Capital Mutual Fund"),
    ms("5", "ICICI Prudential Equity Savings Fund - Regular Plan - Cumulative", "ICICI Prudential Mutual Fund"),
    ms("6", "Aditya Birla Sun Life Manufacturing Equity Fund - Regular Plan - GROWTH", "Aditya Birla Sun Life Mutual Fund"),
    ms("7", "HDFC Retirement Fund - Hybrid-Equity Plan - Regular Plan - Growth Option", "HDFC Mutual Fund"),
  ]);
  it("a bracketed note is not part of the name; a former name finds the fund", () => {
    expect(matchScheme("ICICI Prudential Value Fund- Regular Plan - Growth", idx)).toMatchObject({ confidence: "exact", scheme: { scheme_code: "2" } });
    expect(matchScheme("ICICI Prudential Bluechip Fund", idx)).toMatchObject({ confidence: "exact", scheme: { scheme_code: "1" } });
  });
  it("SEBI's category renames are suggestions with their reason", () => {
    expect(matchScheme("Kotak Low Duration Fund- Regular Plan-Growth Option", idx)).toMatchObject({ confidence: "close", scheme: { scheme_code: "3" }, why: expect.stringContaining("Low Duration") });
    expect(matchScheme("WhiteOak Capital Ultra Short Duration Fund", idx)).toMatchObject({ confidence: "close", scheme: { scheme_code: "4" } });
  });
  it("never suggests a fund that adds a type word, or swaps a word", () => {
    expect(matchScheme("ICICI Prudential Savings Fund", idx).confidence).toBe("none");
    expect(matchScheme("Aditya Birla Sun Life Frontline Equity Fund", idx).confidence).toBe("none");
    expect(matchScheme("HDFC Hybrid Equity Fund", idx).confidence).toBe("none");
  });
  it("dropping words is a rename it may suggest; ICICI's 'Cumulative' is growth", () => {
    expect(matchScheme("HDFC Retirement Savings Fund - Hybrid-Equity Plan", idx)).toMatchObject({ confidence: "close", scheme: { scheme_code: "7" } });
    expect(matchScheme("ICICI Prudential Equity Savings Fund", idx)).toMatchObject({ confidence: "exact", scheme: { scheme_code: "5" } });
  });
});
