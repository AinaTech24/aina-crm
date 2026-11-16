import { describe, expect, it } from "vitest";
import { idDamagedByExcel, istInstant, isoDate, mobile, yesNo, zohoId } from "@/lib/imports/zoho/values";
import { BASE_LEAD_SOURCES, BASE_SALUTATIONS, PICKLISTS, leadSourceOption, leadSourceOptions, mapZohoContact, picklistOption, picklistOptions, reviewFrequencyFromZoho, riskFromZoho } from "@/lib/imports/zoho/contacts";
import { mapZohoMeeting, meetingModeFromZoho, meetingTypeFromZoho } from "@/lib/imports/zoho/meetings";

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
