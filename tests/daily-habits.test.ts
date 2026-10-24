import { describe, expect, it } from "vitest";
import {
  dayCloseBody,
  dayCloseTitle,
  inDayCloseWindow,
  shouldPromptDayClose,
  type DayCloseCounts,
} from "@/lib/habits/day-close";
import { activityBody, channelForHref, contactLogAttrs, OUTCOMES } from "@/lib/activities/contact-log";
import { suggestFocusFromWorklist } from "@/lib/daily-tracker";

const quiet: DayCloseCounts = {
  done: 0, openToday: 0, touches: 0, focusTotal: 0, focusDone: 0, closedAlready: false, onLeave: false,
};

describe("close your day — when", () => {
  it("opens at 18:30 IST and closes at 20:00", () => {
    expect(inDayCloseWindow(18, 29)).toBe(false);
    expect(inDayCloseWindow(18, 30)).toBe(true);
    expect(inDayCloseWindow(19, 59)).toBe(true);
    expect(inDayCloseWindow(20, 0)).toBe(false);
    expect(inDayCloseWindow(8, 45)).toBe(false);
  });

  it("stays quiet for someone with no work today, on leave, or already closed", () => {
    expect(shouldPromptDayClose(quiet)).toBe(false);
    expect(shouldPromptDayClose({ ...quiet, done: 3, onLeave: true })).toBe(false);
    expect(shouldPromptDayClose({ ...quiet, done: 3, closedAlready: true })).toBe(false);
  });

  it("prompts anyone who had work, done or not", () => {
    expect(shouldPromptDayClose({ ...quiet, done: 1 })).toBe(true);
    expect(shouldPromptDayClose({ ...quiet, openToday: 2 })).toBe(true);
    expect(shouldPromptDayClose({ ...quiet, touches: 1 })).toBe(true);
    expect(shouldPromptDayClose({ ...quiet, focusTotal: 3 })).toBe(true);
  });
});

describe("close your day — what it says", () => {
  it("leads with what was done, then what is left", () => {
    const body = dayCloseBody({ ...quiet, done: 5, touches: 1, focusTotal: 3, focusDone: 2, openToday: 2 });
    expect(body).toBe(
      "5 tasks done · 1 client contact logged · 2 of 3 focus items ticked · 2 due today still open. " +
        "Two minutes: tick what's done, move the rest, note one win.",
    );
  });

  it("never prints a zero it has no reason to", () => {
    const body = dayCloseBody({ ...quiet, done: 1 });
    expect(body).toBe("1 task done. Two minutes: tick what's done and note one win.");
    expect(body).not.toMatch(/\b0\b/);
  });

  it("thanks people only when something was done", () => {
    expect(dayCloseTitle({ ...quiet, done: 2 })).toMatch(/Good work/);
    expect(dayCloseTitle({ ...quiet, openToday: 2 })).toBe("Close your day");
  });
});

describe("contact log prompt", () => {
  it("knows which launcher opened which channel", () => {
    expect(channelForHref("tel:+919800000000")).toBe("call");
    expect(channelForHref("https://wa.me/919800000000?text=Hi")).toBe("whatsapp");
    expect(channelForHref("sms:9800000000")).toBe("sms");
    expect(channelForHref("mailto:a@b.in")).toBe("email");
    expect(channelForHref("/dashboard/investors/1")).toBeNull();
    expect(channelForHref(null)).toBeNull();
  });

  it("adds no attributes without a subject", () => {
    expect(contactLogAttrs(null)).toEqual({});
    expect(contactLogAttrs({ type: "lead", id: "L1", name: "Asha" })).toEqual({
      "data-log-type": "lead", "data-log-id": "L1", "data-log-name": "Asha",
    });
  });

  it("logs a missed call as not reached, so it never moves the last-contact date", () => {
    const c = { type: "investor" as const, id: "11111111-1111-4111-8111-111111111111", name: "Ravi", channel: "call" as const };
    const noAnswer = OUTCOMES.call.find((o) => o.key === "no_answer")!;
    expect(activityBody(c, noAnswer)).toEqual({
      subjectType: "investor", subjectId: c.id, kind: "call", direction: "outbound", status: "no_answer",
    });
    // The API treats these as contact-failed (activities route, CONTACT_FAILED).
    expect(OUTCOMES.call.filter((o) => o.key !== "answered").map((o) => o.status)).toEqual(["no_answer", "busy"]);
  });
});

describe("plan your day — suggestions", () => {
  const item = (over: Partial<Parameters<typeof suggestFocusFromWorklist>[0][number]>) => ({
    action: "Call", client: null, clientId: null, leadId: null, taskId: null, bucket: "today", ...over,
  });

  it("takes the top three due or overdue, never tomorrow's", () => {
    const out = suggestFocusFromWorklist([
      item({ action: "Review", client: "Ravi Shah", clientId: "c1", bucket: "overdue", taskId: "t1" }),
      item({ action: "Tomorrow's call", bucket: "tomorrow" }),
      item({ action: "Follow up", client: "Asha", leadId: "l1" }),
      item({ action: "File SR" }),
      item({ action: "Fourth" }),
    ]);
    expect(out).toEqual([
      { text: "Review — Ravi Shah", taskId: "t1", forType: "client" },
      { text: "Follow up — Asha", forType: "lead" },
      { text: "File SR", forType: "other" },
    ]);
  });

  it("offers nothing when the worklist is clear", () => {
    expect(suggestFocusFromWorklist([])).toEqual([]);
  });
});
