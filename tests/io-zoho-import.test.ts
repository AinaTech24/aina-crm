import { describe, expect, it } from "vitest";
import { ioContactRow, isIndianState, mapIoContact, maskAccount, na } from "@/lib/imports/zoho/io/contacts";
import { claimStatusOf, insurerName, ioMeetingRow, ioUsers, mapIoAssignment, mapIoNote, mapIoPolicy, mapIoTask, policyTypeOf } from "@/lib/imports/zoho/io/modules";
import { ioUserEmail } from "@/lib/imports/zoho/io/users";

const NOW = new Date("2026-11-20T10:00:00+05:30");

describe("Investment Options — clients", () => {
  const base = {
    id: "6899105000003016256",
    Owner: { name: "Ashar", id: "6899105000000569001" },
    CFE: { name: "- Investment Options", id: "6899105000018663001" },
    Full_Name: "Ramesh Patel",
    Email: "ramesh@example.com",
    Mobile: "9876543210",
    Pan_Card_No: "ABCPP1234Q",
    Date_of_Birth: "1970-05-01",
    Family_Owner: { name: "Ramesh Patel", id: "6899105000003016256" },
    Mailing_Street: "Gujarat",
    Mailing_Street_2: "12, Shanti Nagar",
    Mailing_Street3: "Kalawad Road",
    Mailing_City: "RAJKOT",
    Mailing_Zip: "360005",
    Bank_Name: "KOTAK MAHINDRA BANK LIMITED",
    Account_Number: "9825486569",
    IFSC_Code: "kkbk0002789",
    Group_Code: "A0000200",
    Client_Code: "5011318320",
  };

  it("takes the RM from CFE, not the Contact Owner", () => {
    expect(mapIoContact(ioContactRow(base), NOW).ownerText).toBe("divya@investmentoptions.in");
    expect(mapIoContact(ioContactRow({ ...base, CFE: null }), NOW).ownerText).toBe("asharkeval@gmail.com");
  });

  it("reads the state out of Mailing Street and the lines from Street 2 / 3", () => {
    const m = mapIoContact(ioContactRow(base), NOW);
    expect(m.address).toEqual({ line1: "12, Shanti Nagar, Kalawad Road", city: "Rajkot", state: "Gujarat", pincode: "360005", country: "India" });
  });

  it("masks the account and keeps the bank in the CRM's own fields", () => {
    const m = mapIoContact(ioContactRow(base), NOW);
    expect(m.extra?.bankAccountNumberMasked).toBe("XXXX6569");
    expect(m.extra?.bankIfsc).toBe("KKBK0002789");
    expect(m.extra?.bankAccounts).toEqual([{ bankName: "KOTAK MAHINDRA BANK LIMITED", accountMasked: "XXXX6569", ifsc: "KKBK0002789" }]);
    expect(m.custom.cf_zoho_group_code).toBe("A0000200");
    expect(m.custom.cf_zoho_client_code).toBe("5011318320");
    expect(JSON.stringify(m)).not.toContain("9825486569");
  });

  it("treats NA as blank", () => {
    const m = mapIoContact(ioContactRow({ ...base, Pan_Card_No: "NA", Mobile: "NA", Email: "NA" }), NOW);
    expect(m.pan).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.email).toBeNull();
    expect(na("0")).toBe("");
  });

  it("makes a child a Minor held through the family head, with no nominee", () => {
    const m = mapIoContact(ioContactRow({ ...base, id: "2", Full_Name: "Manav Patel", Date_of_Birth: "2016-05-15" }), NOW);
    expect(m.isMinor).toBe(true);
    expect(m.investorCategory).toBe("minor");
    expect(m.guardianName).toBe("Ramesh Patel");
    expect(m.nominee).toBeNull();
  });

  it("makes a Corporate customer a company", () => {
    const m = mapIoContact(ioContactRow({ ...base, Customer_Type: "Corporate", Family_or_Individual: "Corporate" }), NOW);
    expect(m.investorCategory).toBe("company");
    expect(m.householdType).toBe("Company");
  });

  it("maps Zoho's gender, marital status and occupation onto the CRM's lists", () => {
    const m = mapIoContact(ioContactRow({ ...base, Gender: "Female", Maritial_Status: "Unmarried", Occupation: "Housewife" }), NOW);
    expect(m.gender).toBe("F");
    expect(m.extra?.maritalStatus).toBe("Single");
    expect(m.occupation).toBe("Homemaker");
  });

  it("knows a state when it sees one", () => {
    expect(isIndianState("GUJARAT")).toBe(true);
    expect(isIndianState("Kalawad Road")).toBe(false);
    expect(maskAccount("12")).toBe("");
  });
});

describe("Investment Options — users", () => {
  it("resolves a Zoho login to the CRM email, and a left login to its owner today", () => {
    expect(ioUserEmail({ id: "6899105000002742001", name: "- Investment Options" })).toBe("kirti@investmentoptions.in");
    expect(ioUserEmail({ id: "6899105000008919001" })).toBe("devendrasinh.jadeja@investmentoptions.in");
    expect(ioUserEmail({ id: "6899105000008923001" })).toBe("asharkeval@gmail.com");
    expect(ioUserEmail({ id: "6899105000003016145", name: "a client" })).toBe("");
  });

  it("rewrites only user lookups", () => {
    const r = ioUsers({ Owner: { id: "6899105000002266001", name: "Kakkad" }, Client_Name: { id: "6899105000003016145", name: "Harshad" } });
    expect(r.Owner).toEqual({ id: "6899105000002266001", name: "aryan@investmentoptions.in" });
    expect(r.Client_Name).toEqual({ id: "6899105000003016145", name: "Harshad" });
  });
});

describe("Investment Options — insurance", () => {
  it("types products by name", () => {
    expect(policyTypeOf("Motor Policy")).toBe("motor");
    expect(policyTypeOf("Global Personal Guard")).toBe("personal_accident");
    expect(policyTypeOf("My Healthcare Floater")).toBe("health");
    expect(policyTypeOf("Workmen Compensation")).toBe("workmen_comp");
    expect(policyTypeOf("Bharat Griha Raksha Polic")).toBe("home");
    expect(policyTypeOf("Bharat Sookshma Udyam Sur")).toBe("fire");
    expect(policyTypeOf("Critical Illness")).toBe("critical_illness");
    expect(policyTypeOf("Group Mediclaim")).toBe("group_health");
    expect(policyTypeOf("Marine Cargo")).toBe("marine");
    expect(policyTypeOf("Professional Indemnity")).toBe("general_other");
    expect(policyTypeOf("anything", "WC_Insurance")).toBe("workmen_comp");
    expect(insurerName("Bajaj")).toBe("Bajaj Allianz General Insurance");
    expect(insurerName("GoDigit")).toBe("Go Digit General Insurance");
  });

  it("works the start date out of the renewal date and says so", () => {
    const p = mapIoPolicy({
      id: "1", Name: "OG-26-1", Owner: { id: "6899105000000569001" }, Client_Name: { id: "9", name: "X" },
      Policy: "Motor Policy", Insurance_Company: "Bajaj", Total_Premium: 3500, FUP: "2027-03-14", Status: "Completed",
    });
    expect(p.startDate).toBe("2026-03-15");
    expect(p.renewalDate).toBe("2027-03-14");
    expect(p.startDerived).toBe(true);
    expect(p.remarks).toMatch(/renewal date/);
    expect(p.premium).toBe(3500);
  });

  it("flags Zoho's test rows", () => {
    expect(mapIoPolicy({ id: "2", Name: "Test", _module: "Health_Insurance" }).test).toBe(true);
  });
});

describe("Investment Options — claims, tasks, notes, meetings", () => {
  it("reads a claim's status", () => {
    expect(claimStatusOf({ Status: "Claim Settled", Settled_Amount: 300 })).toBe("settled_fully");
    expect(claimStatusOf({ Status: "Document Pending" })).toBe("add_info_awaited");
    expect(claimStatusOf({ Status: "Query" })).toBe("query");
    expect(claimStatusOf({ Status: "In Process" })).toBe("under_process");
    expect(claimStatusOf({ Status: null, Recent_Claim_Status: "intimated" })).toBe("claim_intimated");
  });

  it("maps a Zoho Task: assignee from the picklist, due date as the end", () => {
    const t = mapIoTask({ id: "5", Owner: { id: "6899105000000569001" }, Subject: "SIP REMINDER", Status: "Not Started", Priority: "High", Due_Date: "2027-01-05", Assigned_To: "Kinnari Sampat" });
    expect(t.assignee).toBe("kinnari@investmentoptions.in");
    expect(t.status).toBe("open");
    expect(t.priority).toBe("high");
    expect(t.end?.toISOString().slice(0, 10)).toBe("2027-01-05");
  });

  it("maps an IO Task: blank status with a closing date is finished", () => {
    const t = mapIoAssignment({ id: "6", Name: "Q-1", Owner: { id: "6899105000008925001" }, Assign_By: { id: "6899105000002266001" }, Task_Type: "Financial", Type: "Purchase", Closing_Date: "2026-10-02", Status: null });
    expect(t.status).toBe("completed");
    expect(t.assignee).toBe("kinnari@investmentoptions.in");
    expect(t.owner).toBe("aryan@investmentoptions.in");
    expect(t.department).toBe("operations");
    expect(t.title).toBe("Financial — Purchase");
  });

  it("reads a note's parent", () => {
    const n = mapIoNote({ id: "7", Owner: { id: "6899105000000569001" }, Note_Title: "Renewal", Note_Content: "Will renew", Parent_Id: { module: { api_name: "Contacts" }, id: "123" } });
    expect(n).toMatchObject({ parentModule: "Contacts", parentZohoId: "123", text: "Renewal — Will renew" });
  });

  it("turns a meeting into the export row the meeting import reads", () => {
    const row = ioMeetingRow({ id: "8", Owner: { id: "6899105000002266001" }, Event_Title: "Review", Who_Id: { id: "55", name: "C" }, Start_DateTime: "2026-11-11T10:00:00+05:30", Meeting_Status: "Due", Check_In_Status: "PLANNED", Meeting_Venue__s: "In-office" });
    expect(row).toMatchObject({ Host: "aryan@investmentoptions.in", "Contact Name.id": "55", "Meeting Status": "", "Checked In Status": "" });
  });
});
