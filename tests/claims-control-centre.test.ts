/**
 * The Insurance Claims Control Centre's definitions (lib/dashboard/claims):
 * how a claim's SLA, escalation level and pending-with are read, and the
 * figures the brief is strict about — pending vs file-not-received,
 * outstanding, the settlement ratio's denominator, grievance claims kept out
 * of TAT, and the backlog adding up month by month. Pure functions: no DB.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_THRESHOLDS } from "../src/lib/dashboard/thresholds";
import { deriveClaim, openAt, type ClaimRec } from "../src/lib/dashboard/claims/set";
import type { ClaimWindow } from "../src/lib/dashboard/claims/window";
import { kpiStrip, settlement, slaTat, valueSummary, worklist } from "../src/lib/dashboard/claims/analysis";
import { monthlyTrend, weeklyReview } from "../src/lib/dashboard/claims/review";

const TODAY = "2026-09-29";
const w: ClaimWindow = {
  tenantId: "t", userId: "u", scope: { kind: "firm" }, filter: {},
  from: "2026-09-01", to: TODAY, periodLabel: "September 2026", prevFrom: "2026-08-01", prevTo: "2026-08-29", prevLabel: "August",
  fyStart: "2026-04-01", today: TODAY, t: DEFAULT_DASHBOARD_THRESHOLDS,
  highValue: 500_000, noUpdateDays: 3, clientUpdateDays: 7,
};

let n = 0;
/** A claim as the SQL row would carry it; derived for `TODAY`. */
function claim(o: Partial<Record<string, unknown>> & { status: string; opened: string }): ClaimRec {
  n += 1;
  const closed = ["settled_fully", "settled_partially", "rejected", "withdrawn"].includes(o.status);
  return deriveClaim({
    id: `c${n}`, policy_id: "p", investor_id: "i", client: `Client ${n}`, proposer_name: `Client ${n}`, phone: null,
    status: o.status, claim_type: "main_claim", claim_mode: o.mode ?? null, insurer: "Star Health", insurer_key: "star health",
    policy_number: "P-1", plan_name: "Plan", policy_type: o.policyType ?? "health", grp: "health", line: o.line ?? "personal",
    claimed: o.claimed ?? 100_000, settled: o.settled ?? 0,
    intimation_date: o.opened, submission_date: null, settlement_date: o.settledOn ?? null,
    opened_on_s: o.opened, created_on: o.opened, created_at: `${o.opened}T10:00:00+05:30`, updated_at: o.updated ?? `${o.opened}T10:00:00+05:30`,
    closed_on_s: closed ? (o.closedOn ?? o.settledOn ?? null) : null, closed_src: closed ? "audit" : null,
    owner_id: "owner", client_rm_id: "rm", branch_id: "b", comments: null, doc_types: o.docs ?? [], docs_n: ((o.docs as string[]) ?? []).length,
    h: o.hist ?? {}, na_id: o.actionDue !== undefined ? "task" : null, na_title: "Follow up", na_due: o.actionDue ?? null, na_assignee: "rm", na_n: o.actionDue !== undefined ? 1 : 0,
    last_contact: null,
  }, w);
}

describe("a claim's state today", () => {
  it("reads SLA from the intimation date and the firm's claim SLA", () => {
    expect(claim({ status: "under_process", opened: "2026-09-20" }).sla).toBe("within");
    expect(claim({ status: "under_process", opened: "2026-09-02" }).sla).toBe("approaching"); // due 2 Oct, within 5 days
    const late = claim({ status: "under_process", opened: "2026-08-20" }); // due 19 Sept
    expect(late.sla).toBe("breached");
    expect(late.breachDays).toBe(10);
    expect(claim({ status: "settled_fully", opened: "2026-08-01", settledOn: "2026-09-01" }).sla).toBeNull();
  });

  it("escalates past the threshold, or high value and past SLA; overdue otherwise", () => {
    expect(claim({ status: "query", opened: "2026-08-20" }).level).toBe(2); // breached by 10, under 15
    expect(claim({ status: "query", opened: "2026-08-10" }).level).toBe(3); // breached by 20
    expect(claim({ status: "query", opened: "2026-08-27", claimed: 600_000 }).level).toBe(3); // high value, breached by 3
    expect(claim({ status: "query", opened: "2026-09-25", actionDue: "2026-09-27T12:30:00Z" }).level).toBe(2); // follow-up overdue
    expect(claim({ status: "query", opened: "2026-09-25", actionDue: "2026-09-29T12:30:00Z" }).level).toBe(1); // follow-up due today
  });

  it("derives pending with from the status — the CRM has no such field", () => {
    expect(claim({ status: "file_awaited", opened: TODAY }).pendingWith).toBe("client");
    expect(claim({ status: "add_info_awaited", opened: TODAY }).pendingWith).toBe("client");
    expect(claim({ status: "query", opened: TODAY }).pendingWith).toBe("team");
    expect(claim({ status: "file_received", opened: TODAY }).pendingWith).toBe("team");
    expect(claim({ status: "under_process", opened: TODAY }).pendingWith).toBe("insurer");
    expect(claim({ status: "settled_fully", opened: "2026-09-01", settledOn: TODAY }).pendingWith).toBeNull();
  });

  it("checks documents against the product's own checklist", () => {
    const motor = claim({ status: "file_awaited", opened: TODAY, policyType: "motor", docs: ["claim_form"] });
    expect(motor.docState).toBe("partial");
    expect(motor.docsMissing).toContain("Survey report");
    expect(motor.docsMissing).not.toContain("Discharge summary");
    expect(claim({ status: "file_awaited", opened: TODAY }).docState).toBe("none");
  });

  it("counts time in the current status from the audit trail", () => {
    const c = claim({ status: "file_awaited", opened: "2026-09-10", hist: { file_awaited: { f: "2026-09-12T06:00:00Z", l: "2026-09-12T06:00:00Z", n: 1 } } });
    expect(c.daysInStatus).toBe(17);
    expect(c.docsOverdue).toBe(true); // over the 7-day documents threshold
  });
});

describe("the figures", () => {
  const set = [
    claim({ status: "file_awaited", opened: "2026-09-25", claimed: 50_000 }),
    claim({ status: "empty", opened: "2026-09-26", claimed: 0 }),
    claim({ status: "under_process", opened: "2026-09-05", claimed: 200_000 }),
    claim({ status: "settled_fully", opened: "2026-09-01", settledOn: "2026-09-15", claimed: 100_000, settled: 100_000 }),
    claim({ status: "settled_partially", opened: "2026-08-20", settledOn: "2026-09-20", claimed: 100_000, settled: 80_000 }),
    claim({ status: "rejected", opened: "2026-08-01", closedOn: "2026-09-10", claimed: 300_000 }),
    claim({ status: "withdrawn", opened: "2026-09-02", closedOn: "2026-09-12", claimed: 40_000 }),
    claim({ status: "settled_fully", opened: "2026-07-01", settledOn: "2026-09-25", claimed: 90_000, settled: 90_000, mode: "grievance" }),
  ];

  it("splits open claims into pending and file-not-received, the claims summary's way", () => {
    const k = kpiStrip(set, w);
    expect(k.open.n).toBe(3);
    expect(k.fnr.n).toBe(2); // file awaited, and status not set
    expect(k.pending.n).toBe(1);
  });

  it("keeps outstanding to open claims — never claimed less settled", () => {
    expect(valueSummary(set, w).outstanding).toBe(250_000);
  });

  it("measures settlement against decided claims, leaving withdrawn out", () => {
    const s = settlement(set, w);
    expect(s.decidedN).toBe(4); // 3 settled + 1 rejected; the withdrawn claim is not a decision
    expect(s.countPct).toBeCloseTo(3 / 4);
    expect(s.amountPct).toBeCloseTo(270_000 / 290_000);
  });

  it("leaves grievance claims out of TAT", () => {
    const t = slaTat(set, w);
    expect(t.closedN).toBe(3); // two settled + one rejected; the grievance settlement is excluded
    expect(t.avgTat).toBeCloseTo((14 + 31 + 40) / 3);
  });

  it("orders the worklist SLA breached first, then high value, then oldest", () => {
    const list = worklist([
      claim({ status: "query", opened: "2026-09-20", claimed: 900_000 }),
      claim({ status: "query", opened: "2026-08-15" }),
      claim({ status: "query", opened: "2026-09-01" }),
    ], w, null);
    // breached (15 Aug) → high value (20 Sept, ₹9 L) → oldest of the rest (1 Sept)
    expect(list.map((c) => c.openedOn)).toEqual(["2026-08-15", "2026-09-20", "2026-09-01"]);
    expect(list.map((c) => c.sla)).toEqual(["breached", "within", "approaching"]);
  });

  it("knows whether a claim was open on a past day", () => {
    const c = claim({ status: "settled_fully", opened: "2026-09-01", settledOn: "2026-09-15", settled: 100_000 });
    expect(openAt(c, "2026-08-31")).toBe(false);
    expect(openAt(c, "2026-09-14")).toBe(true);
    expect(openAt(c, "2026-09-15")).toBe(false);
  });

  it("adds up the backlog: opening + new − closed = closing, every month", () => {
    for (const m of monthlyTrend(set, w)) {
      const f = m.lines.all;
      expect(f.opening + f.logged - f.closed).toBe(f.closing);
    }
  });

  it("shows status-based rows for today only in the weekly review", () => {
    const r = weeklyReview(set, w);
    const fnr = r.rows.find((x) => x.key === "fnr")!;
    expect(fnr.nowOnly).toBe(true);
    expect(fnr.values[0]).toBeNull();
  });
});
