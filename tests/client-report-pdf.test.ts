import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { renderClientReportPdf, type ReportBlock } from "@/lib/investors/client-report-pdf";
import { CLIENT_COPY_SECTIONS, FAMILY_REPORT_SECTIONS, parseClientReportSections } from "@/lib/investors/client-report-sections";

const long = "Discussed the portfolio, rebalancing towards debt and the upcoming health renewal. ".repeat(4);

function sampleBlocks(): ReportBlock[] {
  return [
    { t: "h1", text: "Summary" },
    { t: "kv", items: [["Client", "JATIN TALPARA"], ["Client type", "Individual"], ["Status", "Active"], ["PAN", "AUKPT1234A"], ["Relationship manager", "Aryan Kakkad"], ["Blank", ""]] },
    { t: "stats", items: [{ label: "Mutual fund value", value: "₹12.40 Lakh", sub: "NAV as on 24 Nov 2026" }, { label: "Gain", value: "₹2.10 Lakh" }, { label: "XIRR", value: "14.2%" }, { label: "Active SIPs", value: "₹25,000" }, { label: "Insurance in force", value: "3 policies" }] },
    { t: "h1", text: "Mutual fund portfolio", note: "NAV as on 24 Nov 2026" },
    {
      t: "table",
      cols: [{ h: "Scheme", w: 4.4 }, { h: "Folio", w: 1.6 }, { h: "Units", w: 1.3, right: true }, { h: "Value", w: 1.6, right: true }],
      rows: Array.from({ length: 70 }, (_, k) => [`HDFC Flexi Cap Fund - Regular Plan - Growth Option number ${k}`, `1234567/${k}`, "1,234.567", "₹1,23,456"]),
      maxLines: 3,
    },
    { t: "h2", text: "Rameshbhai B. Udeshi · Head of family" },
    { t: "h3", text: "Personal & contact" },
    { t: "kv", items: [["Mobile", "+91 90000 00000"]] },
    { t: "h1", text: "Meetings" },
    { t: "table", cols: [{ h: "Date", w: 1.6 }, { h: "Notes & action items", w: 5 }], rows: [["25 Nov 2026, 11:00 AM", `${long}\nAction: send the proposal (due 30 Nov 2026)`]], maxLines: 14 },
    { t: "empty", text: "No goals on record." },
    { t: "para", muted: true, text: "averyveryverylongwordwithoutanyspaceswhichmustbecutsothatitfitsinsidethepagewidthandneverrunsoff@example.com" },
  ];
}

describe("client report PDF", () => {
  it("renders a multi-page A4 report with the firm's letterhead", async () => {
    const pdf = await renderClientReportPdf({
      brand: { firmName: "Investment Options", arn: "ARN-12345", primaryColor: "#1d4ed8" },
      title: "CLIENT REPORT - COMPLETE RECORD",
      clientName: "JATIN TALPARA",
      subtitles: ["JATIN TALPARA", "Complete client record", "As on 25 Nov 2026"],
      footerNote: "Confidential - prepared by Investment Options for JATIN TALPARA.",
      blocks: sampleBlocks(),
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toContain("JATIN TALPARA");
    if (process.env.CLIENT_REPORT_SAMPLE) fs.writeFileSync(process.env.CLIENT_REPORT_SAMPLE, pdf);
  });

  it("reads the sections asked for, in report order; nothing valid means all", () => {
    expect(parseClientReportSections("insurance,profile,bogus")).toEqual(["profile", "insurance"]);
    expect(parseClientReportSections("").length).toBeGreaterThan(10);
    expect(FAMILY_REPORT_SECTIONS).not.toContain("family");
    expect(CLIENT_COPY_SECTIONS).not.toContain("activity");
    expect(CLIENT_COPY_SECTIONS).not.toContain("tasks");
    expect(CLIENT_COPY_SECTIONS).toContain("insurance");
  });
});
