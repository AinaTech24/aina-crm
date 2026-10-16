import { describe, expect, it } from "vitest";
import { OPPORTUNITY_PATHS, OPPORTUNITY_STAGES, nextStage, opportunityTransitions } from "@/lib/opportunities/stages";
import { fromLeadProduct, productPipeline, proposalTypesFor, OPPORTUNITY_PRODUCTS } from "@/lib/opportunities/products";
import { gateFor, skipReason, type Facts } from "@/lib/opportunities/journey";
import type { ClientOpportunity } from "@/db/schema";

const opp = (over: Partial<ClientOpportunity> = {}): ClientOpportunity => ({
  id: "00000000-0000-0000-0000-000000000001",
  tenantId: "t", investorId: "i", product: "mutual_funds", pipeline: "mf", status: "open",
  expectedValue: "10000", investmentMode: "sip", source: "manual", ownerId: null, coOwnerId: null,
  sourceLeadId: null, needsAnalysis: null, notes: null, lostReason: null, revisitOn: null,
  wonAt: null, lostAt: null, createdBy: null, createdAt: new Date(), updatedAt: new Date(),
  ...over,
} as ClientOpportunity);

const facts = (over: Partial<Facts> = {}): Facts => ({
  kycStatus: "verified", kycVerified: true, hasUcc: true, mandateStatus: "active", mandateAmount: 25000,
  riskState: "current", riskSignedAt: new Date().toISOString(), proposal: null, policy: null, transaction: null, fixedDeposit: null,
  ...over,
});

describe("opportunity journey shape", () => {
  it("every path starts at Need identified and ends at Won", () => {
    for (const path of Object.values(OPPORTUNITY_PATHS)) {
      expect(path[0]).toBe("identified");
      expect(path[path.length - 1]).toBe("won");
    }
  });

  it("every stage on a path is a seeded stage", () => {
    const keys = new Set(OPPORTUNITY_STAGES.map((s) => s.key));
    for (const path of Object.values(OPPORTUNITY_PATHS)) for (const k of path) expect(keys.has(k)).toBe(true);
  });

  it("has a transition for every step of every path, and to Lost from every open stage", () => {
    const t = new Set(opportunityTransitions().map((x) => `${x.from}>${x.to}`));
    for (const path of Object.values(OPPORTUNITY_PATHS)) {
      for (let i = 0; i < path.length - 1; i++) expect(t.has(`${path[i]}>${path[i + 1]}`)).toBe(true);
    }
    for (const s of OPPORTUNITY_STAGES) if (s.key !== "won" && s.key !== "lost") expect(t.has(`${s.key}>lost`)).toBe(true);
  });

  it("a general product has no suitability stage", () => {
    expect(OPPORTUNITY_PATHS.general).not.toContain("suitability");
    expect(nextStage("general", "discussion")).toBe("proposal");
  });

  it("maps products to their journey", () => {
    expect(productPipeline("mutual_funds")).toBe("mf");
    expect(productPipeline("health_insurance")).toBe("insurance");
    expect(productPipeline("nps")).toBe("general");
    expect(OPPORTUNITY_PRODUCTS.some((p) => p.key === "other")).toBe(true);
    expect(proposalTypesFor("life_insurance")).toContain("insurance");
    expect(fromLeadProduct("insurance")).toBe("life_insurance");
  });
});

describe("gates", () => {
  it("an MF proposal needs a current, client-confirmed risk profile", () => {
    expect(gateFor("proposal", opp(), facts()).every((p) => p.satisfied)).toBe(true);
    expect(gateFor("proposal", opp(), facts({ riskState: "awaiting" })).some((p) => !p.satisfied)).toBe(true);
    expect(gateFor("proposal", opp(), facts({ riskState: "expired" })).some((p) => !p.satisfied)).toBe(true);
  });

  it("an insurance quote needs a needs analysis", () => {
    const ins = opp({ product: "health_insurance", pipeline: "insurance", investmentMode: null });
    expect(gateFor("proposal", ins, facts()).some((p) => !p.satisfied)).toBe(true);
    expect(gateFor("proposal", { ...ins, needsAnalysis: { coverNeeded: 1000000 } } as ClientOpportunity, facts()).every((p) => p.satisfied)).toBe(true);
  });

  it("an MF transaction needs KYC, a UCC and, for a SIP, a mandate that covers it", () => {
    expect(gateFor("mf_transaction", opp(), facts()).every((p) => p.satisfied)).toBe(true);
    expect(gateFor("mf_transaction", opp(), facts({ kycVerified: false, kycStatus: "expired" })).some((p) => !p.satisfied)).toBe(true);
    expect(gateFor("mf_transaction", opp({ expectedValue: "50000" }), facts()).some((p) => !p.satisfied)).toBe(true);
    expect(gateFor("mf_transaction", opp({ investmentMode: "lumpsum", expectedValue: "500000" }), facts({ mandateStatus: "none" })).every((p) => p.satisfied)).toBe(true);
  });
});

describe("proposal approval and transaction review", () => {
  const stepsAfterAccepted = ["mf_kyc", "ins_proposal_form", "gen_executed"];
  it("waits for the client to approve the proposal before the step after Client accepted", () => {
    for (const t of stepsAfterAccepted) {
      expect(gateFor(t, opp(), facts()).some((p) => !p.satisfied), t).toBe(true);
      const sent = facts({ proposal: { id: "p", status: "sent", type: "mutual_fund" } });
      expect(gateFor(t, opp(), sent).some((p) => !p.satisfied), t).toBe(true);
      const ok = facts({ proposal: { id: "p", status: "accepted", type: "mutual_fund" } });
      expect(gateFor(t, opp(), ok).every((p) => p.satisfied), t).toBe(true);
    }
  });

  it("an MF journey ends Transaction placed → Approve / reject transaction → Won", () => {
    expect(nextStage("mf", "mf_transaction")).toBe("txn_review");
    expect(nextStage("mf", "txn_review")).toBe("won");
    const t = new Set(opportunityTransitions().map((x) => `${x.from}>${x.to}`));
    expect(t.has("txn_review>mf_transaction")).toBe(true); // a rejection goes back
    expect(t.has("txn_review>lost")).toBe(true);
  });

  it("never skips the review: a person approves or rejects", () => {
    expect(skipReason("txn_review", opp(), facts({ transaction: { id: "t", orderDate: null, amount: 1 } }))).toBeNull();
  });

  it("seeded stage orders are a strict sequence", () => {
    const orders = OPPORTUNITY_STAGES.map((s) => s.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("skips", () => {
  it("skips what an existing MF client already has", () => {
    const o = opp();
    expect(skipReason("mf_kyc", o, facts())).not.toBeNull();
    expect(skipReason("mf_ucc", o, facts())).not.toBeNull();
    expect(skipReason("mf_mandate", o, facts())).not.toBeNull();
    expect(skipReason("suitability", o, facts())).not.toBeNull();
  });

  it("never skips a stage that is not on file", () => {
    const o = opp();
    expect(skipReason("mf_kyc", o, facts({ kycVerified: false }))).toBeNull();
    expect(skipReason("mf_mandate", o, facts({ mandateStatus: "pending" }))).toBeNull();
    expect(skipReason("proposal", o, facts())).toBeNull();
    expect(skipReason("identified", o, facts())).toBeNull();
    expect(skipReason("discussion", o, facts())).toBeNull();
  });

  it("a sent proposal completes the proposal stage; only an accepted one completes acceptance", () => {
    const o = opp();
    const sent = facts({ proposal: { id: "p", status: "sent", type: "mutual_fund" } });
    expect(skipReason("proposal", o, sent)).not.toBeNull();
    expect(skipReason("accepted", o, sent)).toBeNull();
    expect(skipReason("accepted", o, facts({ proposal: { id: "p", status: "accepted", type: "mutual_fund" } }))).not.toBeNull();
  });

  it("a recorded, issued policy carries an insurance journey to the end", () => {
    const ins = opp({ product: "life_insurance", pipeline: "insurance", investmentMode: null });
    const issued = facts({ policy: { id: "x", status: "active", policyType: "term" } });
    expect(skipReason("ins_proposal_form", ins, issued)).not.toBeNull();
    expect(skipReason("ins_underwriting", ins, issued)).not.toBeNull();
    expect(skipReason("ins_issued", ins, issued)).not.toBeNull();
    const proposed = facts({ policy: { id: "x", status: "proposed", policyType: "term" } });
    expect(skipReason("ins_underwriting", ins, proposed)).toBeNull();
  });
});
