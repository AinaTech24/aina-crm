/** The bulk bar said "Delete 2 entrys?" (and would say "familys") — 2026-11-24. */
import { describe, expect, it } from "vitest";
import { plural } from "@/lib/plural";

describe("plural", () => {
  it("keeps the singular for one", () => expect(plural("entry", 1)).toBe("entry"));
  it("turns a consonant + y into ies", () => {
    expect(plural("entry", 2)).toBe("entries");
    expect(plural("family", 3)).toBe("families");
    expect(plural("policy", 0)).toBe("policies");
  });
  it("just adds s otherwise", () => {
    expect(plural("lead", 2)).toBe("leads");
    expect(plural("SOP", 2)).toBe("SOPs");
    expect(plural("survey", 2)).toBe("surveys");
    expect(plural("financial health check", 5)).toBe("financial health checks");
  });
});
