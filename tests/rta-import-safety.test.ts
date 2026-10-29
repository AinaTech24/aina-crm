/**
 * The RTA import rules from the 29 Oct 2026 audit: reversals are not new
 * money, a switch-out is an outflow, a file with no transaction number keys
 * rows on what they are (not their line number), folio numbers are only
 * unique within an AMC, a minor's folio is not moved onto the guardian's PAN,
 * and every data file in a ZIP is read.
 */
import { describe, expect, it } from "vitest";
import { ZipWriter, Uint8ArrayWriter, TextReader } from "@zip.js/zip.js";
import { parseCamsFeed, reversalOf } from "@/lib/integrations/cams-feed-parser";
import { chooseClient, folioKey, pickFolioForScheme, pickFolioOwner, type FolioCandidate } from "@/lib/rta/process";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";

const HEADER = "AMC_CODE|FOLIO_NO|PRODCODE|SCHEME|INV_NAME|TRXNTYPE|TRXNNO|TRADDATE|UNITS|AMOUNT|PURPRICE|PAN";
const row = (cols: Record<string, string>) =>
  [cols.amc ?? "P", cols.folio ?? "123/45", cols.prod ?? "P123", cols.scheme ?? "ICICI Bluechip", "A CLIENT",
   cols.type ?? "P", cols.no ?? "1001", cols.date ?? "25/08/2026", cols.units ?? "10.5", cols.amount ?? "1000", "95.2", cols.pan ?? "ABCDE1234F"].join("|");

describe("reversals and direction", () => {
  it("a purchase with negative units is a reversal, not a second purchase", () => {
    const [r] = parseCamsFeed([HEADER, row({ type: "SIN", units: "-10.5", amount: "-1000" })].join("\n"));
    expect(r.type).toBe("sip");
    expect(r.isReversal).toBe(true);
    expect(r.amount).toBe(1000);
    expect(r.raw?.units).toBe("-10.5");
  });

  it("an ordinary purchase is not", () => {
    const [r] = parseCamsFeed([HEADER, row({})].join("\n"));
    expect(r.isReversal).toBe(false);
    expect(r.direction).toBe("inflow");
  });

  it("a switch leg with negative units is the out-leg, not a reversal", () => {
    const [r] = parseCamsFeed([HEADER, row({ type: "SWITCH", units: "-20", amount: "-2000" })].join("\n"));
    expect(r.type).toBe("switch");
    expect(r.direction).toBe("outflow");
    expect(r.isReversal).toBe(false);
  });

  it("a redemption's negative units are normal; the word reversal is what marks one", () => {
    expect(reversalOf("redemption", "outflow", -500, -5, "R")).toBe(false);
    expect(reversalOf("redemption", "outflow", 500, 5, "REDEMPTION REVERSAL")).toBe(true);
    expect(reversalOf("switch", "outflow", -500, -5, "TOCOB")).toBe(false);
  });
});

describe("a file with no transaction-number column", () => {
  const header = "AMC_CODE|FOLIO_NO|PRODCODE|SCHEME|TRXNTYPE|TRADDATE|UNITS|AMOUNT|PAN";
  const line = (folio: string) => ["P", folio, "P1", "Fund", "P", "25/08/2026", "1", "100", "ABCDE1234F"].join("|");

  it("keys a row on what it is, not on its line number", () => {
    const a = parseCamsFeed([header, line("111")].join("\n"));
    const b = parseCamsFeed([header, line("222"), line("111")].join("\n"));
    expect(a[0].externalRef).not.toMatch(/_1$/);
    // The same transaction keeps its key whichever line it sits on…
    expect(b[1].externalRef).toBe(a[0].externalRef);
    // …and a different transaction on the same line number does not take it.
    expect(b[0].externalRef).not.toBe(a[0].externalRef);
  });

  it("keeps two genuinely identical rows as two", () => {
    const rows = parseCamsFeed([header, line("111"), line("111")].join("\n"));
    expect(rows[0].externalRef).not.toBe(rows[1].externalRef);
  });
});

describe("folio numbers are unique only within an AMC", () => {
  const a = { amcCode: "P", investorId: "client-a", isMinor: false };
  const b = { amcCode: "H", investorId: "client-b", isMinor: false };

  it("normalises the number the way the registrar means it", () => {
    expect(folioKey(" 123 / 45 ")).toBe("12345");
    expect(folioKey("ab-12")).toBe("AB12");
  });

  it("one client behind the number: that client", () => {
    expect(pickFolioOwner([a], "ZZ")?.investorId).toBe("client-a");
  });

  it("several: the row's AMC decides, and no match is nobody — never a guess", () => {
    expect(pickFolioOwner([a, b], "H")?.investorId).toBe("client-b");
    expect(pickFolioOwner([a, b], "K")).toBeNull();
    expect(pickFolioOwner([a, b], "")).toBeNull();
  });

  const cand = (id: string, investor: string, amc: string, schemes: Array<{ schemeCode?: string; schemeName?: string }> = []): FolioCandidate => ({
    id, investor_id: investor, amc_code: amc, amc_name: amc, rta: "cams", schemes,
  });

  it("a report with no AMC: the folio holding the scheme, else the CAMS product code's AMC", () => {
    const x = cand("f1", "client-a", "D", [{ schemeCode: "D157" }]);
    const y = cand("f2", "client-b", "H", [{ schemeCode: "H02" }]);
    expect(pickFolioForScheme([x, y], "H02", "", "cams").folio?.id).toBe("f2");
    expect(pickFolioForScheme([x, y], "D999", "", "cams").folio?.id).toBe("f1");
    expect(pickFolioForScheme([x, y], "Z1", "", "cams")).toEqual({ folio: null, ambiguous: true });
    expect(pickFolioForScheme([x], "Z1", "", "cams").folio?.id).toBe("f1");
    expect(pickFolioForScheme([], "Z1", "", "cams")).toEqual({ folio: null, ambiguous: false });
  });
});

describe("a minor's folio", () => {
  it("stays the minor's when the row carries the guardian's PAN", () => {
    expect(chooseClient("guardian", { amcCode: "", investorId: "minor", isMinor: true })).toBe("minor");
  });
  it("PAN still wins over an adult's folio, and fills in when there is no folio", () => {
    expect(chooseClient("pan-client", { amcCode: "", investorId: "other", isMinor: false })).toBe("pan-client");
    expect(chooseClient("pan-client", null)).toBe("pan-client");
    expect(chooseClient(null, { amcCode: "", investorId: "owner", isMinor: false })).toBe("owner");
  });
});

describe("a ZIP with more than one report", () => {
  it("returns every data file, not just the first", async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("readme.pdf", new TextReader("not data"));
    await writer.add("WBR2.csv", new TextReader("a,b\n1,2"));
    await writer.add("WBR9.csv", new TextReader("c,d\n3,4"));
    const zip = await writer.close();
    const r = await extractRtaFileFromZip(zip);
    expect(r.filename).toBe("WBR2.csv");
    expect(r.others.map((o) => o.filename)).toEqual(["WBR9.csv"]);
    expect(new TextDecoder().decode(r.others[0].data)).toBe("c,d\n3,4");
  });
});
