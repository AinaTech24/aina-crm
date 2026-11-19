import { describe, it, expect } from "vitest";
import { decodeRtaToText } from "@/lib/rta/decode";

describe("a PDF inside an RTA file", () => {
  it("is named as a PDF instead of 'layout not recognised'", () => {
    const pdf = Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n", "latin1");
    expect(() => decodeRtaToText(pdf, "PP7460950745196198900341182181120261.pdf")).toThrow(/PDF, not a data file/);
    expect(() => decodeRtaToText(pdf, "statement")).toThrow(/PDF/);
  });
  it("still reads plain CSV", () => {
    expect(decodeRtaToText(Buffer.from("a,b\n1,2\n"), "x.csv")).toContain("a|b");
  });
});
