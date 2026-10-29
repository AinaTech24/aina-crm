import { describe, expect, it } from "vitest";
import { demiseDateError } from "@/lib/investors/demise";

describe("date of demise", () => {
  const today = "2026-10-19";
  it("accepts a past date and today", () => {
    expect(demiseDateError("2026-09-30", null, today)).toBeNull();
    expect(demiseDateError("2026-10-19", "1950-01-01", today)).toBeNull();
  });
  it("refuses a future date, a bad date, and one before birth", () => {
    expect(demiseDateError("2026-10-20", null, today)).toMatch(/future/);
    expect(demiseDateError("not-a-date", null, today)).toMatch(/valid date/);
    expect(demiseDateError("1949-12-31", "1950-01-01", today)).toMatch(/before the date of birth/);
  });
});
