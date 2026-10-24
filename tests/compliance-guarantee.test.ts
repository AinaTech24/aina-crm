/**
 * The assured-return scan blocks a PROMISE of returns and lets a DISCLAIMER of
 * one through. Every proposal says "(at assumed returns, not guaranteed)"
 * beside its illustrative value; the scan used to read that as a promise and
 * block every proposal that showed a projected value.
 */
import { describe, expect, it } from "vitest";
import { runComplianceChecks } from "@/lib/comms/compliance";

const tenant = { legalName: "Acme Wealth LLP", arn: "270604" };
const check = (text: string) =>
  runComplianceChecks({ channel: "whatsapp", category: "transactional", tenant, text });
const guaranteeBlock = (text: string) =>
  check(text).findings.some((f) => f.rule === "amfi.no_guaranteed_returns" && f.severity === "block");

const PROPOSAL_MESSAGE = [
  "Hi Darshini,",
  "Sharing the *Investment Proposal* we discussed (PROP-2026-0002).",
  "💰 Total investment: ₹10,000",
  "📈 Illustrative value: ₹31,058 (at assumed returns, not guaranteed)",
  "📊 Risk: aggressive",
  "Approve or request changes here: https://crm.ainatech.in/p/abc123",
  "— Acme Wealth LLP",
  "ARN 270604",
  "_Mutual Fund investments are subject to market risks. Read all scheme-related documents carefully._",
].join("\n");

describe("assured-return language", () => {
  it("lets the proposal's own 'not guaranteed' disclaimer through", () => {
    expect(guaranteeBlock(PROPOSAL_MESSAGE)).toBe(false);
  });

  it.each([
    "Returns are not guaranteed.",
    "There is no guarantee of returns.",
    "We cannot guarantee any return.",
    "This does not guarantee future performance.",
    "Past performance is not assured and may not be sustained.",
    "Invest without any guarantee of capital.",
    "Illustrative value (at assumed returns, not guaranteed)",
    "The fund doesn't guarantee returns.",
  ])("lets a disclaimer through: %s", (text) => {
    expect(guaranteeBlock(text)).toBe(false);
  });

  it.each([
    "You get assured returns of 15% — risk free!",
    "Guaranteed returns every month.",
    "This plan gives 12% guaranteed.",
    "We guarantee you will make profit.",
    "A safe return with zero risk.",
    "Fixed return of 9% a year.",
    "Your money is assured to grow.",
  ])("still blocks a promise: %s", (text) => {
    expect(guaranteeBlock(text)).toBe(true);
  });

  it("blocks a promise even when a disclaimer sits in the same message", () => {
    expect(guaranteeBlock("Returns are not guaranteed in general, but this one is a guaranteed return.")).toBe(true);
  });

  it("still lets 'sum assured' through", () => {
    expect(guaranteeBlock("Sum assured: ₹1,00,00,000. Mutual Fund investments are subject to market risks.")).toBe(false);
  });
});
