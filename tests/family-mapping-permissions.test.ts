import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/rbac";
import { CAPABILITY_CATALOG, CAPABILITY_GROUP_ORDER } from "@/lib/auth/capability-catalog";
import { canMapFamilies } from "@/lib/families/access";
import type { SessionUser } from "@/lib/auth/session";

const MAP_CAPS = ["family.map.view", "family.map.create", "family.map.edit", "family.map.delete"] as const;
const session = (roles: string[], permissions: string[] = []) => ({ roles, permissions }) as unknown as SessionUser;

describe("family mapping permissions", () => {
  it("is its own group in the picker, with all four permissions labelled", () => {
    expect(CAPABILITY_GROUP_ORDER).toContain("Family Mapping");
    for (const c of MAP_CAPS) {
      expect(CAPABILITY_CATALOG[c].group).toBe("Family Mapping");
      expect(CAPABILITY_CATALOG[c].label.length).toBeGreaterThan(3);
    }
  });

  it("keeps today's behaviour by default: whoever could map before still can", () => {
    for (const role of ["rm", "back_office", "ops", "branch_head"]) {
      for (const a of ["create", "edit", "delete"] as const) expect(canMapFamilies(session([role]), a), `${role} ${a}`).toBe(true);
      expect(can([role], "family.map.view")).toBe(true);
    }
    expect(canMapFamilies(session(["compliance"]), "create")).toBe(false);
  });

  it("grants exactly what is ticked once a custom list is set", () => {
    const onlyAdd = session(["rm"], ["investor.view.assigned", "family.map.view", "family.map.create"]);
    expect(canMapFamilies(onlyAdd, "create")).toBe(true);
    expect(canMapFamilies(onlyAdd, "edit")).toBe(false);
    expect(canMapFamilies(onlyAdd, "delete")).toBe(false);
  });

  it("an existing household-edit grant still maps, so nobody loses access", () => {
    const legacy = session(["rm"], ["family.view", "family.edit"]);
    for (const a of ["create", "edit", "delete"] as const) expect(canMapFamilies(legacy, a)).toBe(true);
  });
});
