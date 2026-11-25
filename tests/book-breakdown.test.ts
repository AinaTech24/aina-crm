/**
 * Where the clients, AUM and SIPs went after an import (2026-11-25, Urmi Financial Services): the notes name each
 * reason the dashboard can differ from the registrar's own totals, and the SQL runs against the real schema.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { bookBreakdownNotes, type BookBreakdown } from "@/lib/metrics/book-breakdown";

const empty = { clients: 0, aum: 0, sip: 0 };
const base: BookBreakdown = {
  live: { clients: 2404, aum: 1_823_300_000, sip: 6_282_000, funded: 1022, unfunded: 1382 },
  closedOrExited: { clients: 0, aum: 0, sip: 0 },
  inTrash: empty,
  mergedAway: empty,
  folios: { total: 3000, valued: 2900, unvalued: 100 },
  sips: { active: 1500, activeAmount: 6_282_000, activeOfLeftOut: 0, activeOfLeftOutAmount: 0, ended: 300 },
  duplicates: { noPan: 60, sharedPan: 0 },
};

describe("book breakdown notes", () => {
  it("separates clients holding money from every record, and explains the extra records", () => {
    const text = bookBreakdownNotes(base).join("\n");
    expect(text).toMatch(/1,022 clients hold money today; 1,382 more have a record but no balance/);
    expect(text).toMatch(/100 of 3,000 folios have no value/);
    expect(text).toMatch(/300 SIP registrations are stopped/);
    expect(text).toMatch(/60 live records have no PAN/);
  });

  it("names AUM and SIPs that sit on records the dashboards leave out", () => {
    const b: BookBreakdown = {
      ...base,
      closedOrExited: { clients: 40, aum: 300_000_000, sip: 100_000 },
      inTrash: { clients: 5, aum: 50_000_000, sip: 0 },
      sips: { ...base.sips, activeOfLeftOut: 30, activeOfLeftOutAmount: 250_000 },
    };
    const text = bookBreakdownNotes(b).join("\n");
    expect(text).toMatch(/₹35.00 Cr of AUM sits on records the dashboards leave out/);
    expect(text).toMatch(/40 closed \/ exited \(₹30.00 Cr\), 5 in the Trash \(₹5.00 Cr\)/);
    expect(text).toMatch(/30 active SIPs \(₹2.50 L a month\)/);
  });

  it("says nothing when every record is live, funded, valued and unique", () => {
    const clean: BookBreakdown = {
      ...base,
      live: { ...base.live, unfunded: 0, funded: 2404 },
      folios: { total: 10, valued: 10, unvalued: 0 },
      sips: { ...base.sips, ended: 0 },
      duplicates: { noPan: 0, sharedPan: 0 },
    };
    expect(bookBreakdownNotes(clean)).toEqual([]);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("the breakdown query", () => {
  it("runs against the real schema", async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    const { withSystem } = await import("@/db/client");
    const { loadBookBreakdown } = await import("@/lib/metrics/book-breakdown");
    const r = await withSystem((tx) => loadBookBreakdown(tx, randomUUID()));
    expect(r.live.clients).toBe(0);
    expect(r.folios.total).toBe(0);
    expect(r.sips.active).toBe(0);
  });
});
