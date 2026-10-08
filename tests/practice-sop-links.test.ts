/**
 * SOPs where the work happens (lib/practice/sop-links.ts) — the pure parts:
 * which targets a task reaches, how a link reads in words, and the
 * "<subjectType>:<stageKey>" key of a journey-stage link. No database.
 */

import { describe, expect, it } from "vitest";
import {
  blueprintStageFromMeta, blueprintStageKey, blueprintStageOptions, linkTargetLabel, parseBlueprintStageKey,
  taskTargets, taskTypeOptions, templateIdFromMeta,
} from "@/lib/practice/sop-links";
import { parseSopMarkdown } from "@/lib/practice/sop-markdown";

const TPL = "11111111-2222-4333-8444-555555555555";
const POS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("blueprint stage keys", () => {
  it("builds and parses <subjectType>:<stageKey>", () => {
    expect(blueprintStageKey("lead", "call_done")).toBe("lead:call_done");
    expect(parseBlueprintStageKey("lead:call_done")).toEqual({ subjectType: "lead", stageKey: "call_done" });
    expect(parseBlueprintStageKey("service_request:open")).toEqual({ subjectType: "service_request", stageKey: "open" });
  });

  it("rejects malformed keys and unknown journeys", () => {
    expect(parseBlueprintStageKey("call_done")).toBeNull();
    expect(parseBlueprintStageKey("lead:")).toBeNull();
    expect(parseBlueprintStageKey(":call_done")).toBeNull();
    expect(parseBlueprintStageKey("tenant:call_done")).toBeNull();
    expect(parseBlueprintStageKey("lead:Call Done")).toBeNull();
  });

  it("reads a stage from task meta in either shape", () => {
    expect(blueprintStageFromMeta({ blueprintSubject: "lead", stageKey: "call_done" })).toBe("lead:call_done");
    expect(blueprintStageFromMeta({ blueprintStage: "sip_rejection:contacted" })).toBe("sip_rejection:contacted");
    expect(blueprintStageFromMeta({ stageKey: "call_done" })).toBeNull();
    expect(blueprintStageFromMeta(null)).toBeNull();
    expect(blueprintStageFromMeta({ blueprintSubject: "nope", stageKey: "x" })).toBeNull();
  });

  it("offers every catalog stage once, as a valid key", () => {
    const opts = blueprintStageOptions();
    expect(opts.some((o) => o.key === "lead:call_done")).toBe(true);
    expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length);
    for (const o of opts) expect(parseBlueprintStageKey(o.key)).not.toBeNull();
  });
});

describe("taskTargets", () => {
  it("derives type, template, processes, positions, stage and SR type", () => {
    const t = taskTargets(
      { type: "kyc_renewal", meta: { templateId: TPL, blueprintSubject: "lead", stageKey: "call_done" } },
      { positionIds: [POS], srType: "bank_update" }
    );
    expect(t).toEqual([
      { kind: "task_type", key: "kyc_renewal" },
      { kind: "task_template", key: TPL },
      // kyc_renewal belongs to onboarding and KYC hygiene; bank_update to service requests
      { kind: "process", key: "onboarding" },
      { kind: "process", key: "service_requests" },
      { kind: "process", key: "kyc_compliance" },
      { kind: "position", key: POS },
      { kind: "blueprint_stage", key: "lead:call_done" },
      { kind: "sr_type", key: "bank_update" },
    ]);
  });

  it("prefers the stage the meta records over the subject's current stage", () => {
    const t = taskTargets({ type: "follow_up", meta: { blueprintStage: "lead:new" } }, { blueprintStage: "lead:call_done" });
    expect(t.filter((x) => x.kind === "blueprint_stage")).toEqual([{ kind: "blueprint_stage", key: "lead:new" }]);
    const u = taskTargets({ type: "follow_up", meta: {} }, { blueprintStage: "lead:call_done" });
    expect(u.filter((x) => x.kind === "blueprint_stage")).toEqual([{ kind: "blueprint_stage", key: "lead:call_done" }]);
  });

  it("a plain follow-up reaches only its type", () => {
    expect(taskTargets({ type: "follow_up", meta: null })).toEqual([{ kind: "task_type", key: "follow_up" }]);
  });

  it("ignores a templateId that is not a uuid", () => {
    expect(templateIdFromMeta({ templateId: "x" })).toBeNull();
    expect(taskTargets({ type: "follow_up", meta: { templateId: "x" } }).some((x) => x.kind === "task_template")).toBe(false);
  });

  it("never repeats a target", () => {
    const t = taskTargets({ type: "review_meeting", meta: {} }, { positionIds: [POS, POS] });
    expect(t.filter((x) => x.kind === "position")).toHaveLength(1);
  });
});

describe("linkTargetLabel", () => {
  const names = {
    positions: new Map([[POS, "Operations Executive"]]),
    templates: new Map([[TPL, "New client onboarding"]]),
    srTypes: new Map([["bank_update", "Bank Update"]]),
  };
  it("says each link in words", () => {
    expect(linkTargetLabel("process", "sip_rejection")).toBe("Process: SIP rejection recovery");
    expect(linkTargetLabel("task_type", "kyc_renewal")).toBe("Task type: KYC renewal");
    expect(linkTargetLabel("task_type", "nominee_update")).toBe("Task type: Nominee update");
    expect(linkTargetLabel("position", POS, names)).toBe("Position: Operations Executive");
    expect(linkTargetLabel("task_template", TPL, names)).toBe("Task template: New client onboarding");
    expect(linkTargetLabel("blueprint_stage", "lead:call_done")).toBe("Lead stage: Call Done");
    expect(linkTargetLabel("sr_type", "bank_update", names)).toBe("Service request: Bank Update");
    expect(linkTargetLabel("sr_type", "bank_update")).toBe("Service request: Bank Update");
  });
  it("never prints a raw uuid for a missing position or template", () => {
    expect(linkTargetLabel("position", POS)).toBe("Position: a removed position");
    expect(linkTargetLabel("task_template", TPL)).toBe("Task template: a deleted template");
  });
  it("humanises keys it does not know", () => {
    expect(linkTargetLabel("task_type", "pan_aadhaar_link")).toBe("Task type: Pan aadhaar link");
  });
  it("task type options are unique", () => {
    const keys = taskTypeOptions().map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("follow_up");
  });
});

describe("SOP markdown", () => {
  it("parses headings, lists and paragraphs", () => {
    const b = parseSopMarkdown("# Steps\n\n1. Call the client\n2. Log it\n\n- one\n- two\nPlain line\nmore");
    expect(b).toEqual([
      { t: "h", level: 1, text: "Steps" },
      { t: "ol", items: ["Call the client", "Log it"] },
      { t: "ul", items: ["one", "two"] },
      { t: "p", text: "Plain line more" },
    ]);
  });
});
