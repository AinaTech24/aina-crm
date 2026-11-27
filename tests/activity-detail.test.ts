/** The facts the Activity Log popup shows for one entry (2026-11-27). */
import { describe, expect, it } from "vitest";
import { activityFacts, durationText } from "@/lib/activities/detail";

describe("activity popup facts", () => {
  it("shows every fact the entry has, in India time", () => {
    expect(
      activityFacts({
        occurred_at: "2026-11-17T05:00:00Z",
        created_at: "2026-11-17T06:30:00Z",
        direction: "outbound",
        status: "no_answer",
        duration_sec: 125,
        location_label: "Client office",
        geo_lat: "23.022500",
        geo_lng: "72.571400",
        next_followup_at: "2026-11-20T04:30:00Z",
        owner_name: "Asha Shah",
      }),
    ).toEqual([
      ["When", "17 Nov 2026, 10:30 AM"],
      ["Direction", "Outbound"],
      ["Outcome", "No answer"],
      ["Duration", "2 min 5 sec"],
      ["Location", "Client office"],
      ["Coordinates", "23.0225, 72.5714"],
      ["Next follow-up", "20 Nov 2026, 10:00 AM"],
      ["Logged by", "Asha Shah"],
      ["Logged on", "17 Nov 2026, 12:00 PM"],
    ]);
  });

  it("leaves out what was not recorded", () => {
    expect(
      activityFacts({ occurred_at: "2026-11-25T05:00:00Z", created_at: "2026-11-25T05:00:00Z", duration_sec: 0 }),
    ).toEqual([
      ["When", "25 Nov 2026, 10:30 AM"],
      ["Logged by", "—"],
    ]);
  });

  it("writes a duration in minutes and seconds", () => {
    expect(durationText(45)).toBe("45 sec");
    expect(durationText(600)).toBe("10 min");
  });
});
