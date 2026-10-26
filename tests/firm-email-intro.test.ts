import { describe, expect, it } from "vitest";
import {
  FirmEmailIntroSchema,
  customFieldKey,
  firmIntroTokens,
  formatServices,
  readFirmEmailIntro,
} from "@/lib/firm/email-intro";
import { leadWelcomeBody, getStarterTemplate } from "@/lib/templates/starters";
import { renderEmailHtml, renderEmailText } from "@/lib/email-designer/render";

/** What lib/comms/email_renderer.tsx does on a send: nest the flat token map. */
function renderEmailTemplate(body: any, tokens: Record<string, string>): string {
  const variables: Record<string, any> = {};
  for (const [k, v] of Object.entries(tokens)) {
    variables[k] = v;
    if (k.includes(".")) {
      const [ns, rest] = [k.slice(0, k.indexOf(".")), k.slice(k.indexOf(".") + 1)];
      (variables[ns] ??= {})[rest] = v;
    }
  }
  return renderEmailHtml(body, {
    blankUnresolved: true,
    variables,
    tenant: { displayName: tokens.tenant_display_name, legalName: tokens.tenant_name, arn: tokens.tenant_arn },
  });
}

const baseTokens = {
  name: "Anita Desai",
  tenant_display_name: "Demo Wealth",
  tenant_name: "Demo Wealth Advisors LLP",
  tenant_arn: "ARN-123456",
};

describe("firm email introduction", () => {
  it("names a custom field from its label and refuses clashes", () => {
    expect(customFieldKey("Awards & Recognition")).toBe("awards_recognition");
    const ok = FirmEmailIntroSchema.parse({ mission: "  Help families  ", custom: [{ label: "Awards", value: "Best MFD 2025" }, { label: "", value: "" }] });
    expect(ok).toEqual({ mission: "Help families", custom: [{ key: "awards", label: "Awards", value: "Best MFD 2025" }] });
    expect(FirmEmailIntroSchema.safeParse({ custom: [{ label: "Mission", value: "x" }] }).success).toBe(false);
    expect(FirmEmailIntroSchema.safeParse({ custom: [{ label: "Awards", value: "a" }, { label: "awards", value: "b" }] }).success).toBe(false);
    expect(FirmEmailIntroSchema.safeParse({ founder_photo_url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("lists services as bullets and leaves blank fields out", () => {
    expect(formatServices("- Mutual funds\n\n• Insurance\n3) FDs")).toBe("• Mutual funds\n• Insurance\n• FDs");
    const t = firmIntroTokens(
      { services: "SIP\nInsurance", founder_photo_url: "/api/upload-local/x.jpg", custom: [{ key: "awards", label: "Awards", value: "Best MFD" }] },
      (u) => `https://crm.example.in${u}`
    );
    expect(t).toEqual({
      "firm.services": "• SIP\n• Insurance",
      "firm.founder_photo_url": "https://crm.example.in/api/upload-local/x.jpg",
      "firm.awards": "Best MFD",
    });
    expect(readFirmEmailIntro(null)).toEqual({});
  });
});

describe("new-lead welcome email", () => {
  it("introduces the firm with whatever it has written", () => {
    const tokens = {
      ...baseTokens,
      ...firmIntroTokens({
        company_intro: "We serve families in Mumbai.",
        services: "Mutual funds\nInsurance",
        mission: "Honest investing.",
        founder_name: "Rakesh Mehta",
        founder_designation: "Founder",
        founder_photo_url: "https://cdn.example.in/rakesh.jpg",
        founder_intro: "20 years in financial services.",
        office_timing: "Mon–Sat, 10 am – 6:30 pm",
      }),
    };
    const html = renderEmailTemplate(leadWelcomeBody(false) as any, tokens);
    expect(html).toContain("Dear Anita Desai");
    expect(html).toContain("About Demo Wealth");
    expect(html).toContain("We serve families in Mumbai.");
    expect(html).toContain("• Mutual funds<br>• Insurance");
    expect(html).toContain("Our mission");
    expect(html).toContain('src="https://cdn.example.in/rakesh.jpg"');
    expect(html).toContain("Rakesh Mehta");
    expect(html).toContain("Mon–Sat, 10 am – 6:30 pm");
  });

  it("drops every part the firm has not written, without a broken image", () => {
    const html = renderEmailTemplate(leadWelcomeBody(false) as any, baseTokens);
    expect(html).toContain("Dear Anita Desai");
    for (const gone of ["About Demo Wealth", "Our services", "Our mission", "Meet our founder", "Office timing", "<img src=\"\""]) {
      expect(html).not.toContain(gone);
    }
    const text = renderEmailText(leadWelcomeBody(false) as any, { variables: { name: "Anita" } });
    expect(text).not.toContain("Our mission");
  });

  it("thanks the referrer in the referral version", () => {
    const html = renderEmailTemplate(leadWelcomeBody(true) as any, { ...baseTokens, referred_by_name: "Rajesh Sharma" });
    expect(html).toContain("a special thank-you to Rajesh Sharma");
    expect(getStarterTemplate("lead_welcome_referral")?.body).toEqual(leadWelcomeBody(true));
  });

  it("escapes what the firm typed", () => {
    const html = renderEmailTemplate(leadWelcomeBody(false) as any, { ...baseTokens, "firm.mission": "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("migration 0246", () => {
  it("upgrades to exactly the starter the code provisions", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("drizzle/migrations/0246_firm_email_intro.sql", "utf8");
    for (const key of ["lead_welcome", "lead_welcome_referral"]) {
      // ('key', $j$old$j$::jsonb, $j$new$j$::jsonb) — the new body is the second quoted value.
      const row = sql.slice(sql.indexOf(`('${key}', $j$`));
      const parts = row.split("$j$");
      expect(parts.length, key).toBeGreaterThan(4);
      expect(JSON.parse(parts[3])).toEqual(getStarterTemplate(key)!.body);
    }
  });
});
