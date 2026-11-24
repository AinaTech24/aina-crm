import { describe, expect, it } from "vitest";
import { groupWmRows, mapWmPolicy, policyKey, wmPolicyType, wmStatus } from "@/lib/imports/zoho/io/wealthmaker";

describe("Investment Options — WealthMaker insurance export", () => {
  it("types WealthMaker's products (Star Package is a package, not Star Health)", () => {
    expect(wmPolicyType("Other", "Star Package Policy")).toBe("fire");
    expect(wmPolicyType("Other", "Global Personal Guard")).toBe("personal_accident");
    expect(wmPolicyType("Other", "Marine Cargo Policy")).toBe("marine");
    expect(wmPolicyType("Other", "Workmen Compensation Insurance")).toBe("workmen_comp");
    expect(wmPolicyType("Other", "Bharat Sookshma Udyam Suraksha")).toBe("fire");
    expect(wmPolicyType("Other", "Bharat Griha Raksha Policy")).toBe("home");
    expect(wmPolicyType("Other", "Group Mediclaim Insurance")).toBe("group_health");
    expect(wmPolicyType("Other", "Professional Indemnity Policy For Doctors And Medical Practitioners")).toBe("general_other");
    expect(wmPolicyType("Other", "Travel Prime Individual Gold")).toBe("travel");
    expect(wmPolicyType("Floater", "My Healthcare Floater")).toBe("health");
    expect(wmPolicyType("Individual", "Group Health Insurance")).toBe("group_health");
    expect(wmPolicyType("Motor", "Motor Policy")).toBe("motor");
  });

  it("a health policy is one policy with a row per member", () => {
    const rows = [
      { _sheet: "Floater", "Policy No": "12-8451-1 ", Insurer: "Bajaj", Product: "My Healthcare Floater", "Start Date": "2025-04-05", "Expiry Date": "2026-04-04", "Floater Sum": 500000, "Gross Premium": 35754, "Name of Policy Holder": "A B Shah", "Member Name": "A B Shah", "Agency Code": "H  " },
      { _sheet: "Floater", "Policy No": "12-8451-1", Insurer: "Bajaj", Product: "My Healthcare Floater", "Name of Policy Holder": "A B Shah", "Member Name": "C A Shah", "Member DOB": "1990-01-02" },
    ];
    const groups = groupWmRows(rows);
    expect(groups).toHaveLength(1);
    const p = mapWmPolicy(groups[0]);
    expect(p).toMatchObject({ policyType: "health", sumAssured: 500000, premium: 35754, insurer: "Bajaj Allianz General Insurance", livesCovered: 2, agencyEmail: "harshad@investmentoptions.in" });
    expect(p.details.insuredMembers).toEqual([{ name: "A B Shah" }, { name: "C A Shah", dob: "1990-01-02" }]);
    expect(p.details.familyFloater).toBe(true);
  });

  it("individual health sums its members; motor takes the IDV and vehicle", () => {
    const ind = mapWmPolicy([{ _sheet: "Individual", "Policy No": "X1", Insurer: "Star Health", Product: "My Healthcare Individual", "Gross Premium": 0, "Member Name": "P Q", Sum: 300000, Premium: 9027 }]);
    expect(ind).toMatchObject({ sumAssured: 300000, premium: 9027 });
    const m = mapWmPolicy([{ _sheet: "Motor", "Policy No": "OG-1", Insurer: "GoDigit", Product: "Motor Policy", Premium: 3521, Name: "R S", IDV: 28203, "Policy Type": "Package", "Policy Sub Type": "Two Wheeler", "Agency Code": "AM" }]);
    expect(m).toMatchObject({ policyType: "motor", sumAssured: 28203, premium: 3521, insurer: "Go Digit General Insurance", agencyEmail: "" });
    expect(m.details).toMatchObject({ coverType: "comprehensive", vehicleType: "Two Wheeler", agencyCode: "AM" });
  });

  it("an ended policy is renewed history when the next one follows, else lapsed", () => {
    const p = { policyType: "motor", startDate: "2023-04-01", expiryDate: "2024-03-31" };
    expect(wmStatus(p, [{ policyType: "motor", startDate: "2024-04-01", policyNumber: "N2" }], "2026-11-24")).toEqual({ status: "matured", renewedBy: "N2" });
    expect(wmStatus(p, [{ policyType: "health", startDate: "2024-04-01", policyNumber: "H2" }], "2026-11-24")).toEqual({ status: "lapsed" });
    expect(wmStatus({ ...p, expiryDate: "2026-11-10" }, [], "2026-11-24")).toEqual({ status: "active" });
  });

  it("compares policy numbers without case or spaces", () => {
    expect(policyKey(" og-22 2204 ")).toBe("OG-222204");
  });
});
