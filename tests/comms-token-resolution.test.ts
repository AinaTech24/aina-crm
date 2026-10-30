/**
 * Regression tests for the template variable resolver.
 *
 * Every case here is a real production failure that blocked "Risk Profile —
 * Your Result" from sending to a live client, each one surfacing only on a real
 * send because template PREVIEW uses sample data and never runs this path.
 */

import { describe, it, expect } from "vitest";
import { resolveTokens, TokenResolutionError, type VariableDef } from "@/lib/comms/tokens";

const ctx = (overrides: Record<string, any> = {}) => ({
  subject: { name: "Bhavesh Bhoi", riskProfile: "moderate" },
  tenant: { legalName: "VSN Financial Services", arn: "90577" },
  overrides,
});

describe("resolveTokens — system-owned namespaces", () => {
  it("does not enforce a declared date type on risk.category", () => {
    // The tenant's template declared risk.category as `date`. The value is the
    // word "Moderate", so the date check threw and every send of the template
    // was blocked:  Variable 'risk.category' must be a valid date
    const vars: VariableDef[] = [{ key: "risk.category", type: "date", required: true }];
    const out = resolveTokens(vars, ctx({ "risk.category": "Moderate" }));
    expect(out["risk.category"]).toBe("Moderate");
  });

  it("does not enforce a declared number type on risk.score_display", () => {
    // risk.score_display is "24 / 40" — a display string, not a number.
    const vars: VariableDef[] = [{ key: "risk.score_display", type: "number", required: true }];
    const out = resolveTokens(vars, ctx({ "risk.score_display": "24 / 40" }));
    expect(out["risk.score_display"]).toBe("24 / 40");
  });

  it("passes an already-formatted date string through untouched", () => {
    // client-links.ts formats these with fmtDate() before we ever see them;
    // re-parsing and re-formatting would mangle or reject them.
    const vars: VariableDef[] = [{ key: "risk.profiled_on", type: "date" }];
    const out = resolveTokens(vars, ctx({ "risk.profiled_on": "09 Sep 2026" }));
    expect(out["risk.profiled_on"]).toBe("09 Sep 2026");
  });

  it("covers suitability.* and link.* too", () => {
    const vars: VariableDef[] = [
      { key: "suitability.status", type: "date" },
      { key: "link.risk_profile", type: "number" },
    ];
    const out = resolveTokens(
      vars,
      ctx({ "suitability.status": "warn", "link.risk_profile": "https://crm.ainatech.in/r/abc123" })
    );
    expect(out["suitability.status"]).toBe("warn");
    expect(out["link.risk_profile"]).toBe("https://crm.ainatech.in/r/abc123");
  });

  it("STILL blocks when a required system token is genuinely empty", () => {
    // An unprofiled client has no category, and a "your result" email has
    // nothing to report. Relaxing the TYPE check must not relax `required`.
    const vars: VariableDef[] = [{ key: "risk.category", type: "string", required: true }];
    expect(() => resolveTokens(vars, ctx({ "risk.category": "" }))).toThrow(TokenResolutionError);
  });

  it("still enforces declared types on ordinary template variables", () => {
    const vars: VariableDef[] = [{ key: "promo_ends", type: "date", required: true }];
    expect(() => resolveTokens(vars, ctx({ promo_ends: "not a date" }))).toThrow(/must be a valid date/);
  });

  it("tolerates a null variables array", () => {
    // Older template versions (and any duplicated from one) carry variables:null.
    expect(resolveTokens(null as unknown as VariableDef[], ctx())).toEqual({});
  });
});

describe("{{client.name}} — the person the message goes to", () => {
  // The CRM's own WhatsApp templates (document collection) and many a firm's
  // hand-made ones greet "{{client.name}}". Only investor.* and lead.* were
  // known, so a send went out with a blank name.
  it("fills a declared client.name from the subject, like investor.name", () => {
    const vars: VariableDef[] = [
      { key: "client.name", type: "string" },
      { key: "investor.name", type: "string" },
    ];
    const out = resolveTokens(vars, ctx());
    expect(out["client.name"]).toBe("Bhavesh Bhoi");
    expect(out["client.name"]).toBe(out["investor.name"]);
  });

  it("reaches the other fields of the subject too, snake_case or camelCase", () => {
    const out = resolveTokens(
      [{ key: "client.risk_profile", type: "string" }],
      ctx(),
    );
    expect(out["client.risk_profile"]).toBe("moderate");
  });

  it("a value the caller passed still wins", () => {
    const out = resolveTokens([{ key: "client.name", type: "string" }], ctx({ "client.name": "Asha" }));
    expect(out["client.name"]).toBe("Asha");
  });

  it("renders into the message body", async () => {
    const { renderTemplateText, resolveTokenPath } = await import("@/lib/comms/tokens");
    const tokens = { "client.name": resolveTokenPath("client.name", ctx()) };
    expect(renderTemplateText("Hello {{client.name}}, please upload your KYC.", tokens)).toBe("Hello Bhavesh Bhoi, please upload your KYC.");
  });
});
