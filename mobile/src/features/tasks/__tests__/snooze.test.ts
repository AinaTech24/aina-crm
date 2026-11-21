import { snoozeTarget } from "../snooze";

// "Now" = 21 Nov 2026, 15:00 IST (09:30 UTC).
const NOW = Date.parse("2026-11-21T09:30:00Z");

describe("snoozeTarget — swipe snooze to tomorrow (India)", () => {
  it("an overdue task moves to tomorrow at its own time of day", () => {
    // due 18 Nov 11:30 IST → 22 Nov 11:30 IST
    expect(snoozeTarget("2026-11-18T06:00:00Z", NOW)).toBe("2026-11-22T06:00:00.000Z");
  });
  it("a task due later today moves to tomorrow, same time", () => {
    // due 21 Nov 18:00 IST → 22 Nov 18:00 IST
    expect(snoozeTarget("2026-11-21T12:30:00Z", NOW)).toBe("2026-11-22T12:30:00.000Z");
  });
  it("a task due just after IST midnight keeps the IST day boundary right", () => {
    // due 21 Nov 00:30 IST (20 Nov 19:00 UTC) → 22 Nov 00:30 IST
    expect(snoozeTarget("2026-11-20T19:00:00Z", NOW)).toBe("2026-11-21T19:00:00.000Z");
  });
  it("a task already due after tomorrow moves one more day", () => {
    // due 25 Nov 10:00 IST → 26 Nov 10:00 IST
    expect(snoozeTarget("2026-11-25T04:30:00Z", NOW)).toBe("2026-11-26T04:30:00.000Z");
  });
  it("a task with no due date → tomorrow 10:00 IST", () => {
    expect(snoozeTarget(null, NOW)).toBe("2026-11-22T04:30:00.000Z");
  });
  it("late at night IST (after 18:30 UTC) 'tomorrow' is the next India day", () => {
    // now = 21 Nov 23:45 IST (18:15 UTC); task overdue → 22 Nov 10:00 IST
    const late = Date.parse("2026-11-21T18:15:00Z");
    expect(snoozeTarget(null, late)).toBe("2026-11-22T04:30:00.000Z");
    // now = 22 Nov 00:15 IST (21 Nov 18:45 UTC) → 23 Nov 10:00 IST
    const afterMidnight = Date.parse("2026-11-21T18:45:00Z");
    expect(snoozeTarget(null, afterMidnight)).toBe("2026-11-23T04:30:00.000Z");
  });
});
