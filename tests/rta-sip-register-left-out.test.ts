import { describe, expect, it } from "vitest";
import { leftOutNote, notASipLabel } from "@/lib/rta/sip-left-out";

// A CAMS R49 SIP register (20 Nov 2026) read every one of its 15,484 rows, yet the
// import showed "partial · 6,620 skip". None of those were missing: 1,777 were STP /
// SWP / dividend-transfer registrations and 4,843 SIPs CAMS shows cancelled that
// were never in the book. They are now "left out on purpose", explained in one note
// (errors row 0), and only a row the CRM could not place counts as skipped.
describe("SIP register — rows left out on purpose", () => {
  it("names each kind of registration that is not a SIP", () => {
    expect(notASipLabel("SO", true)).toMatch(/^STPs/);
    expect(notASipLabel("R", false)).toMatch(/^SWPs/);
    expect(notASipLabel("DTP", true)).toBe("dividend transfer plans");
    expect(notASipLabel("P", true)).toMatch(/STP/);
    expect(notASipLabel("XYZ", false)).toBe('"XYZ" registrations (not a SIP)');
  });

  it("writes one note with the counts, largest first", () => {
    const m = new Map<string, number>([
      [notASipLabel("R", false), 37],
      ["SIPs the registrar shows cancelled (cease date) that were never in the CRM's book", 4843],
      [notASipLabel("SO", true), 1706],
    ]);
    const note = leftOutNote(m)!;
    expect(note).toMatch(/^6,586 rows left out on purpose — not missing data: 4,843 SIPs/);
    expect(note.indexOf("1,706 STPs")).toBeLessThan(note.indexOf("37 SWPs"));
  });

  it("says nothing when nothing was left out", () => {
    expect(leftOutNote(new Map())).toBeNull();
  });
});
