/**
 * lib/metrics — the pure halves of the one-definition-per-number rules.
 * No database: these pin the conversions, the stage list and the buckets
 * every dashboard, badge and module page shares. The DB-backed half (the SIP
 * rows add up to the SIP book, and so on) is tests/metrics-consistency.test.ts.
 */

import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { SIP_PER_MONTH, monthlySipAmount, sipMonthlySql } from "@/lib/metrics/sip";
import { summariseLeadCounts, LEAD_OPEN_KEYS } from "@/lib/metrics/leads";
import { SR_CLOSED, SR_ESCALATED, SR_OPEN, SR_OPEN_ON_US, SR_WAITING_CLIENT } from "@/lib/metrics/service";
import { coversPeriod, coversWholePeriod } from "@/lib/metrics/business";
import { targetPct, onboardedInSql } from "@/lib/metrics/new-clients";
import { TASK_DEAD, TASK_OPEN } from "@/lib/metrics/tasks";
import { LEAD_PIPELINE, leadPipelineColumn, leadStageDisplay } from "@/lib/leads/stages";
import { LEAD_PHASE_STAGES, normalizeLeadStage } from "@/lib/leads/normalize";
import {
  LEAD_PHASE_LAST_ORDER,
  LEAD_TO_CLIENT_STAGES,
  LEAD_TO_CLIENT_TRANSITIONS,
  stageDisposition,
} from "@/lib/blueprints/lead_to_client";
import { STAGE_ACTIONS } from "@/lib/blueprints/stage-actions";
import { serviceRequests } from "@/db/schema";

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(q).sql;

describe("SIP book: monthly equivalent", () => {
  it("converts every frequency to a monthly figure", () => {
    expect(monthlySipAmount(8000, "monthly")).toBe(8000);
    expect(monthlySipAmount(30000, "quarterly")).toBe(10000);
    expect(monthlySipAmount(60000, "half_yearly")).toBe(10000);
    expect(monthlySipAmount(120000, "yearly")).toBe(10000);
    expect(monthlySipAmount(1200, "weekly")).toBeCloseTo(5200, 6);
    expect(monthlySipAmount(1200, "fortnightly")).toBeCloseTo(2600, 6);
  });

  it("reads numeric strings (Postgres numerics) and treats an unknown frequency as monthly", () => {
    expect(monthlySipAmount("8000.00", "monthly")).toBe(8000);
    expect(monthlySipAmount(5000, null)).toBe(5000);
    expect(monthlySipAmount(5000, "every_blue_moon")).toBe(5000);
    expect(monthlySipAmount("n/a", "monthly")).toBe(0);
  });

  it("builds the SQL CASE from the same factor table as the TypeScript", () => {
    const text = render(sipMonthlySql("s"));
    for (const [freq, [n, d]] of Object.entries(SIP_PER_MONTH)) {
      if (freq === "monthly") continue;
      expect(text).toContain(`WHEN '${freq}' THEN ${n}.0 / ${d}`);
    }
    expect(text).toContain("s.amount::numeric");
    expect(text).toContain("ELSE 1 END");
  });

  it("sum of SIP rows equals the SIP book: the book is exactly Σ monthly rows", () => {
    // The SIP Book page lists the rows; the KPI is the book. Both are built
    // from monthlySipAmount / sipMonthlySql, so for any set of active rows the
    // KPI is their monthly sum, not the instalment sum.
    const rows = [
      { amount: 8000, frequency: "monthly" },
      { amount: 30000, frequency: "quarterly" },
      { amount: 60000, frequency: "half_yearly" },
    ];
    const book = rows.reduce((s, r) => s + monthlySipAmount(r.amount, r.frequency), 0);
    expect(book).toBe(28000);
    expect(book).not.toBe(98000); // the un-converted instalment sum
  });
});

describe("Lead stages: one list", () => {
  it("is New → Contacted → Meeting Scheduled → Meeting Done → Proposal Sent → Won / Lost", () => {
    expect(LEAD_PIPELINE.map((c) => c.label)).toEqual([
      "New", "Contacted", "Meeting Scheduled", "Meeting Done", "Proposal Sent", "Won", "Lost",
    ]);
  });

  it("has no Qualified or Converted bucket — both fold into a board column", () => {
    const labels = LEAD_PIPELINE.map((c) => c.label.toLowerCase());
    expect(labels).not.toContain("qualified");
    expect(labels).not.toContain("converted");
    expect(leadPipelineColumn("qualified")?.label).toBe("Meeting Scheduled");
    expect(leadPipelineColumn("converted")?.label).toBe("Won");
    expect(leadPipelineColumn("contacted")?.label).toBe("Contacted");
    expect(leadPipelineColumn("lost")?.label).toBe("Lost");
    expect(leadStageDisplay("proposal_shared")).toBe("Proposal Sent");
  });

  it("puts every lead-phase stage on exactly one column", () => {
    for (const stage of LEAD_PHASE_STAGES) {
      const hits = LEAD_PIPELINE.filter((c) => c.members.includes(stage));
      expect(hits.length, stage).toBe(1);
    }
  });

  it("never puts one stored value in two columns", () => {
    const seen = new Map<string, string>();
    for (const c of LEAD_PIPELINE) {
      for (const m of c.members) {
        expect(seen.get(m), `${m} is in ${seen.get(m)} and ${c.label}`).toBeUndefined();
        seen.set(m, c.label);
      }
    }
    expect(seen.get("risk_profiled")).toBe("Meeting Done");
  });

  it("normalises imported proposal vocabularies onto Proposal Sent, approval onto Won", () => {
    expect(normalizeLeadStage("proposal_sent")).toBe("proposal_sent");
    expect(normalizeLeadStage("Proposal Shared")).toBe("proposal_sent");
    expect(normalizeLeadStage("proposal_drafted")).toBe("proposal_sent");
    expect(normalizeLeadStage("proposal_approved")).toBe("won_lead");
  });

  it("conversion = Won ÷ (Won + Lost + open) and matches the Won count shown", () => {
    const c = summariseLeadCounts([
      { key: "new", n: 3 }, { key: "call_done", n: 2 }, { key: "meeting_scheduled", n: 2 },
      { key: "proposal_sent", n: 1 }, { key: "won_lead", n: 1 }, { key: "not_qualified", n: 1 },
    ]);
    expect(c.open).toBe(8);
    expect(c.won).toBe(1);
    expect(c.lost).toBe(1);
    expect(c.total).toBe(10);
    expect(c.conversion).toBeCloseTo(c.won / (c.won + c.lost + c.open), 10);
    expect(c.byStage.meeting_done).toBe(0); // every column present, zero or not
    expect(LEAD_OPEN_KEYS).not.toContain("won_lead");
  });

  it("has no conversion rate for no leads (never 0%)", () => {
    expect(summariseLeadCounts([]).conversion).toBeNull();
  });
});

describe("Lead → Client SOP: Proposal Sent is a real stage", () => {
  it("keeps stage orders a gapless sequence with Proposal Sent after Meeting Done", () => {
    const orders = LEAD_TO_CLIENT_STAGES.map((s) => s.order);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
    const at = (k: string) => LEAD_TO_CLIENT_STAGES.find((s) => s.key === k)!.order;
    expect(at("proposal_sent")).toBe(at("meeting_done") + 1);
    expect(at("won_lead")).toBe(at("proposal_sent") + 1);
    expect(LEAD_PHASE_LAST_ORDER).toBe(at("not_qualified"));
  });

  it("only transitions between stages that exist, including out of Proposal Sent", () => {
    const keys = new Set(LEAD_TO_CLIENT_STAGES.map((s) => s.key));
    for (const t of LEAD_TO_CLIENT_TRANSITIONS) {
      expect(keys.has(t.from), t.from).toBe(true);
      expect(keys.has(t.to), t.to).toBe(true);
    }
    const out = LEAD_TO_CLIENT_TRANSITIONS.filter((t) => t.from === "proposal_sent").map((t) => t.to).sort();
    expect(out).toEqual(["meeting_scheduled", "not_qualified", "won_lead"]);
    expect(LEAD_TO_CLIENT_TRANSITIONS.some((t) => t.from === "meeting_done" && t.to === "proposal_sent")).toBe(true);
  });

  it("offers buttons on Proposal Sent and still closes lost leads", () => {
    expect(STAGE_ACTIONS.proposal_sent?.map((a) => a.targetStage)).toEqual(["won_lead", "meeting_scheduled", "not_qualified"]);
    expect(stageDisposition("not_qualified")).toBe("lost");
    expect(stageDisposition("proposal_sent")).toBe("in_progress");
  });
});

describe("Service requests: the page's tabs", () => {
  it("partition every status exactly once", () => {
    const all = (serviceRequests.status as unknown as { enumValues: string[] }).enumValues;
    const tabs = [...SR_OPEN, ...SR_ESCALATED, ...SR_WAITING_CLIENT, ...SR_CLOSED];
    expect(new Set(tabs).size).toBe(tabs.length);
    expect([...tabs].sort()).toEqual([...all].sort());
  });

  it("counts open-on-us as Open + Escalated — waiting on the client is not on us", () => {
    expect([...SR_OPEN_ON_US].sort()).toEqual([...SR_OPEN, ...SR_ESCALATED].sort());
    expect(SR_OPEN_ON_US).not.toContain("waiting_customer");
  });
});

describe("Tasks: overdue means still to do", () => {
  it("treats blocked as open and completed/cancelled as finished — there is no 'done'", () => {
    expect([...TASK_OPEN]).toEqual(["open", "in_progress", "blocked"]);
    expect([...TASK_DEAD]).toEqual(["completed", "cancelled"]);
    expect([...TASK_OPEN, ...TASK_DEAD]).not.toContain("done");
  });
});

describe("New clients and targets", () => {
  it("dates the onboarding in India time", () => {
    const text = render(onboardedInSql({ from: "2026-04-01", to: "2026-09-29" }, "i"));
    expect(text).toContain("i.onboarded_at AT TIME ZONE 'Asia/Kolkata'");
    expect(text).not.toContain("created_at");
  });

  it("measures FY-to-date against the FY target, and has no % without a target", () => {
    expect(targetPct(2, 2)).toBe(1);
    expect(targetPct(22, 24)).toBeCloseTo(0.9167, 3);
    expect(targetPct(5, null)).toBeNull();
    expect(targetPct(5, 0)).toBeNull();
    expect(targetPct(null, 24)).toBeNull();
  });
});

describe("Money movement: no data is not zero", () => {
  const ledger = { first: "2024-01-01", last: "2024-06-01" };
  it("reports no data for a period the imported ledger never reaches", () => {
    expect(coversPeriod(ledger, { from: "2026-04-01", to: "2026-09-29" })).toBe(false);
    expect(coversPeriod({ first: null, last: null }, { from: "2026-04-01", to: "2026-09-29" })).toBe(false);
  });
  it("compares only against a period the ledger covers from its first day", () => {
    const full = { first: "2025-01-01", last: "2026-09-28" };
    expect(coversPeriod(full, { from: "2026-09-01", to: "2026-09-29" })).toBe(true);
    expect(coversWholePeriod(full, { from: "2025-04-01", to: "2025-09-29" })).toBe(true);
    expect(coversWholePeriod({ first: "2025-06-15", last: "2026-09-28" }, { from: "2025-04-01", to: "2025-09-29" })).toBe(false);
  });
});
