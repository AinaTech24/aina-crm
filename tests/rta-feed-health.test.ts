/**
 * When a firm's registrar data stops updating, the owner is told — the two
 * silent failures of 15 Oct 2026 (Ahpal's reports no saved password opened;
 * We Care's mailbox empty since July).
 */
import { describe, expect, it } from "vitest";
import { decideFeedAlerts } from "@/lib/rta/feed-health";

const now = new Date("2026-10-15T06:30:00Z");
const on = { forwardingOn: true, lastMailAt: "2026-10-15T04:00:00Z" };

describe("decideFeedAlerts", () => {
  it("reports a registrar whose files keep arriving but cannot be opened", () => {
    const a = decideFeedAlerts([{ source: "kfintech", lastGood: "2026-10-08T05:00:00Z", lockedSince: 37, firstLockedAt: "2026-10-08T10:00:00Z" }], on, now);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "rta.feed_locked", source: "kfintech" });
    expect(a[0].body).toContain("37 KFintech reports");
    expect(a[0].body).toContain("8 Oct");
  });

  it("stays quiet while the registrar still imports, or for a stray foreign file", () => {
    expect(decideFeedAlerts([{ source: "cams", lastGood: "2026-10-14T05:00:00Z", lockedSince: 40, firstLockedAt: "2026-10-13T05:00:00Z" }], on, now)).toEqual([]);
    expect(decideFeedAlerts([{ source: "cams", lastGood: "2026-10-01T05:00:00Z", lockedSince: 1, firstLockedAt: "2026-10-02T05:00:00Z" }], on, now)).toEqual([]);
  });

  it("reports a mailbox that has received nothing for a week", () => {
    const a = decideFeedAlerts([], { forwardingOn: true, lastMailAt: "2026-07-11T06:16:00Z", address: "wecare@in.example" }, now);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("rta.no_mail");
    expect(a[0].body).toContain("11 Jul");
    expect(a[0].body).toContain("wecare@in.example");
  });

  it("does not report a mailbox the firm never switched on", () => {
    expect(decideFeedAlerts([], { forwardingOn: false, lastMailAt: "2026-07-11T06:16:00Z" }, now)).toEqual([]);
  });
});
