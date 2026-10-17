import { describe, expect, it } from "vitest";
import { canUseVersion } from "@/lib/templates/version-use";

describe("canUseVersion", () => {
  it("lets an approved email / SMS version be used", () => {
    expect(canUseVersion("email", "approved_internal")).toBe(true);
    expect(canUseVersion("sms", "approved_external")).toBe(true);
  });

  it("never lets a draft, submitted or rejected version be sent", () => {
    for (const s of ["draft", "submitted", "rejected"]) {
      expect(canUseVersion("email", s)).toBe(false);
    }
  });

  it("needs Meta's approval for WhatsApp", () => {
    expect(canUseVersion("whatsapp", "approved_internal")).toBe(false);
    expect(canUseVersion("whatsapp", "submitted", true)).toBe(true);
    expect(canUseVersion("whatsapp", "approved_external")).toBe(true);
    expect(canUseVersion("whatsapp", "draft", true)).toBe(false);
  });
});
