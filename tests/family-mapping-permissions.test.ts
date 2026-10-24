import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/rbac";
import { CAPABILITY_CATALOG, CAPABILITY_GROUP_ORDER } from "@/lib/auth/capability-catalog";
import { canMapFamilies, canMapFamily, mapScope, viewsAssignedFamiliesOnly } from "@/lib/families/access";
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

describe("assigned-only family mapping", () => {
  const me = "user-1";
  const mine = (roles: string[], permissions: string[]) => ({ roles, permissions, userId: me }) as unknown as SessionUser;

  it("is in the picker and no role has it by default", () => {
    for (const c of ["family.map.view_assigned", "family.map.edit_assigned"] as const) {
      expect(CAPABILITY_CATALOG[c]?.group, c).toBe("Family Mapping");
      for (const role of ["rm", "back_office", "ops", "branch_head", "compliance",]) {
        expect(can([role], c), `${role} ${c}`).toBe(false);
      }
    }
  });

  it("view: assigned-only applies when it is ticked INSTEAD of the all-families permission", () => {
    expect(viewsAssignedFamiliesOnly(mine(["rm"], ["investor.view.assigned", "family.map.view_assigned"]))).toBe(true);
    expect(viewsAssignedFamiliesOnly(mine(["rm"], ["family.map.view", "family.map.view_assigned"]))).toBe(false);
    expect(viewsAssignedFamiliesOnly(mine(["rm"], []))).toBe(false); // role defaults: unchanged
  });

  it("edit: assigned-only editors may act only on households they are the RM of", () => {
    const editor = mine(["rm"], ["family.map.view_assigned", "family.map.edit_assigned", "investor.edit.assigned", "family.edit"]);
    for (const a of ["create", "edit", "delete"] as const) {
      expect(mapScope(editor, a), a).toBe("assigned");
      expect(canMapFamily(editor, a, me), a).toBe(true);
      expect(canMapFamily(editor, a, "someone-else"), a).toBe(false);
      expect(canMapFamily(editor, a, null), a).toBe(false);
      expect(canMapFamilies(editor, a), a).toBe(false); // cannot start households anywhere
    }
  });

  it("edit: the all-families permission still wins, and role defaults are unchanged", () => {
    expect(mapScope(mine(["rm"], ["family.map.edit", "family.map.edit_assigned"]), "edit")).toBe("all");
    expect(mapScope(mine(["rm"], []), "delete")).toBe("all");
    expect(mapScope(mine(["compliance"], []), "edit")).toBeNull();
  });
});

