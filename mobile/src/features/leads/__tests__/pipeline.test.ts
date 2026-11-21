/**
 * The lead pipeline and journey rules the app must share with the CRM
 * (lib/leads/stages LEAD_PIPELINE + lib/leads/normalize LEAD_STAGE_ALIASES).
 */
jest.mock("../../../api/client", () => ({ api: {} }));
jest.mock("../../../lib/offlineQueue", () => ({ queuedPost: jest.fn() }));
import { canonicalStage, filterLeads, groupByStage, leadSourceLabel, stageFilterValues, type Lead } from "../api";
import { journeyStage, LEAD_PHASE } from "../journey";

const lead = (over: Partial<Lead>) => ({ id: Math.random().toString(36).slice(2), name: "A", stage: "new", ...over }) as Lead;

describe("legacy stage values fold into the seven columns (web LEAD_PIPELINE)", () => {
  it.each([
    ["proposal_shared", "proposal_sent"],
    ["proposal_drafted", "proposal_sent"],
    ["proposal_approved", "won_lead"],
    ["risk_profiled", "meeting_done"],
    ["risk_profile_sent", "meeting_done"],
    ["contacted", "call_done"],
    ["cold", "not_qualified"],
  ])("%s sits in %s", (stored, column) => {
    expect(canonicalStage(stored)).toBe(column);
  });

  it("never grows a stray column for a legacy value", () => {
    const cols = groupByStage([lead({ stage: "proposal_shared" }), lead({ stage: "risk_profiled" })]);
    expect(cols).toHaveLength(7);
    expect(cols.find((c) => c.key === "proposal_sent")?.leads).toHaveLength(1);
    expect(cols.find((c) => c.key === "meeting_done")?.leads).toHaveLength(1);
  });

  it("a column filter sends the legacy values it holds", () => {
    expect(stageFilterValues(["proposal_sent"])).toEqual(expect.arrayContaining(["proposal_sent", "proposal_shared", "proposal_drafted"]));
  });
});

describe("journey stage", () => {
  it("reads a legacy stored stage as its journey step", () => {
    expect(journeyStage("contacted")).toBe("call_done");
    expect(journeyStage("proposal_shared")).toBe("proposal_sent");
    expect(journeyStage(null)).toBe("new");
    expect(LEAD_PHASE.has(journeyStage("follow_up"))).toBe(true);
  });
  it("leaves an onboarding step outside the lead phase", () => {
    expect(LEAD_PHASE.has(journeyStage("request_documents"))).toBe(false);
  });
});

describe("lead sources (web lib/leads/sources)", () => {
  it("names a source the way the web does", () => {
    expect(leadSourceLabel("referral")).toBe("Client Referral");
    expect(leadSourceLabel("existing_client")).toBe("Client Referral");
    expect(leadSourceLabel("manual")).toBe("Manual entry");
    expect(leadSourceLabel("meta_ads")).toBe("Meta ads");
    expect(leadSourceLabel(null)).toBe("—");
  });
});

describe("client-side search", () => {
  it("keeps the leads the server matched on the RM's name", () => {
    const rows = [lead({ name: "Asha", ownerName: "Ravi Shah" }), lead({ name: "Bhavin", ownerName: "Meera" })];
    expect(filterLeads(rows, "ravi").map((l) => l.name)).toEqual(["Asha"]);
  });
});
