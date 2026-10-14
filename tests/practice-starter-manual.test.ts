/**
 * The starter operations manual (lib/practice/starter-manual.ts) — pure checks:
 * unique keys, every SOP / script has its headings, every link points at a
 * real target, and the wording stays a distributor's.
 */

import { describe, expect, it } from "vitest";
import {
  SCRIPT_HEADINGS, SOP_HEADINGS, STARTER_CATEGORIES, STARTER_MANUAL, STARTER_SCRIPTS, STARTER_SOPS,
} from "@/lib/practice/starter-manual";
import { starterRequiredRoles } from "@/lib/practice/install-starter-manual";
import { DEFAULT_POSITIONS, PRACTICE_PROCESSES } from "@/lib/practice/catalog";
import { LEAD_TO_CLIENT_STAGES } from "@/lib/blueprints/lead_to_client";
import { serviceRequests } from "@/db/schema/service_requests";
import { SOP_LINK_KINDS } from "@/db/schema/practice";
import { ASSIGNABLE_ROLES } from "@/lib/auth/rbac";

const TASK_TYPES = ["follow_up", "review_meeting", "collect_document", "kyc_renewal", "custom"];
const PROCESS_KEYS = new Set(PRACTICE_PROCESSES.map((p) => p.key));
const POSITION_KEYS = new Set(DEFAULT_POSITIONS.map((p) => p.key));
const STAGE_KEYS = new Set(LEAD_TO_CLIENT_STAGES.map((s) => `lead:${s.key}`));
const SR_TYPES = new Set<string>(serviceRequests.type.enumValues);
const FORBIDDEN = ["advise", "advice", "guaranteed returns", "assured returns"];

function headingsOf(md: string): string[] {
  return md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
}

describe("starter operations manual", () => {
  it("has 25–30 SOPs and a script per main lead stage", () => {
    expect(STARTER_SOPS.length).toBeGreaterThanOrEqual(25);
    expect(STARTER_SOPS.length).toBeLessThanOrEqual(30);
    const scripted = new Set(STARTER_SCRIPTS.flatMap((s) => s.appliesTo.filter((l) => l.kind === "blueprint_stage").map((l) => l.key)));
    for (const st of ["new", "call_done", "call_back_later", "call_not_connected", "meeting_scheduled", "meeting_done", "proposal_sent", "documents_pending"]) {
      expect(scripted.has(`lead:${st}`), st).toBe(true);
    }
  });

  it("uses unique keys the SOP API would accept", () => {
    const keys = STARTER_MANUAL.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9_]{2,80}$/);
    const titles = STARTER_MANUAL.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives every SOP its headings in order, with content under each", () => {
    for (const s of STARTER_MANUAL) {
      expect(s.markdown.trim().length, s.key).toBeGreaterThan(200);
      const expected = s.category === "Scripts" ? SCRIPT_HEADINGS : SOP_HEADINGS;
      expect(headingsOf(s.markdown), s.key).toEqual([...expected]);
      // No heading is immediately followed by another heading or the end.
      const lines = s.markdown.split("\n").filter((l) => l.trim());
      lines.forEach((l, i) => {
        if (l.startsWith("## ")) expect(lines[i + 1]?.startsWith("## ") ?? true, `${s.key}: ${l}`).toBe(false);
      });
    }
  });

  it("puts scripts only in Scripts and every SOP in a known category", () => {
    for (const s of STARTER_MANUAL) expect(STARTER_CATEGORIES).toContain(s.category);
    for (const s of STARTER_SCRIPTS) expect(s.category).toBe("Scripts");
    for (const s of STARTER_SOPS) expect(s.category).not.toBe("Scripts");
  });

  it("links only to targets that exist", () => {
    for (const s of STARTER_MANUAL) {
      expect(s.appliesTo.length, s.key).toBeGreaterThan(0);
      for (const l of s.appliesTo) {
        expect(SOP_LINK_KINDS, s.key).toContain(l.kind);
        const ok =
          l.kind === "process" ? PROCESS_KEYS.has(l.key)
          : l.kind === "position" ? POSITION_KEYS.has(l.key)
          : l.kind === "blueprint_stage" ? STAGE_KEYS.has(l.key)
          : l.kind === "sr_type" ? SR_TYPES.has(l.key)
          : l.kind === "task_type" ? TASK_TYPES.includes(l.key)
          : false;
        expect(ok, `${s.key} → ${l.kind}:${l.key}`).toBe(true);
      }
    }
  });

  it("documents every core process", () => {
    const covered = new Set(STARTER_SOPS.flatMap((s) => s.appliesTo.filter((l) => l.kind === "process").map((l) => l.key)));
    for (const p of PRACTICE_PROCESSES) expect(covered.has(p.key), p.key).toBe(true);
  });

  it("asks only assignable roles to sign off", () => {
    for (const s of STARTER_MANUAL) {
      for (const r of starterRequiredRoles(s)) expect(ASSIGNABLE_ROLES as string[], `${s.key}: ${r}`).toContain(r);
    }
  });

  it("never uses language a distributor may not use", () => {
    for (const s of STARTER_MANUAL) {
      const text = `${s.title}\n${s.markdown}`.toLowerCase();
      for (const w of FORBIDDEN) expect(text.includes(w), `${s.key} contains "${w}"`).toBe(false);
    }
  });
});
