/**
 * The pilot handover's scheme-level export reconciles with its totals
 * (docs/rta/handover). The figures were taken from the posting LEDGER of an
 * isolated development rehearsal on the real sample files; this test keeps the
 * two committed files consistent with each other and with the reconciliation
 * the handover states, so a hand edit of either cannot drift silently.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(__dirname, "..", "docs", "rta", "handover");
function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(path.join(dir, file), "utf8").trim();
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); rows.push(out);
  }
  const [h, ...body] = rows;
  return body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}
const codes = readCsv("kfintech-pilot-scheme-codes.csv");
const totals = Object.fromEntries(readCsv("kfintech-pilot-totals.csv").map((r) => [r.metric, Number(r.value)]));
const sum = (k: string) => Math.round(codes.reduce((a, r) => a + Number(r[k]), 0) * 100) / 100;

describe("pilot handover — scheme-level export reconciles", () => {
  it("118 codes: 114 resolved by ISIN, the 4 unresolved stay visible with nothing recorded", () => {
    expect(codes).toHaveLength(totals.scheme_codes);
    expect(codes.filter((r) => r.status === "resolved_isin" && r.reason_code === "isin_verified")).toHaveLength(114);
    const open = codes.filter((r) => r.status !== "resolved_isin");
    expect(open.map((r) => r.registrar_scheme_code).sort()).toEqual(["120DEGP", "120RGGP", "127DFGP", "185SCRG"]);
    for (const r of open) { expect(r.recorded_transactions).toBe("0"); expect(r.amfi_scheme_code).toBe(""); }
    for (const r of codes.filter((x) => Number(x.recorded_transactions) > 0)) expect(r.amfi_scheme_code).toMatch(/^\d+$/);
  });

  it("column sums equal the ledger totals: processed and rejected kept apart", () => {
    expect(sum("processed_transactions")).toBe(totals.processed_transactions);
    expect(sum("processed_amount_inr")).toBe(totals.processed_amount_inr);
    expect(sum("rejected_transactions")).toBe(totals.rejected_transactions);
    expect(sum("rejected_gross_leg_amount_inr")).toBe(totals.rejected_gross_leg_amount_inr);
    expect(sum("recorded_transactions")).toBe(totals.recorded_transactions);
    expect(sum("registrar_transactions")).toBe(totals.economic_records);
    expect(totals.processed_transactions).toBe(1073);
    expect(totals.processed_amount_inr).toBe(10227740.48);
    expect(totals.rejected_transactions).toBe(3);
    expect(totals.rejected_gross_leg_amount_inr).toBe(12000);
    expect(totals.recorded_transactions).toBe(1076);
  });

  it("every row: recorded = processed + rejected; rejected legs by role; no processed dates without processed rows", () => {
    for (const r of codes) {
      const n = (k: string) => Number(r[k]);
      expect(n("recorded_transactions")).toBe(n("processed_transactions") + n("rejected_transactions"));
      expect(n("rejected_transactions")).toBe(n("rejected_sip_instalments") + n("rejected_stp_source_legs") + n("rejected_stp_destination_legs"));
      expect(n("rejected_instructions_counted_here")).toBe(n("rejected_sip_instalments") + n("rejected_stp_source_legs"));
      expect(n("rejected_instruction_amount_inr")).toBeLessThanOrEqual(n("rejected_gross_leg_amount_inr"));
      if (n("processed_transactions") === 0) { expect(n("processed_amount_inr")).toBe(0); expect(r.first_processed_date).toBe(""); }
      else expect(r.first_processed_date <= r.last_processed_date).toBe(true);
    }
  });

  it("a failed STP is one instruction with two legs: instructions are not double-counted", () => {
    expect(sum("rejected_stp_source_legs")).toBe(sum("rejected_stp_destination_legs"));
    expect(sum("rejected_instructions_counted_here")).toBe(totals.rejected_instructions);
    expect(sum("rejected_instruction_amount_inr")).toBe(totals.rejected_instruction_amount_inr);
    expect(totals.rejected_instructions).toBe(totals.rejected_sip_instalments + totals.rejected_stp_source_legs);
    expect(totals.rejected_instructions).toBe(2);
    expect(totals.rejected_instruction_amount_inr).toBe(7000);
  });

  it("every economic record has exactly one outcome, and the source rows add up", () => {
    expect(totals.processed_transactions + totals.rejected_transactions + totals.held_corrections + totals.held_unknown_code_events).toBe(totals.economic_records);
    expect(totals.posted_source_rows + totals.rejected_transactions + 99 + 8).toBe(totals.source_rows_mfsd201);
    expect(totals.duplicate_ledger_identities).toBe(0);
    // The legacy rehearsal's cross-tab adds up to the same ledger (final security patch, P1).
    expect(totals.legacy_rehearsal_processed_matched_existing + totals.legacy_rehearsal_processed_newly_inserted).toBe(totals.processed_transactions);
    expect(totals.legacy_rehearsal_rejected_matched_existing + totals.legacy_rehearsal_rejected_newly_inserted).toBe(totals.rejected_transactions);
    expect(totals.legacy_rehearsal_processed_newly_inserted).toBe(totals.multi_lot_redemptions);
    expect(totals.legacy_rehearsal_identity_conflicts).toBe(0);
    // The Operations dashboard shows instructions and legs separately, equal to the ledger (final security patch, P1).
    expect(totals.ops_dashboard_rejected_instructions).toBe(totals.rejected_instructions);
    expect(totals.ops_dashboard_rejected_instruction_amount_inr).toBe(totals.rejected_instruction_amount_inr);
    expect(totals.ops_dashboard_rejected_legs).toBe(totals.rejected_transactions);
    expect(totals.ops_dashboard_rejected_leg_amount_inr).toBe(totals.rejected_gross_leg_amount_inr);
  });
});
