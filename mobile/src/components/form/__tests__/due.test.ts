/**
 * Due / follow-up chips and their India-time conversion (components/form/due).
 * The firm works on IST whatever zone the phone is in.
 */
import { addDays, chipSelected, dueChips, dueFromIso, istParts, istToIso, joinDue, splitDue, timeLabel } from "../due";

// 21 Nov 2026, 15:00 IST = 09:30 UTC.
const at = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000;
const afternoon = at(2026, 11, 21, 15, 0);

describe("India time", () => {
  it("reads the India day and time, not the phone's", () => {
    expect(istParts(afternoon)).toEqual({ day: "2026-11-21", minutes: 15 * 60 });
    // 00:30 IST on the 22nd is still the 21st in UTC.
    expect(istParts(at(2026, 11, 22, 0, 30)).day).toBe("2026-11-22");
  });
  it("moves days across months and years", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 7)).toBe("2027-01-07");
  });
});

describe("quick chips", () => {
  it("offers Today 5 pm and Tomorrow 10 am in India time", () => {
    expect(dueChips(afternoon).map((c) => [c.label, c.value])).toEqual([
      ["Today 5 pm", "2026-11-21T17:00"],
      ["Tomorrow 10 am", "2026-11-22T10:00"],
    ]);
  });
  it("drops Today 5 pm once it has passed", () => {
    expect(dueChips(at(2026, 11, 21, 17, 0)).map((c) => c.label)).toEqual(["Tomorrow 10 am"]);
  });
  it("uses India's day just after midnight IST", () => {
    expect(dueChips(at(2026, 11, 22, 0, 30))[0].value).toBe("2026-11-22T17:00");
  });
  it("adds a form's own day chips after the two", () => {
    const chips = dueChips(afternoon, [{ label: "3 days", days: 3 }, { label: "1 week", days: 7 }]);
    expect(chips.slice(2).map((c) => c.value)).toEqual(["2026-11-24", "2026-11-28"]);
  });
  it("marks the chip a value came from", () => {
    const [today, , three] = dueChips(afternoon, [{ label: "3 days", days: 3 }]);
    expect(chipSelected(today, "2026-11-21T17:00")).toBe(true);
    expect(chipSelected(today, "2026-11-21T18:00")).toBe(false);
    expect(chipSelected(three, "2026-11-24T15:00", true)).toBe(true);
    expect(chipSelected(three, "2026-11-24T15:00")).toBe(false);
    expect(chipSelected(three, "")).toBe(false);
  });
});

describe("sending a due value", () => {
  it("reads a chip's time as India time", () => {
    expect(istToIso("2026-11-21T17:00")).toBe("2026-11-21T11:30:00.000Z");
    expect(istToIso("2026-11-22T10:00")).toBe("2026-11-22T04:30:00.000Z");
  });
  it("sends a bare day at the form's default India time", () => {
    expect(istToIso("2026-11-21")).toBe("2026-11-21T04:30:00.000Z");
    expect(istToIso("2026-11-21", "09:00")).toBe("2026-11-21T03:30:00.000Z");
  });
  it("sends nothing for an empty value", () => {
    expect(istToIso("")).toBeUndefined();
    expect(istToIso(undefined)).toBeUndefined();
  });
});

describe("reading a stored due back", () => {
  it("shows a 10:00 follow-up as the plain day it was picked as", () => {
    expect(dueFromIso("2026-11-20T04:30:00.000Z", "10:00")).toBe("2026-11-20");
  });
  it("keeps any other time, on India's day", () => {
    expect(dueFromIso("2026-11-20T11:30:00.000Z", "10:00")).toBe("2026-11-20T17:00");
    expect(dueFromIso("2026-11-20T18:30:00.000Z")).toBe("2026-11-21T00:00");
  });
  it("round-trips through istToIso", () => {
    const iso = "2026-11-20T11:30:00.000Z";
    expect(istToIso(dueFromIso(iso, "10:00"))).toBe(iso);
  });
  it("splits and joins values", () => {
    expect(splitDue("2026-11-21T17:00")).toEqual({ day: "2026-11-21", time: "17:00" });
    expect(splitDue("2026-11-21")).toEqual({ day: "2026-11-21", time: "" });
    expect(splitDue("")).toEqual({ day: "", time: "" });
    expect(joinDue("2026-11-21", "17:00")).toBe("2026-11-21T17:00");
    expect(joinDue("", "17:00")).toBe("");
  });
  it("labels times the Indian way", () => {
    expect(timeLabel("17:00")).toBe("5:00 pm");
    expect(timeLabel("00:15")).toBe("12:15 am");
    expect(timeLabel("12:00")).toBe("12:00 pm");
  });
});
