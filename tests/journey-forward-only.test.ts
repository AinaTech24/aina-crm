/**
 * The Lead → Client journey's direction rules (lib/blueprints/journey-rules.ts)
 * and the keys every automatic source names (audit L1, C1, C3, C17, C2).
 */
import { describe, expect, it } from "vitest";
import { automaticMoveBlock, canCloseAsLost, journeyRank } from "@/lib/blueprints/journey-rules";
import { EVENT_TO_STAGE } from "@/lib/blueprints/auto-advance";
import {
  GENERAL_EXECUTED_STAGE,
  GENERAL_HIDDEN_KEYS,
  INSURANCE_ENTRY_STAGE,
  LEAD_TO_CLIENT_STAGES,
  LEAD_TO_CLIENT_TRANSITIONS,
} from "@/lib/blueprints/lead_to_client";
import { STAGE_ACTIONS } from "@/lib/blueprints/stage-actions";
import { FACT_STEPS, factJourney } from "@/lib/blueprints/client-facts";

const KEYS = new Set(LEAD_TO_CLIENT_STAGES.map((s) => s.key));
const auto = (from: string, to: string, converted = false) => automaticMoveBlock(from, to, { converted });

describe("every stage key an automatic source names exists", () => {
  it("the event map", () => {
    for (const [event, stage] of Object.entries(EVENT_TO_STAGE)) {
      if (stage) expect(KEYS.has(stage), `${event} → ${stage}`).toBe(true);
    }
  });
  it("the stage buttons, transitions and branches", () => {
    for (const [stage, actions] of Object.entries(STAGE_ACTIONS)) {
      expect(KEYS.has(stage), stage).toBe(true);
      for (const a of actions) expect(KEYS.has(a.targetStage), `${stage} → ${a.targetStage}`).toBe(true);
    }
    for (const t of LEAD_TO_CLIENT_TRANSITIONS) {
      expect(KEYS.has(t.from), t.from).toBe(true);
      expect(KEYS.has(t.to), t.to).toBe(true);
    }
    for (const k of [INSURANCE_ENTRY_STAGE, GENERAL_EXECUTED_STAGE, ...GENERAL_HIDDEN_KEYS, ...FACT_STEPS]) {
      expect(KEYS.has(k), k).toBe(true);
    }
  });
  it("the dead keys of old are gone from the event map", () => {
    const targets = Object.values(EVENT_TO_STAGE);
    for (const dead of ["docs_received", "docs_requested", "risk_profile_sent", "risk_profiled"]) {
      expect(targets).not.toContain(dead);
    }
  });
});

describe("automatic moves are forward-only", () => {
  it("a converted lead never goes back to a lead stage (Lost included)", () => {
    expect(auto("request_documents", "call_done", true)).not.toBeNull();
    expect(auto("request_documents", "meeting_done", true)).not.toBeNull();
    expect(auto("documents_pending", "meeting_scheduled", true)).not.toBeNull();
    expect(auto("kyc_validated", "not_qualified", true)).not.toBeNull();
    // Even a stale converted journey still at Won Lead.
    expect(auto("won_lead", "call_done", true)).not.toBeNull();
    expect(auto("won_lead", "request_documents", true)).toBeNull();
  });

  it("convert never pulls a journey already further back to Request Documents (C1)", () => {
    expect(auto("documents_pending", "request_documents", true)).not.toBeNull();
    expect(auto("documents_received", "request_documents", true)).not.toBeNull();
    // An insurance journey under way is not pushed into MF documents.
    expect(auto("insurance_quote", "request_documents", true)).not.toBeNull();
    expect(auto("insurance_quote", INSURANCE_ENTRY_STAGE, true)).not.toBeNull();
  });

  it("a lead does not move backwards in the lead phase", () => {
    expect(auto("proposal_sent", "meeting_scheduled")).not.toBeNull();
    expect(auto("meeting_done", "call_done")).not.toBeNull();
    expect(auto("call_done", "call_not_connected")).not.toBeNull();
  });

  it("forward and sideways moves still happen", () => {
    expect(auto("new", "call_done")).toBeNull();
    expect(auto("call_back_later", "call_done")).toBeNull(); // a loop sits before Call Done
    expect(auto("call_back_later", "call_not_connected")).toBeNull(); // sideways in the loop
    expect(auto("meeting_done", "proposal_sent")).toBeNull();
    expect(auto("proposal_sent", "won_lead")).toBeNull();
    expect(auto("kyc_pending", "kyc_validated", true)).toBeNull(); // C14: every KYC branch leads in
    expect(auto("transaction_failed", "make_transaction", true)).toBeNull(); // a retry
    expect(auto("make_transaction", "transaction_successful", true)).toBeNull();
    expect(auto("rta_submitted", "rta_rejected", true)).toBeNull();
  });

  it("a prospect is not made a client by a shared link", () => {
    expect(auto("meeting_done", "documents_pending")).not.toBeNull();
    expect(auto("won_lead", "documents_pending")).toBeNull();
  });

  it("never crosses onboarding branch or route", () => {
    expect(auto("insurance_quote", "kyc_validated", true)).not.toBeNull();
    expect(auto("rta_submitted", "transaction_successful", true)).not.toBeNull();
  });

  it("Lost: closing any open lead stage, reopening by a new conversation", () => {
    expect(auto("new", "not_qualified")).toBeNull();
    expect(auto("won_lead", "not_qualified")).toBeNull();
    expect(auto("not_qualified", "call_done")).toBeNull();
    expect(canCloseAsLost("won_lead", false)).toBe(true);
    expect(canCloseAsLost("meeting_pending", false)).toBe(true);
    expect(canCloseAsLost("won_lead", true)).toBe(false);
    expect(canCloseAsLost("documents_pending", false)).toBe(false);
  });

  it("ranks the KYC branches below KYC Validated", () => {
    for (const k of ["kyc_registered", "kyc_pending", "modify_kyc", "physical_kyc", "online_kyc"]) {
      expect(journeyRank(k)).toBeLessThan(journeyRank("kyc_validated"));
      expect(journeyRank(k)).toBeGreaterThan(journeyRank("documents_received"));
    }
  });
});

describe("a directly-added client's journey comes from facts (C2)", () => {
  it("ticks nothing it cannot prove", () => {
    const j = factJourney({ kycVerified: false, hasUcc: false, mandateActive: false, invested: false, inFamily: false, active: true });
    expect(Object.values(j).filter((s) => s === "done")).toHaveLength(0);
    expect(j.kyc_validated).toBe("current");
  });
  it("money with the registrar without a UCC skips the exchange steps instead of ticking them", () => {
    const j = factJourney({ kycVerified: true, hasUcc: false, mandateActive: false, invested: true, inFamily: false, active: true });
    expect(j.ucc_activated).toBe("skipped");
    expect(j.mandate_activated).toBe("skipped");
    expect(j.transaction_successful).toBe("done");
    expect(j.family_mapping).toBe("current");
  });
  it("never shows a failure step", () => {
    for (const k of FACT_STEPS) {
      expect(["mandate_reject", "transaction_failed", "rta_rejected", "insurance_lost", "not_qualified"]).not.toContain(k);
    }
  });
});
