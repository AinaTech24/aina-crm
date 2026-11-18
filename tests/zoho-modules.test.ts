import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_BANDS, brokerageByMonth, categoryFromScore, leadSource, mapCall, mapLead, mapRiskProfile, mapSipTracking, mapTask } from "@/lib/imports/zoho/modules";

describe("Zoho modules — API records → CRM", () => {
  it("maps a lead's status, source, pipeline and conversion", () => {
    const l = mapLead({
      id: "2820986000000001", Full_Name: "Asha Patel", Owner: { id: "1", name: "Tushar Shah" }, Mobile: "+919800000000",
      Lead_Status: "KYC Done", Lead_Source: "Client Referrals", Expected_Business: "Mutual Fund", Date: "2026-01-05T10:00:00+05:30",
      Referal_Client_Name: { id: "77", name: "Ravi Patel" },
    });
    expect([l.stage, l.source, l.pipeline, l.interest, l.referrerZohoId]).toEqual(["kyc_validated", "referral", "mf", ["sip"], "77"]);
    expect(l.notes).toContain("Zoho status: KYC Done");
    const ins = mapLead({ id: "2", Last_Name: "Mehta", Lead_Status: "Quote Share to Client", Expected_Business: "Health Insurance" });
    expect([ins.stage, ins.pipeline, ins.interest]).toEqual(["proposal_shared", "insurance", ["insurance"]]);
    const conv = mapLead({ id: "3", Full_Name: "X Y", Lead_Status: "Won Lead", Converted__s: true, Converted_Contact: { id: "99", name: "X Y" } });
    expect([conv.stage, conv.convertedZohoId]).toEqual(["converted", "99"]);
    expect(mapLead({ id: "4", Full_Name: "Z", Lead_Status: "Motor" }).stage).toBe("new");
  });

  it("buckets Zoho lead sources", () => {
    expect(["Cold Call", "Facebook", "Seminar-Internal", "WhatsApp - We Care Freedom Wealth Private Limited", "Self", ""].map(leadSource))
      .toEqual(["cold_call", "social_media", "seminar", "social_media", "other", "manual"]);
  });

  it("rounds a risk band down, never up", () => {
    const band = (b: string) => mapRiskProfile({ id: "1", Risk_Assignments: b, Clients: { id: "5", name: "A" }, Created_Time: "2025-04-01T10:00:00+05:30" }).category;
    expect(["Conservative", "Moderately Conservative", "Moderate", "Moderately Aggressive", "Aggressive", "Odd"].map(band))
      .toEqual(["conservative", "conservative", "moderate", "moderate", "aggressive", null]);
    const rp = mapRiskProfile({ id: "1", Risk_Assignments: "Moderate", Risk_Score_Calculations: 18, Q1_About_Tolerance_whne_market_falls_20: "I will feel bad but can manage to wait for recovery", Clients: { id: "5", name: "A" }, Created_Time: "2025-04-01T10:00:00+05:30" });
    expect([rp.score, rp.responses.length, rp.signedAt?.toISOString().slice(0, 10)]).toEqual([18, 1, "2025-04-01"]);
  });

  it("takes the firm's band for Zoho's score", () => {
    const bands = [{ id: "conservative", minScore: 8, maxScore: 18 }, { id: "moderate", minScore: 19, maxScore: 29 }, { id: "aggressive", minScore: 30, maxScore: 40 }];
    expect([9, 18, 19, 25, 29, 30, 0, 45].map((s) => categoryFromScore(s, bands))).toEqual(["conservative", "conservative", "moderate", "moderate", "moderate", "aggressive", null, null]);
    expect(categoryFromScore(24, DEFAULT_RISK_BANDS)).toBe("moderate");
  });

  it("closes finished Task Tracker rows and keeps the Zoho id", () => {
    const t = mapTask({ id: "9", Name: "T-100", Status: "Completed", Request_For: "Redemption", Task_Subject: "ICICI", Priority: "High", Type_of_Request: "Financial", Assign_To: { id: "2", name: "Disha Patel" }, Client_Name: { id: "5", name: "A" } });
    expect([t.status, t.priority, t.department, t.title, t.assignee, t.meta.zohoId]).toEqual(["completed", "high", "operations", "Redemption — ICICI", "Disha Patel", "9"]);
    expect(mapTask({ id: "10", Status: "Not Solved", Reason: "Docs missing" }).status).toBe("cancelled");
    expect(mapTask({ id: "11", Status: "Link Sent" }).status).toBe("in_progress");
    expect(mapTask({ id: "12", Status: "Link Approved" }).status).toBe("completed");
  });

  it("reads a call's direction, outcome and duration", () => {
    const c = mapCall({ id: "1", Call_Type: "Inbound", Call_Duration: "01:05", Call_Duration_in_seconds: 0, Who_Id: { id: "5", name: "A" }, Call_Start_Time: "2026-11-18T15:50:46+05:30", Subject: "Incoming call" });
    expect([c.direction, c.status, c.durationSec, c.contactZohoId]).toEqual(["inbound", "completed", 65, "5"]);
    expect(mapCall({ id: "2", Call_Type: "Missed" }).status).toBe("no_answer");
  });

  it("keeps a rejected SIP's amount and date", () => {
    const s = mapSipTracking({ id: "1", Status: "Rejected", Amount: 5000, SWP_Date: "2026-10-05", Client_Name: { id: "5", name: "A" }, Scheme_Name: "HDFC Flexi Cap" });
    expect([s.amount, s.date, s.scheme]).toEqual([5000, "2026-10-05", "HDFC Flexi Cap"]);
  });

  it("sums daily brokerage by month", () => {
    const { months, undated } = brokerageByMonth([
      { Date: "2026-11-17", Brokerge_Amount: 100, Name: "29" },
      { Date: "2026-11-02", Brokerge_Amount: 50.5, Name: "31" },
      { Date: "2026-10-30", Brokerge_Amount: 10 },
      { Brokerge_Amount: 1 },
    ]);
    expect(months.map((m) => [m.period, m.amount, m.rows])).toEqual([["2026-10", 10, 1], ["2026-11", 150.5, 2]]);
    expect(undated).toBe(1);
  });
});
