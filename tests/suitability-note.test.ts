/**
 * The drafted suitability note says what the proposal shows, names the client,
 * leaves out what it doesn't know, and never claims anything the advisor has
 * not said (agreement, understanding, surplus money) or mentions the regulator.
 */
import { describe, expect, it } from "vitest";
import { draftSuitabilityNote } from "@/lib/proposals/suitability-note";

const mf = (v: Record<string, unknown> = {}) => ({
  kind: "mf", schemeName: "Parag Parikh Flexi Cap Fund - Regular Growth", riskRating: "very_high",
  monthlyAmount: 10000, sipTermYears: 10, goal: "Wealth creation", ...v,
});

describe("draftSuitabilityNote", () => {
  it("fills the client, goal, horizon, risk profile, funds and amount", () => {
    const note = draftSuitabilityNote({ clientName: "Darshini Shah", riskProfile: "aggressive", items: [mf()] });
    expect(note).toBe(
      "Recommended for Darshini Shah's goal of wealth creation over 10 years. " +
        "Darshini Shah's confirmed risk profile is Aggressive, and the recommended fund (Parag Parikh Flexi Cap Fund - Regular Growth) is within that risk level. " +
        "The recommendation is a monthly SIP of ₹10,000 in Parag Parikh Flexi Cap Fund - Regular Growth."
    );
  });

  it("is different for each client", () => {
    const a = draftSuitabilityNote({ clientName: "Asha Mehta", riskProfile: "moderate", items: [mf({ riskRating: "moderate", goal: "Child's education" })] });
    const b = draftSuitabilityNote({ clientName: "Ravi Iyer", riskProfile: "aggressive", items: [mf({ goal: "Retirement" })] });
    expect(a).toContain("Asha Mehta");
    expect(a).toContain("child's education");
    expect(a).toContain("Moderate");
    expect(b).toContain("Ravi Iyer");
    expect(b).toContain("retirement");
    expect(a).not.toBe(b);
  });

  it("lists several funds and both a SIP and a lumpsum", () => {
    const note = draftSuitabilityNote({
      clientName: "Asha Mehta", riskProfile: "aggressive",
      items: [mf({ schemeName: "Fund A", lumpsum: 50000 }), mf({ schemeName: "Fund B", monthlyAmount: 5000 }), mf({ schemeName: "Fund C" }), mf({ schemeName: "Fund D" })],
    });
    expect(note).toContain("Fund A, Fund B, Fund C and 1 more");
    expect(note).toContain("monthly SIPs totalling ₹35,000 and lumpsums totalling ₹50,000");
  });

  it("puts each amount against its own fund, and skips a fund with no amount", () => {
    const note = draftSuitabilityNote({
      clientName: "Sneha Reddy", riskProfile: "moderate",
      items: [
        { kind: "mf", schemeName: "Kotak Nifty Midcap 50 ETF", recommendationType: "lumpsum" },
        { kind: "mf", schemeName: "HSBC Small Cap Fund", recommendationType: "sip", monthlyAmount: 10000 },
      ],
    });
    expect(note).toContain("The recommendation is a monthly SIP of ₹10,000 in HSBC Small Cap Fund.");
    expect(note).not.toContain("₹10,000 in Kotak");
  });

  it("does not say a fund is within the risk level when it has no risk rating", () => {
    const note = draftSuitabilityNote({ clientName: "Sneha Reddy", riskProfile: "moderate", items: [mf({ riskRating: undefined })] });
    expect(note).toContain("was reviewed against it");
    expect(note).not.toContain("within that risk level");
  });

  it("leaves out what the proposal does not say instead of printing a blank", () => {
    const note = draftSuitabilityNote({ clientName: "Asha Mehta", riskProfile: "aggressive", items: [mf({ goal: undefined, sipTermYears: undefined })] });
    expect(note).not.toMatch(/goal of|over\s|\{|\}|undefined|null/);
    expect(note).toContain("confirmed risk profile is Aggressive");
  });

  it("falls back to the client's own goal", () => {
    const note = draftSuitabilityNote({ clientName: "Asha Mehta", riskProfile: "aggressive", goals: [{ name: "Retirement" }], items: [mf({ goal: undefined })] });
    expect(note).toContain("goal of retirement");
  });

  it("says a fund was reviewed, not that it fits, when it is above the profile, and carries the advisor's reason", () => {
    const note = draftSuitabilityNote({
      clientName: "Asha Mehta", riskProfile: "moderate",
      items: [mf({ schemeName: "Small Cap Fund", riskRating: "very_high", suitabilityReason: "the client asked for 10% in small caps over a 12 year horizon." })],
    });
    expect(note).toContain("was reviewed against it");
    expect(note).not.toContain("within that risk level");
    expect(note).toContain("Small Cap Fund is kept above the client's risk level because the client asked for 10% in small caps over a 12 year horizon.");
  });

  it("drafts nothing when it knows too little", () => {
    expect(draftSuitabilityNote({ clientName: "Asha Mehta", items: [] })).toBe("");
  });

  it("never claims agreement or understanding, and never names the regulator", () => {
    const note = draftSuitabilityNote({ clientName: "Asha Mehta", riskProfile: "aggressive", items: [mf()] });
    expect(note).not.toMatch(/agreed|understand|surplus|informed|SEBI/i);
  });
});
