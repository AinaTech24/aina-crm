/** The Log activity body must pass POST /api/activities (zod Body). */
import { activityForm } from "../../forms/activities";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const base = (over: Record<string, unknown> = {}) => ({ ...(activityForm.initial as (p: Record<string, string>) => Record<string, unknown>)({}), investorId: "00000000-0000-4000-8000-000000000001", ...over });

describe("activity form", () => {
  it("logs today's entry at the moment it is saved, never in the future", () => {
    const before = Date.now();
    const body = activityForm.buildBody(base({ occurredDay: today() }), {});
    const at = Date.parse(body.occurredAt);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });
  it("logs an earlier day at noon IST and a follow-up at 10:00 IST", () => {
    const body = activityForm.buildBody(base({ occurredDay: "2026-01-05", nextFollowupDay: "2026-12-01" }), {});
    expect(body.occurredAt).toBe("2026-01-05T06:30:00.000Z");
    expect(body.nextFollowupAt).toBe("2026-12-01T04:30:00.000Z");
  });
  it("keeps a call's duration inside what the API accepts", () => {
    expect(activityForm.validate!(base({ durationMin: "9000" }))?.durationMin).toBeTruthy();
    expect(activityForm.validate!(base({ durationMin: "12" }))).toBeNull();
    expect(activityForm.buildBody(base({ durationMin: "12" }), {}).durationSec).toBe(720);
  });
});
