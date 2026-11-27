/**
 * Where every rupee of a SIP register went (2026-11-27, Akshar / Urmi): the headline says what the registrar lists
 * and what the book holds, and the notes name each bucket that holds the gap, largest first.
 */
import { describe, expect, it } from "vitest";
import { emptySummary, missingFromBook, summaryHeadline, summaryNotes } from "@/lib/rta/sip-register-summary";

const base = () => {
  const s = emptySummary();
  s.rows = 1800; s.dataLines = 1800;
  s.live = { n: 1796, amt: 7_305_930 };
  s.inBook = { n: 1400, amt: 6_282_000 };
  s.hiddenClient = { n: 120, amt: 400_000 };
  s.notPlaced = { n: 200, amt: 450_000 };
  s.closedHere = { n: 76, amt: 173_930 };
  return s;
};

describe("SIP register summary", () => {
  it("says what the registrar lists, what the book holds and the gap", () => {
    const s = base();
    expect(missingFromBook(s)).toEqual({ n: 396, amt: 1_023_930 });
    const h = summaryHeadline(s);
    expect(h).toMatch(/lists 1,796 live SIPs worth ₹73\.06 L a month/);
    expect(h).toMatch(/1,400 \(₹62\.82 L\) of them are in the book, 396 \(₹10\.24 L\) are not/);
  });

  it("names each bucket that holds the gap, largest rupee amount first", () => {
    const notes = summaryNotes(base());
    expect(notes[0]).toMatch(/^200 \(₹4\.50 L a month\) could not be placed .*folio master/);
    expect(notes[1]).toMatch(/^120 \(₹4\.00 L a month\) belong to clients who are closed, exited, in the Trash or merged/);
    expect(notes[2]).toMatch(/^76 \(₹1\.74 L a month\) are listed live by the registrar but closed in the CRM.*120 days/);
  });

  it("says short and blank lines were read, not lost", () => {
    const s = base();
    s.shortRows = 12; s.blankRows = 1;
    const text = summaryNotes(s).join("\n");
    expect(text).toMatch(/12 lines of the file had fewer cells than its header .* read, not dropped/);
    expect(text).toMatch(/1 lines had neither a folio nor an amount/);
  });

  it("has nothing to say when the whole register is in the book", () => {
    const s = emptySummary();
    s.live = { n: 10, amt: 50_000 };
    s.inBook = { n: 10, amt: 50_000 };
    expect(summaryNotes(s)).toEqual([]);
    expect(summaryHeadline(s)).toMatch(/10 \(₹50,000\) of them are in the book\.$/);
  });
});
