import { describe, expect, it } from "vitest";
import { generatePassword, passwordProblem } from "@/lib/auth/password-gen";

describe("admin-set passwords", () => {
  it("are 14 characters, mixed, with no look-alikes, and never repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(14);
      expect(passwordProblem(p)).toBeNull();
      expect(p).not.toMatch(/[0O1lI]/);
      seen.add(p);
    }
    expect(seen.size).toBe(500);
  });
  it("typed ones must be at least 10 characters with upper, lower and a digit", () => {
    expect(passwordProblem("short1A")).toMatch(/10 characters/);
    expect(passwordProblem("alllowercase123")).toMatch(/Mix/);
    expect(passwordProblem("GoodEnough2026")).toBeNull();
  });
});
