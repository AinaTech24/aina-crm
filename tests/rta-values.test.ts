/**
 * RTA Phase 2 — strict value readers (src/lib/rta/values.ts).
 *
 * Synthetic inputs only. These prove how the importer READS a value; they say
 * nothing about which notations real CAMS / KFintech files use.
 */
import { describe, expect, it } from "vitest";
import {
  readNumber,
  readDate,
  detectDateOrder,
  excelSerialToIso,
  validPan,
  maskPansInText,
} from "@/lib/rta/values";

const num = (s: string) => readNumber(s);

describe("readNumber — Indian and Western grouping", () => {
  it.each([
    ["1,23,456.78", 123456.78],
    ["12,34,56,789", 123456789],
    ["1,234,567.5", 1234567.5],
    ["999", 999],
    ["0.0001", 0.0001],
    ["1e-7", 1e-7],
    ["₹ 1,00,000", 100000],
    ["Rs. 2,500.50", 2500.5],
    ["-1,000.25", -1000.25],
    ["(1,000.00)", -1000],
    ["+42", 42],
    ["  7.5  ", 7.5],
  ])("%s → %s", (raw, value) => {
    expect(num(raw)).toEqual({ ok: true, value });
  });

  it("blank is null, not zero", () => {
    expect(num("")).toEqual({ ok: true, value: null });
    expect(num("   ")).toEqual({ ok: true, value: null });
    expect(readNumber(undefined)).toEqual({ ok: true, value: null });
  });

  it.each(["12,34", "1,23,4567", "1000-", "100 CR", "1.2.3", "abc", "--5", "(-5)", "1,000,00", "N/A"])(
    "%s is rejected with a reason, never stripped into a different value",
    (raw) => {
      const r = num(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain(raw.trim());
    }
  );

  it("the old bug: parseFloat read 1,23,456.78 as 1", () => {
    expect(parseFloat("1,23,456.78")).toBe(1);
    expect(num("1,23,456.78")).toEqual({ ok: true, value: 123456.78 });
  });
});

describe("readDate — calendar dates, never today", () => {
  it.each([
    ["2024-10-02", "2024-10-02"],
    ["2024-10-02T00:00:00Z", "2024-10-02"],
    ["20241002", "2024-10-02"],
    ["02/10/2024", "2024-10-02"],
    ["2-10-2024", "2024-10-02"],
    ["02.10.2024", "2024-10-02"],
    ["2/10/2024 12:00:00 AM", "2024-10-02"],
    ["02-Oct-2024", "2024-10-02"],
    ["2 October 2024", "2024-10-02"],
    ["29/02/2024", "2024-02-29"],
  ])("%s → %s (day-first)", (raw, iso) => {
    expect(readDate(raw, "dmy")).toEqual({ ok: true, value: iso });
  });

  it("month-first when the file says so", () => {
    expect(readDate("10/02/2024", "mdy")).toEqual({ ok: true, value: "2024-10-02" });
  });

  it("blank is null (the caller rejects a mandatory date; it is never today)", () => {
    expect(readDate("", "dmy")).toEqual({ ok: true, value: null });
  });

  it.each([
    ["31/02/2024", "real calendar date"],
    ["29/02/2023", "real calendar date"],
    ["15-OCT-24", "two-digit year"],
    ["45567", "bare number"],
    ["n/a", "not a date"],
    ["13/13/2024", "date order"],
    ["01/01/1850", "real calendar date"],
  ])("%s is rejected (%s)", (raw, why) => {
    const r = readDate(raw, "dmy");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });

  it("a month-first value in a day-first file is an error, not silently swapped", () => {
    const r = readDate("03/15/2026", "dmy");
    expect(r.ok).toBe(false);
  });
});

describe("detectDateOrder", () => {
  it("day-first default, month-first when a second part > 12 appears", () => {
    expect(detectDateOrder(["01/02/2024", "03/04/2024"])).toBe("dmy");
    expect(detectDateOrder(["01/02/2024", "03/15/2024"])).toBe("mdy");
    expect(detectDateOrder(["15/03/2024"])).toBe("dmy");
  });
  it("a column written both ways is a conflict", () => {
    expect(detectDateOrder(["15/03/2024", "03/15/2024"])).toBe("conflict");
  });
});

describe("excelSerialToIso — pure arithmetic, timezone-proof", () => {
  const zones = ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Kiritimati"];
  it.each(zones)("2 Oct 2024 (serial 45567) under TZ=%s", (tz) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      expect(excelSerialToIso(45567)).toBe("2024-10-02");
      expect(excelSerialToIso(45747)).toBe("2025-03-31");
      expect(excelSerialToIso(36526)).toBe("2000-01-01");
    } finally {
      process.env.TZ = prev;
    }
  });
  it("1904 date system and the fictitious 1900 range", () => {
    expect(excelSerialToIso(0, true)).toBe("1904-01-01");
    expect(excelSerialToIso(59)).toBeNull();
  });
});

describe("validPan", () => {
  it("accepts a well-formed PAN with a valid holder-type letter", () => {
    expect(validPan(" abcpe1234f ")).toBe("ABCPE1234F");
    expect(validPan("AAACX1234Z")).toBe("AAACX1234Z");
  });
  it.each(["", "NA", "PANEXEMPT", "XXXXXXXXXX", "ABCDE1234F", "ABCPE12345", "ABCPE1234", "MINOR:ABCPE1234F"])(
    "%s is not a PAN (placeholder text never becomes a matching key)",
    (raw) => expect(validPan(raw)).toBeNull()
  );
});

describe("maskPansInText", () => {
  it("masks every PAN-shaped token", () => {
    expect(maskPansInText("PAN ABCPE1234F not in client master; guardian zzzpz9999z")).toBe(
      "PAN ABC••••4F not in client master; guardian zzz••••9z"
    );
  });
});
