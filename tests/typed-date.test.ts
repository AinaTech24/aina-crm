/** Pins how the date fields read what people type — day-first, never US order. */

import { describe, expect, it } from "vitest";
import { formatDateLabel, formatTimeLabel, parseTypedDate, withinBounds } from "@/lib/dates/typed-date";

const now = new Date(2026, 8, 30); // 30 Sep 2026

describe("parseTypedDate", () => {
  it("reads every day-first spelling as the same day", () => {
    for (const t of ["30-09-2026", "30/09/2026", "30.09.2026", "30 09 2026", "30/9/26", "30092026", "30 Sep 2026", "30-Sept-2026", "30 September, 2026", "2026-09-30", " 30-9-2026 "]) {
      expect(parseTypedDate(t, now), t).toBe("2026-09-30");
    }
  });

  it("is day-first: 03/04/2026 is 3 April", () => {
    expect(parseTypedDate("03/04/2026", now)).toBe("2026-04-03");
  });

  it("returns empty for a cleared field and null for nonsense", () => {
    expect(parseTypedDate("   ", now)).toBe("");
    for (const t of ["31-02-2026", "13/13/2026", "hello", "2026", "30-09", "32 Jan 2026", "30 Foo 2026"]) {
      expect(parseTypedDate(t, now), t).toBeNull();
    }
  });

  it("puts two-digit years in this century up to ten years ahead", () => {
    expect(parseTypedDate("1/1/36", now)).toBe("2036-01-01");
    expect(parseTypedDate("1/1/37", now)).toBe("1937-01-01");
    expect(parseTypedDate("15/08/47", now)).toBe("1947-08-15");
  });
});

describe("labels and bounds", () => {
  it("shows the month in words", () => {
    expect(formatDateLabel("2026-09-30")).toBe("30 Sep 2026");
    expect(formatDateLabel("")).toBe("");
    expect(formatDateLabel("2026-02-31")).toBe("");
  });

  it("formats times on a 12-hour clock", () => {
    expect(formatTimeLabel("00:15")).toBe("12:15 am");
    expect(formatTimeLabel("09:30")).toBe("9:30 am");
    expect(formatTimeLabel("12:00")).toBe("12:00 pm");
    expect(formatTimeLabel("18:45")).toBe("6:45 pm");
  });

  it("checks inclusive bounds", () => {
    expect(withinBounds("2026-09-30", "2026-09-30", "2026-09-30")).toBe(true);
    expect(withinBounds("2026-09-29", "2026-09-30")).toBe(false);
    expect(withinBounds("2026-10-01", null, "2026-09-30")).toBe(false);
  });
});
