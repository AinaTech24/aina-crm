import { describe, expect, it } from "vitest";
import { mapIoClaim, mapIoPolicy } from "@/lib/imports/zoho/io/modules";
import { mergeDetails, refillPolicy } from "@/lib/imports/zoho/io/run";
import {
  claimDetailLines,
  cleanClaimDetails,
  extraBlockFor,
  mergeClaimDetails,
  policyDetailLines,
} from "@/lib/insurance/extra-fields";

const holder = { id: "9001", name: "A Client" };

describe("Investment Options — insurance fields from Zoho (2026-11-24)", () => {
  it("reads each line module's own date fields", () => {
    const marine = mapIoPolicy({ id: "1", _module: "Marine_Insurance", Name: "MAR/1", Policy_Holder_Name: holder, Start_Date: "2026-07-28", Renewal_Due_Date: "2027-07-27", Transit_Type: "ROAD", Total_Insurance: 70000000 });
    expect(marine.startDate).toBe("2026-07-28");
    expect(marine.renewalDate).toBe("2027-07-27");
    expect(marine.sumAssured).toBe(70000000);
    expect(marine.details.transitMode).toBe("road");
    const cyber = mapIoPolicy({ id: "2", _module: "Cyber_Insurance", Name: "CY/1", Policy_Holder_Name: holder, Product: "Cyber Safe", Start_Date: "2026-01-04", Expiry_Renewal_Date: "2027-01-03", Policy_Type: "Renewal" });
    expect(cyber.policyType).toBe("general_other");
    expect(cyber.renewalDate).toBe("2027-01-03");
    expect(cyber.details.businessType).toBe("renewal");
  });

  it("a trip ends after its days, not a year", () => {
    const t = mapIoPolicy({ id: "3", _module: "Travel_Insurance", Name: "TR/1", Policy_Holder_Name: holder, Policy_Start_Date: "2026-12-01", Policy_Term_in_days: 14 });
    expect(t.renewalDate).toBe("2026-12-14");
    expect(t.details).toMatchObject({ tripDays: 14, tripStart: "2026-12-01", tripEnd: "2026-12-14" });
  });

  it("writes motor details under the form's keys, with the own-damage lines", () => {
    const m = mapIoPolicy({
      id: "4", Name: "MOT/1", Client_Name: holder, Policy: "Motor Policy", FUP: "2027-03-01",
      Chassis_Number: "CH1", Engine_Number: "EN1", Year_of_Manufacturer: 2021, IDV: 450000, Login_Date: "2026-03-02",
      Agency: "Harshad", Owner_Driver: 331, LL_to_Paid_Drive: 50, LPG_CNG_Kit: 60,
      Own_Damage: [
        { Description: "Basic OD Premium", Amount: 3041 },
        { Description: "No Claim Bonus", Percent: 20, Amount: 608 },
        { Description: "Total Own Damage Premium", Amount: 2632 },
      ],
    });
    expect(m.sumAssured).toBe(450000);
    expect(m.details).toMatchObject({
      chassisNo: "CH1", engineNo: "EN1", manufacturingYear: 2021, policyIssueDate: "2026-03-02", agencyName: "Harshad",
      paOwnerDriver: true, paOwnerDriverPremium: 331, llPaidDriverPremium: 50, cngKitPremium: 60, ncbPercent: 20, odPremium: 2632,
    });
    expect(m.details).not.toHaveProperty("chassisNumber");
    expect((m.details.premiumBreakdown as unknown[]).length).toBe(3);
  });

  it("brings every member subform in as insured persons", () => {
    const h = mapIoPolicy({
      id: "5", _module: "Health_Insurance", Name: "H/1", Policy_Holder_Name: holder, Product: "My Health Care", Family_Floater: "Yes",
      Member_Covered: [{ Name1: "Self Person", Relation: "Self", DOB: "1970-05-01", Premium: 6000 }, { Name1: "Spouse", Relation: "Spouse" }],
    });
    expect(h.details.familyFloater).toBe(true);
    expect(h.details.insuredMembers).toEqual([
      { name: "Self Person", relation: "Self", dob: "1970-05-01", premium: "6000" },
      { name: "Spouse", relation: "Spouse" },
    ]);
    expect(h.livesCovered).toBe(2);
    const pa = mapIoPolicy({
      id: "6", _module: "Personal_Accident_Policy", Name: "PA/1", Policy_Holder_Name: holder, Accidental_Death_Sum_Insured: 1500000,
      Members_Details: [{ Name1: "Kid", Relation: "Son", Premium: 500000 }],
      Optional_Cover_Details: [{ Cover_Type: "Fracture Cover", Sum_Insured: 50000 }],
    });
    expect(pa.details.adSumInsured).toBe(1500000);
    expect(pa.details.insuredMembers).toEqual([{ name: "Kid", relation: "Son", sumInsured: "500000" }]);
    expect(pa.details.coverList).toEqual([{ cover: "Fracture Cover", sumInsured: "50000" }]);
  });

  it("fire keeps its item-wise and add-on covers; WC its headcount", () => {
    const f = mapIoPolicy({
      id: "7", _module: "Fire_Insurance", Name: "F/1", Policy_Holder_Name: holder, Category: "CPP", Policy_Type: "Institution", Total_Sum_Insured_INR: 2450000,
      Item_Wise_Covers: [{ Item: "Stocks", Item_Description: "GARMENTS", Sum_Insured_INR: 2000000 }],
      Add_on_Cover_Details: [{ Addon_Cover_Description: "Earthquake", UIN: "X1", Sum_Insured_INR: 2450000 }],
    });
    expect(f.sumAssured).toBe(2450000);
    expect(f.details).toMatchObject({ fireCategory: "CPP", insuredAs: "institution" });
    expect(f.details.itemCovers).toEqual([{ item: "Stocks", description: "GARMENTS", sumInsured: "2000000" }]);
    expect(f.details.addOnCovers).toEqual([{ name: "Earthquake", uin: "X1", sumInsured: "2450000" }]);
    const wc = mapIoPolicy({ id: "8", _module: "WC_Insurance", Name: "W/1", Policy_Holder_Name: holder, Total_No_of_Members: 30, Medical_Expense: 50000, Start_Date: "2025-11-12" });
    expect(wc.livesCovered).toBe(30);
    expect(wc.details.medicalExpenseLimit).toBe(50000);
    expect(wc.startDate).toBe("2025-11-12");
  });

  it("a claim keeps its claim no., hospital, people and dates in details", () => {
    const c = mapIoClaim({
      id: "10", Name: "CL1", Policy_Holder_Name: holder, Claim_No: "SR1", Hospital_Name: "City Hospital", Discharge_date: "2026-07-20",
      ECS_Done_Date: "2026-10-12", Deduction: 2070, Submitted_Uploaded_By: "Rajeshwair", Intimation_By: "Direct",
    });
    expect(c.details).toMatchObject({
      claimNo: "SR1", hospitalName: "City Hospital", dischargeDate: "2026-07-20", paymentReceivedOn: "2026-10-12",
      deductionAmount: 2070, submittedBy: "Rajeshwari", intimatedBy: "Direct",
    });
  });
});

describe("refill of policies already imported", () => {
  it("moves the first import's keys to the form's and fills only blanks on an edited row", () => {
    const have = { chassisNumber: "OLD", agency: "Neha", idv: 1, familyFloater: "Yes", vehicleRegNo: "TYPED" };
    const out = mergeDetails(have, { chassisNo: "Z", vehicleRegNo: "ZOHO", makeModel: "Swift" }, false);
    expect(out).toEqual({ chassisNo: "OLD", agencyName: "Neha", familyFloater: true, vehicleRegNo: "TYPED", makeModel: "Swift" });
    expect(mergeDetails({ vehicleRegNo: "X" }, { vehicleRegNo: "ZOHO" }, true).vehicleRegNo).toBe("ZOHO");
  });

  it("dates a policy the first import left without one, and lapses it when its period is over", () => {
    const m = mapIoPolicy({ id: "11", _module: "Marine_Insurance", Name: "M/2", Policy_Holder_Name: holder, Start_Date: "2025-08-07", Renewal_Due_Date: "2026-08-06" });
    const r = refillPolicy({ details: { zohoId: "11" }, status: "active", start: null, due: null, sum: null, lives_covered: 1, untouched: true }, m, "2026-11-24");
    expect(r).toMatchObject({ start: "2025-08-07", due: "2026-08-06", status: "lapsed" });
    // An edited row keeps a date someone typed.
    const kept = refillPolicy({ details: {}, status: "active", start: "2025-08-01", due: "2026-12-01", sum: null, lives_covered: 1, untouched: false }, m, "2026-11-24");
    expect(kept?.start).toBeNull();
    expect(kept?.due).toBeNull();
    expect(kept?.status).toBeNull();
  });
});

describe("extra fields — forms and pages", () => {
  it("each line has its block; the page lists filled values with option labels", () => {
    expect(extraBlockFor("motor")?.fields.map((f) => f.key)).toContain("paOwnerDriverPremium");
    expect(extraBlockFor("health")).toBeNull();
    const lines = policyDetailLines("marine", { transitMode: "road", paymentMode: "Online", empty: "" });
    expect(lines).toEqual(expect.arrayContaining([{ label: "Mode of transit", value: "Road", type: "select" }, { label: "Payment mode", value: "Online", type: undefined }]));
  });

  it("a claim form save keeps the Zoho id and drops cleared fields", () => {
    expect(cleanClaimDetails({ claimNo: " ", deductionAmount: "300", junk: 1 })).toEqual({ claimNo: " ", deductionAmount: 300 });
    expect(mergeClaimDetails({ zohoId: "1", claimNo: "A", hospitalName: "H" }, { claimNo: "B", hospitalName: "" })).toEqual({ zohoId: "1", claimNo: "B" });
    expect(claimDetailLines({ hospitalName: "H", zohoId: "1" })).toEqual([{ label: "Hospital / garage", value: "H", type: undefined }]);
  });
});
