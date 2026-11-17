import { describe, expect, it } from "vitest";
import { ageFromDob, relationToHolder, roleLabel } from "@/lib/insurance/family-panel";
import type { FamilyLite, FamilyMemberLite } from "@/lib/families/lookup";

const m = (id: string, name: string, role: string | null, head = false): FamilyMemberLite =>
  ({ id, name, dob: null, gender: null, familyRole: role, isMinor: false, isHead: head });
const family: FamilyLite = {
  id: "f", name: "Patel Family", code: null,
  members: [m("1", "Ramesh", "self", true), m("2", "Sita", "spouse"), m("3", "Raj", "son")],
};

describe("family panel rules", () => {
  it("works out age from a date of birth", () => {
    const today = new Date(2026, 10, 17); // 17 Nov 2026
    expect(ageFromDob("1980-11-17", today)).toBe("46");
    expect(ageFromDob("1980-11-18", today)).toBe("45");
    expect(ageFromDob("2026-12-01", today)).toBe("");
    expect(ageFromDob(null, today)).toBe("");
  });
  it("reads a role the way a person would", () => {
    expect(roleLabel("daughter_in_law")).toBe("Daughter in law");
    expect(roleLabel(null)).toBe("");
  });
  it("gives the relation to the policyholder only when the mapping can say it", () => {
    expect(relationToHolder(family.members[0], "1", family)).toBe("Self");
    expect(relationToHolder(family.members[1], "1", family)).toBe("Spouse");
    expect(relationToHolder(family.members[2], "1", family)).toBe("Son");
    // a non-head holder: relations are stored against the head, so leave it for the person to type
    expect(relationToHolder(family.members[2], "2", family)).toBe("");
    expect(relationToHolder(family.members[1], "2", family)).toBe("Self");
  });
});
