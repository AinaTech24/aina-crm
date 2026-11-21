import { inr, inrFull, initials, titleCase, timeAgo, toNumber, parseDate, fmtDate, fmtTime, monthLabel } from "../format";

describe("toNumber", () => {
  it("coerces numbers and numeric strings, else 0", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42.5")).toBe(42.5);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe("inr (Indian compact money)", () => {
  it("uses crore / lakh / grouped rupees", () => {
    expect(inr(12_500_000)).toBe("₹1.25Cr");
    expect(inr(10_000_000)).toBe("₹1Cr");
    expect(inr(340_000)).toBe("₹3.4L");
    expect(inr(45_000)).toBe("₹45,000");
    expect(inr(999)).toBe("₹999");
    expect(inr(0)).toBe("₹0");
  });
  it("keeps the sign on negatives", () => {
    expect(inr(-250_000)).toBe("-₹2.5L");
  });
  it("inrFull groups the Indian way", () => {
    expect(inrFull(1234567)).toBe("₹12,34,567");
  });
});

describe("initials", () => {
  it("takes first+last, or two letters of a single name", () => {
    expect(initials("Rajesh Kumar Demo")).toBe("RD");
    expect(initials("Pooja")).toBe("PO");
    expect(initials("  ")).toBe("?");
    expect(initials(null)).toBe("?");
    expect(initials("Rajesh Demo (Owner)")).toBe("RO");
    expect(initials("(Owner)")).toBe("OW");
    expect(initials("राजेश शाह")).toBe("रश");
    expect(initials("--- ...")).toBe("?");
  });
});

describe("titleCase", () => {
  it("turns enum values into labels", () => {
    expect(titleCase("in_progress")).toBe("In Progress");
    expect(titleCase("")).toBe("");
    expect(titleCase(undefined)).toBe("");
  });
});

describe("timeAgo", () => {
  it("buckets relative time", () => {
    const now = Date.now();
    expect(timeAgo(now - 10_000)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3_600_000)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86_400_000)).toBe("2d ago");
    expect(timeAgo("not a date")).toBe("");
  });
});

describe("parseDate / India-time formatting", () => {
  it("reads Postgres text timestamps the same as ISO", () => {
    const iso = parseDate("2026-11-20T03:30:00.000Z")!.getTime();
    expect(parseDate("2026-11-20 03:30:00+00")!.getTime()).toBe(iso);
    expect(parseDate("2026-11-20 09:00:00.123456+05:30")!.getTime()).toBe(iso + 123);
    expect(parseDate("2026-11-20 09:00:00+0530")!.getTime()).toBe(iso);
  });
  it("returns null for empty or bad input", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
  it("formats on the India calendar day and clock", () => {
    // 20:00 UTC is already the next morning in India.
    expect(fmtDate("2026-11-20 20:00:00+00")).toMatch(/21 Nov 2026/);
    expect(fmtDate("2026-11-20")).toMatch(/20 Nov 2026/);
    expect(fmtTime("2026-11-20 03:30:00+00").toLowerCase()).toMatch(/^9:00\s?am$/);
    expect(fmtDate(undefined)).toBe("");
  });
  it("labels a YYYY-MM month without a zone shift", () => {
    expect(monthLabel("2026-11")).toMatch(/November 2026/);
  });
});
