import { describe, expect, it } from "vitest";
import { linkDocumentsProcess, nextStep, pillarsMet, scoreProcesses, type PillarState, type SystemsMapRow } from "@/lib/practice/map";
import { formatMeasure, median, pct } from "@/lib/practice/measures";
import { PROCESS_BY_KEY, PRACTICE_PROCESSES } from "@/lib/practice/catalog";

const all = (v: boolean): PillarState => ({ documented: v, owned: v, measured: v, automated: v });

type StepRow = Pick<SystemsMapRow, "key" | "pillars" | "owner" | "recipes" | "measureKey">;
const row = (over: Partial<StepRow> = {}): StepRow => ({
  key: "sip_rejection",
  pillars: all(false),
  owner: null,
  recipes: [
    { key: "sip_rejection_followup", name: "SIP rejection follow-up", workflowId: null, enabled: false, published: false },
    { key: "mandate_failure_smart_retry", name: "Mandate retry", workflowId: null, enabled: false, published: false },
  ],
  measureKey: "sip_rejection_recovery",
  ...over,
});

describe("practice systems map — score", () => {
  it("scores pillars met over four per process, as a whole percentage", () => {
    expect(scoreProcesses([{ pillars: all(true) }, { pillars: all(false) }])).toEqual({ met: 4, total: 8, pct: 50 });
    const three = { pillars: { documented: true, owned: true, measured: true, automated: false } };
    // 3 of 12 pillars = 25%; 5 of 12 = 41.67 → 42.
    expect(scoreProcesses([three, { pillars: all(false) }, { pillars: all(false) }]).pct).toBe(25);
    expect(scoreProcesses([three, { pillars: { ...all(false), owned: true, measured: true } }, { pillars: all(false) }]).pct).toBe(42);
  });

  it("is 0% with no processes rather than dividing by zero", () => {
    expect(scoreProcesses([])).toEqual({ met: 0, total: 0, pct: 0 });
  });

  it("counts a process's own pillars", () => {
    expect(pillarsMet({ pillars: { ...all(false), measured: true, automated: true } })).toBe(2);
  });
});

describe("practice systems map — next step", () => {
  it("starts with documenting, pointing at a new SOP", () => {
    expect(nextStep(row())).toMatchObject({ pillar: "documented", href: "/dashboard/sops/new" });
  });

  it("asks for an owner position, or a holder for the chosen one", () => {
    const documented = { ...all(false), documented: true };
    expect(nextStep(row({ pillars: documented }))).toMatchObject({ pillar: "owned", href: "/dashboard/practice/positions" });
    const step = nextStep(row({ pillars: documented, owner: { positionId: "p1", title: "Operations Executive", holders: [] } }));
    expect(step?.pillar).toBe("owned");
    expect(step?.text).toContain("Operations Executive");
  });

  it("says where the measure's data comes from", () => {
    const step = nextStep(row({ pillars: { ...all(true), measured: false, automated: false } }));
    expect(step).toMatchObject({ pillar: "measured", href: "/dashboard/rta-imports" });
  });

  it("prefers turning on an installed automation over setting up a new one", () => {
    const pillars = { ...all(true), automated: false };
    expect(nextStep(row({ pillars }))).toMatchObject({
      text: 'Install the "SIP rejection follow-up" automation',
      href: "/dashboard/practice#process-sip_rejection-more",
    });
    const installed = row({
      pillars,
      recipes: [
        { key: "sip_rejection_followup", name: "SIP rejection follow-up", workflowId: null, enabled: false, published: false },
        { key: "mandate_failure_smart_retry", name: "Mandate retry", workflowId: "wf-1", enabled: false, published: false },
      ],
    });
    expect(nextStep(installed)).toMatchObject({ pillar: "automated", text: 'Turn on the "Mandate retry" automation' });
  });

  it("has no next step for a fully systemised process", () => {
    expect(nextStep(row({ pillars: all(true) }))).toBeNull();
  });
});

describe("practice systems map — what documents a process", () => {
  const sr = PROCESS_BY_KEY.get("service_requests")!;
  const onboarding = PROCESS_BY_KEY.get("onboarding")!;

  it("takes a link to the process itself, and only that process", () => {
    expect(linkDocumentsProcess(sr, { targetKind: "process", targetKey: "service_requests" })).toBe(true);
    expect(linkDocumentsProcess(sr, { targetKind: "process", targetKey: "complaints" })).toBe(false);
  });

  it("takes the process's task types, request types and journey stages", () => {
    expect(linkDocumentsProcess(onboarding, { targetKind: "task_type", targetKey: "collect_document" })).toBe(true);
    expect(linkDocumentsProcess(onboarding, { targetKind: "task_type", targetKey: "review_meeting" })).toBe(false);
    expect(linkDocumentsProcess(sr, { targetKind: "sr_type", targetKey: "bank_update" })).toBe(true);
    expect(linkDocumentsProcess(sr, { targetKind: "blueprint_stage", targetKey: "service_request:assigned" })).toBe(true);
    expect(linkDocumentsProcess(sr, { targetKind: "blueprint_stage", targetKey: "lead:call_done" })).toBe(false);
    // A process with no journey blueprint takes no stage link.
    expect(linkDocumentsProcess(onboarding, { targetKind: "blueprint_stage", targetKey: "lead:won_lead" })).toBe(false);
  });

  it("ignores links that are about positions or task templates", () => {
    expect(linkDocumentsProcess(sr, { targetKind: "position", targetKey: "service_requests" })).toBe(false);
  });
});

describe("practice measures — pure helpers", () => {
  it("never prints a zero for a measure with no data", () => {
    expect(formatMeasure({ value: null, unit: "%", hasData: false })).toBe("—");
    expect(formatMeasure({ value: 0, unit: "%", hasData: false })).toBe("—");
    expect(formatMeasure({ value: 0, unit: "%", hasData: true })).toBe("0%");
  });

  it("formats percentages and days", () => {
    expect(formatMeasure({ value: 42.5, unit: "%", hasData: true })).toBe("42.5%");
    expect(formatMeasure({ value: 1, unit: "days", hasData: true })).toBe("1 day");
    expect(formatMeasure({ value: 6.5, unit: "days", hasData: true })).toBe("6.5 days");
    expect(formatMeasure({ value: 1200, unit: "count", hasData: true })).toBe("1,200");
  });

  it("takes medians and shares without a denominator trap", () => {
    expect(median([])).toBeNull();
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
  });

  it("every process has a measure source to point at", async () => {
    const { MEASURE_SOURCE } = await import("@/lib/practice/map");
    for (const p of PRACTICE_PROCESSES) expect(MEASURE_SOURCE[p.measure]?.href).toMatch(/^\/dashboard\//);
  });
});
