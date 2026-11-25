/**
 * The client master PDF (2026-11-25): Client Master → Portfolio → Fixed deposits → Cross-sell → Review details,
 * then ONLY the optional sections the person ticked, then Notes. These render the real layout from plain data
 * (no database) and keep the page structure from drifting.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderClientMasterPdf } from "@/lib/investors/client-master/render";
import { OPTIONAL_KEYS, type ClientMasterData, type PdfTable } from "@/lib/investors/client-master/types";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const kv = (label: string, value: string) => ({ label, value });
const table = (rows: PdfTable["rows"] = []): PdfTable => ({ heads: ["A", "B"], rows, widths: [0.5, 0.5], empty: "Nothing." });

function sample(optional: ClientMasterData["optional"], noteCount = 1): ClientMasterData {
  return {
    generatedAt: "2026-11-25T08:00:00.000Z",
    refId: "ABCD1234",
    brand: { displayName: "Test Firm", legalName: "Test Firm LLP", arn: "ARN-1", primaryColor: "#0e2557", secondaryColor: "#0ea5e9", logoUrl: null },
    client: { name: "Test Client", pan: "ABCDE1234F", status: "Active", typeLabel: "Individual", since: "14 Mar 2019", rm: "RM", branch: null, family: null, aum: 100000, sipBook: 5000 },
    master: { identity: [kv("PAN", "ABCDE1234F")], contact: [kv("Mobile", "9999999999")], profile: [kv("Occupation", "Business")], compliance: [kv("KYC status", "Verified")], bank: table(), secondHolder: null, lifetime: [kv("Client status", "Active")] },
    nominees: { note: "No nominee recorded.", table: table() },
    referrals: { referredBy: [kv("Referred by", "—")], typed: null, leads: table() },
    risk: { summary: [kv("Category", "Moderate")], answers: null },
    portfolio: {
      tiles: [{ label: "Current value", value: "₹1,00,000" }], holdings: table([["Scheme ₹ 5,000 ••••4821", "1"]]),
      allocation: [{ label: "Equity", pct: 100, value: 100000 }], sips: table(), sipNote: "SIP book: ₹5,000", note: null,
    },
    fds: { tiles: [{ label: "Live deposits", value: "0" }], table: table() },
    crossSell: { holdings: table(), open: table(), closed: table() },
    review: { schedule: [kv("Review frequency", "Half yearly")], last: null, history: table() },
    optional,
    notes: Array.from({ length: noteCount }, () => ({ by: "RM", at: "12 Nov 2026", title: "Note", text: "A note about the client." })),
    available: { meetings: true, serviceRequests: true, tasks: true, emails: true, gifts: true },
  };
}

const all: ClientMasterData["optional"] = Object.fromEntries(
  OPTIONAL_KEYS.map((k) => [k, { title: `${k} (0)`, table: table() }]),
);

async function pages(d: ClientMasterData): Promise<number> {
  const bytes = await renderClientMasterPdf(d);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  return (await PDFDocument.load(bytes)).getPageCount();
}

// The Client Master section is two pages (identity … risk profile flow over), then one page each for
// portfolio, fixed deposits, cross-sell, review details and notes.
const BASE = 7;

describe("client master PDF layout", () => {
  it("renders the always-included pages: master, portfolio, fixed deposits, cross-sell, review, notes", async () => {
    expect(await pages(sample({}))).toBe(BASE);
  });

  it("adds exactly one page for each optional section that was asked for, before the notes", async () => {
    expect(await pages(sample({ meetings: all.meetings }))).toBe(BASE + 1);
    expect(await pages(sample(all))).toBe(BASE + OPTIONAL_KEYS.length);
  });

  it("a long table or a long notes list continues on more pages instead of being cut", async () => {
    const rows: PdfTable["rows"] = Array.from({ length: 120 }, (_, i) => [`Row ${i}`, "x"]);
    const long = sample({ tasks: { title: "Tasks (120)", table: table(rows) } }, 40);
    expect(await pages(long)).toBeGreaterThan(BASE + 2);
  });

  it("a client with no portfolio rights gets no Portfolio page", async () => {
    expect(await pages({ ...sample({}), portfolio: null })).toBe(BASE - 1);
  });
});

describe("the route and the popup stay wired", () => {
  it("the PDF route only includes the sections named in ?include= and audits the download", () => {
    const route = read("src/app/api/investors/[id]/client-master/pdf/route.ts");
    expect(route).toContain("OPTIONAL_KEYS");
    expect(route).toContain("investor.client_master_downloaded");
    expect(route).toContain("requireAny(");
  });

  it("the loader never loads an optional section the viewer's role cannot see", () => {
    const load = read("src/lib/investors/client-master/load.ts");
    expect(load).toContain("const want = (k: OptionalKey) => include.includes(k) && available[k];");
    for (const k of ["meetings", "serviceRequests", "tasks", "emails", "gifts"]) expect(load).toContain(`want("${k}")`);
  });

  it("the client page's More menu has the download row", () => {
    expect(read("src/app/dashboard/investors/[id]/page.tsx")).toContain("<ClientMasterDownload");
  });
});
