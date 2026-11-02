import { describe, expect, it } from "vitest";
import { RetentionSettingsSchema, cutoffs, readRetention, retentionIsOn } from "@/lib/privacy/retention-core";
import { boardReport, breachReference, hoursLeft, personNotice, reportDueFor, type BreachFacts } from "@/lib/privacy/breaches-core";

describe("retention policy", () => {
  it("is off until the firm sets it", () => {
    const s = readRetention({});
    expect(s).toEqual({ lostLeadMonths: null, formerClientYears: null, lastRun: null, lastErased: null });
    expect(retentionIsOn(s)).toBe(false);
  });

  it("never lets a former client go before the five years PMLA requires", () => {
    expect(RetentionSettingsSchema.safeParse({ lostLeadMonths: null, formerClientYears: 3 }).success).toBe(false);
    expect(RetentionSettingsSchema.safeParse({ lostLeadMonths: null, formerClientYears: 5 }).success).toBe(true);
  });

  it("keeps a lost lead at least six months", () => {
    expect(RetentionSettingsSchema.safeParse({ lostLeadMonths: 3, formerClientYears: null }).success).toBe(false);
  });

  it("an unreadable stored value reads as off, not as erase-everything", () => {
    expect(readRetention({ lostLeadMonths: 1, formerClientYears: 1 })).toMatchObject({ lostLeadMonths: null, formerClientYears: null });
  });

  it("works out the dates before which records are due", () => {
    const now = new Date("2026-11-02T00:00:00Z");
    const c = cutoffs({ lostLeadMonths: 12, formerClientYears: 5 }, now);
    expect(c.leadsBefore?.toISOString().slice(0, 10)).toBe("2025-11-02");
    expect(c.clientsExitedBefore?.toISOString().slice(0, 10)).toBe("2021-11-02");
    expect(cutoffs({ lostLeadMonths: null, formerClientYears: null }, now)).toEqual({ leadsBefore: null, clientsExitedBefore: null });
  });
});

describe("breach register", () => {
  const detected = new Date("2026-11-02T04:00:00Z");
  const b: BreachFacts = {
    reference: breachReference(2026, 1),
    title: "Laptop stolen",
    detectedAt: detected,
    occurredAt: null,
    description: "A laptop holding client statements was stolen from the office.",
    dataAffected: "Names, PAN, folio values",
    affectedCount: 120,
    cause: null,
    consequences: "Someone could use the PAN to impersonate the client.",
    mitigation: "Remote wipe requested; passwords changed.",
    personSteps: "Do not share OTPs with callers.",
    peopleNotifiedAt: null,
    peopleNotifiedCount: null,
  };
  const firm = { name: "We Care Freedom Wealth", contact: "Asha Mehta, privacy@wecare.in" };

  it("the Board's report is due 72 hours after the firm became aware", () => {
    expect(reportDueFor(detected).toISOString()).toBe("2026-11-05T04:00:00.000Z");
    expect(hoursLeft(reportDueFor(detected), new Date("2026-11-04T04:00:00Z"))).toBe(24);
    expect(hoursLeft(reportDueFor(detected), new Date("2026-11-05T06:00:00Z"))).toBe(-2);
    expect(b.reference).toBe("BR-2026-0001");
  });

  it("the person's notice carries every Rule 7(1) element", () => {
    const t = personNotice(b, firm);
    for (const part of ["What happened:", "What data was involved:", "What this could mean for you:", "What we are doing:", "What you can do:", "privacy@wecare.in"]) {
      expect(t).toContain(part);
    }
  });

  it("the Board's report covers Rule 7(2)(b), and marks what is still unknown", () => {
    const t = boardReport(b, firm);
    expect(t).toContain("BR-2026-0001");
    expect(t).toContain("People affected: 120");
    expect(t).toContain("Circumstances and reasons: [to be filled in]");
    expect(t).toContain("Intimation to the people affected: being sent.");
  });
});
