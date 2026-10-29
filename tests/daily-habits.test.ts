import { describe, expect, it } from "vitest";
import { activityBody, channelForHref, contactLogAttrs, OUTCOMES } from "@/lib/activities/contact-log";
import { suggestFocusFromWorklist } from "@/lib/daily-tracker";

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
