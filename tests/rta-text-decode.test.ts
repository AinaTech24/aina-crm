/**
 * CSV / TXT text decoding: BOM, UTF-8, UTF-16, Windows-1252 fallback.
 *
 * Both import paths decoded every CSV as latin-1: a UTF-8 BOM became "ï»¿"
 * glued to the first header, UTF-8 names became mojibake, and UTF-16 exports
 * imported nothing. SYNTHETIC text only.
 */
import { describe, expect, it } from "vitest";
import { decodeTextBytes } from "@/lib/rta/file-kind";
import { decodeRtaToText } from "@/lib/rta/decode";
import { parseRtaCsv } from "@/lib/rta";
import { FAKE_FOLIO, FAKE_PAN } from "./rta-fixtures";

const CSV = `Folio,Investor,Amount\n${FAKE_FOLIO},Ånand Kümar Šynthetic,1000\n`;

function utf16(text: string, order: "le" | "be", bom: boolean): Buffer {
  const le = Buffer.from(text, "utf16le");
  const body = order === "le" ? le : Buffer.from(le.map((_, i) => le[i ^ 1]));
  const mark = bom ? (order === "le" ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  return Buffer.concat([Buffer.from(mark), body]);
}

describe("decodeTextBytes", () => {
  it("UTF-8 with BOM: BOM stripped, names intact", () => {
    const out = decodeTextBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CSV, "utf8")]));
    expect(out).toBe(CSV);
    expect(out.startsWith("Folio")).toBe(true);
  });
  it("UTF-8 without BOM", () => {
    expect(decodeTextBytes(Buffer.from(CSV, "utf8"))).toBe(CSV);
  });
  it("UTF-16 LE and BE with a BOM", () => {
    expect(decodeTextBytes(utf16(CSV, "le", true))).toBe(CSV);
    expect(decodeTextBytes(utf16(CSV, "be", true))).toBe(CSV);
  });
  it("UTF-16 LE / BE written without a BOM", () => {
    const long = CSV.repeat(3);
    expect(decodeTextBytes(utf16(long, "le", false))).toBe(long);
    expect(decodeTextBytes(utf16(long, "be", false))).toBe(long);
  });
  it("not valid UTF-8 → latin-1, byte for byte", () => {
    const latin1 = Buffer.from("Name,Ånand Kümar\n", "latin1"); // 0xC5 / 0xFC alone are invalid UTF-8
    expect(decodeTextBytes(latin1)).toBe("Name,Ånand Kümar\n");
  });
});

describe("through the decoders", () => {
  it("feed path: a UTF-8 BOM no longer corrupts the first header", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CSV, "utf8")]);
    expect(decodeRtaToText(bytes, "feed.csv").split("\n")[0]).toBe("Folio|Investor|Amount");
  });
  it("feed path: a UTF-16 export decodes to the same text as UTF-8", () => {
    expect(decodeRtaToText(utf16(CSV, "le", true), "feed.csv")).toBe(decodeRtaToText(Buffer.from(CSV), "feed.csv"));
  });
  it("rich path: a BOM-prefixed KFintech-style CSV is recognised (first header matched)", () => {
    const csv =
      "Product Code,Fund,Folio,Investor Name,PAN Number\n" + `SYN1,SYN,${FAKE_FOLIO},Ånand Kümar,${FAKE_PAN}\n`;
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, "utf8")]);
    const parsed = parseRtaCsv(decodeTextBytes(bytes));
    expect(parsed.source).toBe("kfintech");
    expect(parsed.folios[0].investor.name).toBe("Ånand Kümar");
  });
});
