import { describe, expect, it } from "vitest";
import { addDays, laterPresets, reminderDay } from "@/lib/opportunities/later-core";

describe("opportunity Later — dates", () => {
  it("offers After Diwali (five days on) while it is still ahead", () => {
    const p = laterPresets("2026-10-07");
    expect(p[0]).toMatchObject({ key: "diwali", day: "2026-11-13" });
    // Past this year's Diwali, it is next year's.
    expect(laterPresets("2026-11-20").find((x) => x.key === "diwali")?.day).toBe("2027-11-03");
  });

  it("hides After Diwali when the calendar has no next year, never guessing", () => {
    expect(laterPresets("2028-12-01").some((x) => x.key === "diwali")).toBe(false);
  });

  it("moves months without spilling over the month end", () => {
    const p = laterPresets("2027-01-31");
    expect(p.find((x) => x.key === "1m")?.day).toBe("2027-02-28");
    expect(p.find((x) => x.key === "3m")?.day).toBe("2027-04-30");
  });

  it("puts the new financial year on the next 1 April", () => {
    expect(laterPresets("2026-10-07").find((x) => x.key === "fy")?.day).toBe("2027-04-01");
    expect(laterPresets("2027-02-10").find((x) => x.key === "fy")?.day).toBe("2027-04-01");
  });

  it("reminds a week ahead for MF, two weeks for insurance, never before today", () => {
    expect(reminderDay("2026-11-13", "mf", "2026-10-07")).toBe("2026-11-06");
    expect(reminderDay("2026-11-13", "insurance", "2026-10-07")).toBe("2026-10-29");
    expect(reminderDay("2026-10-10", "insurance", "2026-10-07")).toBe("2026-10-07");
  });

  it("adds days across months", () => {
    expect(addDays("2026-10-30", 5)).toBe("2026-11-04");
  });
});
