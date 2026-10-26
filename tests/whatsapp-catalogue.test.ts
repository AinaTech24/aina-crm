import { describe, expect, it } from "vitest";
import { WHATSAPP_TEMPLATES, WA_LANGUAGE, sampleTokens } from "@/lib/templates/whatsapp-catalogue";
import { buildMetaSubmission } from "@/lib/comms/whatsapp-template-submit";
import { runComplianceChecks, MANDATORY_RISK_DISCLAIMER } from "@/lib/comms/compliance";
import { renderTemplateText } from "@/lib/comms/tokens";
import { firmSignOffTokens, bareArn } from "@/lib/comms/firm-sign-off";

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;
const placeholders = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1].trim());
const firstSeen = (text: string) => [...new Set(placeholders(text))];

const TENANT = { legalName: "Shah Wealth Advisors LLP", arn: "ARN-123456", riaRegistered: false };

describe("required WhatsApp templates", () => {
  it("has a utility and a marketing set, with unique Meta-safe names", () => {
    const keys = WHATSAPP_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9_]+$/);
    expect(WHATSAPP_TEMPLATES.some((t) => t.category === "utility")).toBe(true);
    expect(WHATSAPP_TEMPLATES.some((t) => t.category === "marketing")).toBe(true);
  });

  it.each(WHATSAPP_TEMPLATES.map((t) => [t.key, t] as const))("%s declares variables in the order the body uses them", (_k, t) => {
    // A send fills Meta's {{1}}, {{2}}… from the declared list, in order.
    expect(t.variables.map((v) => v.key)).toEqual(firstSeen(t.body));
  });

  it.each(WHATSAPP_TEMPLATES.map((t) => [t.key, t] as const))("%s follows Meta's placeholder rules", (_k, t) => {
    const body = t.body.trim();
    expect(body.startsWith("{{")).toBe(false);
    expect(body.endsWith("}}")).toBe(false);
    expect(body).not.toMatch(/\}\}\s*\{\{/); // two placeholders never touch
    expect(t.body.length).toBeLessThanOrEqual(1024);
    for (const v of t.variables) expect(v.example.trim()).not.toBe("");
    // no sample value may carry a line break or tab (Meta rejects them)
    for (const v of t.variables) expect(v.example).not.toMatch(/[\n\t]/);
  });

  it.each(WHATSAPP_TEMPLATES.map((t) => [t.key, t] as const))("%s becomes a clean Meta submission", (_k, t) => {
    const sub = buildMetaSubmission(
      { key: t.key, name: t.name, category: t.category, locale: "en-IN" } as any,
      { body: { body: { text: t.body }, ...(t.footer ? { footer: { text: t.footer } } : {}) }, variables: t.variables } as any
    );
    expect(sub.templateName).toBe(t.key);
    expect(sub.category).toBe(t.category === "marketing" ? "MARKETING" : "UTILITY");
    expect(sub.language).toBe(WA_LANGUAGE);
    // every positional placeholder has a real sample, never a placeholder word
    const n = new Set(placeholders(sub.messageBody)).size;
    expect(sub.variableExamples).toHaveLength(n);
    for (const ex of sub.variableExamples) expect(ex.example).not.toMatch(/^(sample|first_name|name)$/i);
    expect(sub.messageBody).not.toMatch(/\{\{[^0-9]/);
  });

  // The gate also asks whether THIS recipient opted in to marketing — a fact of
  // the client at send time, not of the template — so the test sends to one who did.
  it.each(WHATSAPP_TEMPLATES.map((t) => [t.key, t] as const))("%s clears the compliance gate for an opted-in client", (_k, t) => {
    const tokens = { ...sampleTokens(t), ...firmSignOffTokens({ legalName: TENANT.legalName, arn: TENANT.arn }) };
    const text = renderTemplateText(t.body, tokens);
    const result = runComplianceChecks({
      channel: "whatsapp",
      category: t.category,
      tenant: TENANT,
      text,
      hasMarketingConsent: true,
    } as any);
    expect(result.findings.filter((f) => f.severity === "block")).toEqual([]);
  });

  it("every marketing template carries the market-risk line and an opt-out", () => {
    for (const t of WHATSAPP_TEMPLATES.filter((x) => x.category === "marketing")) {
      expect(t.body).toContain(MANDATORY_RISK_DISCLAIMER);
      expect(t.body).toMatch(/STOP to opt out/i);
    }
  });

  it("utility templates do not sell", () => {
    for (const t of WHATSAPP_TEMPLATES.filter((x) => x.category === "utility")) {
      expect(t.body).not.toMatch(/offer|discount|invest now|limited time|opt out/i);
    }
  });

  it("promises no returns", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.body).not.toMatch(/guarantee|assured return|risk[- ]free|\d+\s*%/i);
    }
  });
});

describe("firm sign-off", () => {
  it("never doubles the ARN prefix", () => {
    expect(bareArn("ARN-249212")).toBe("249212");
    expect(bareArn("arn 249212")).toBe("249212");
    expect(bareArn("249212")).toBe("249212");
    expect(firmSignOffTokens({ legalName: "Shah Wealth LLP", arn: "ARN-249212" }).firm_sign_off).toBe("Shah Wealth LLP (ARN-249212)");
  });

  it("falls back to the display name, and drops the ARN when the firm has none", () => {
    expect(firmSignOffTokens({ displayName: "Shah Wealth", arn: null })).toEqual({
      firm_sign_off: "Shah Wealth",
      arn_no: "",
      arn_name: "Shah Wealth",
    });
  });
});
