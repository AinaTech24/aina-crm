import { describe, expect, it } from "vitest";
import { createPseudonymiser, hideInRequest, revealInResponse } from "@/lib/ai/pseudonymise";
import { isMinorRecord } from "@/lib/privacy/minors";
import { currentTenant, noteTenant } from "@/lib/tenant-context";

describe("AI prompts never carry identifiers", () => {
  it("replaces PAN, Aadhaar, phone and email, the same value with the same placeholder", () => {
    const ps = createPseudonymiser();
    const out = ps.hide("Ravi (PAN ABCPK1234F, mobile +91 98250 12345, ravi@x.in) and again 9825012345? Aadhaar 2345 6789 0123. PAN ABCPK1234F.");
    expect(out).not.toMatch(/ABCPK1234F|98250|ravi@x\.in|2345 6789 0123/);
    expect(out.match(/\[PAN_1\]/g)?.length).toBe(2);
    expect(out).toContain("[EMAIL_1]");
    expect(out).toContain("[AADHAAR_1]");
    expect(out).toContain("[PHONE_1]");
  });

  it("leaves amounts, dates, folio numbers and names alone", () => {
    const ps = createPseudonymiser();
    const text = "Ravi Shah invested ₹1,20,000 on 2026-11-03 in folio 12345678/90; SIP ₹5000; AUM 4512345678.";
    expect(ps.hide(text)).toBe(text);
    expect(ps.count()).toBe(0);
  });

  it("puts the real values back into the answer", () => {
    const ps = createPseudonymiser();
    const req = hideInRequest(
      { system: "Draft for ravi@x.in", messages: [{ role: "user", content: [{ type: "text", text: "Call 9876543210 about PAN ABCPK1234F" }] }] },
      ps
    );
    expect(JSON.stringify(req)).not.toMatch(/ravi@x\.in|9876543210|ABCPK1234F/);
    const res = revealInResponse({ content: [{ type: "text", text: "Hi, we'll call you on [PHONE_1] and email [EMAIL_1]." }] }, ps);
    expect(res.content[0].text).toBe("Hi, we'll call you on 9876543210 and email ravi@x.in.");
  });

  it("leaves non-text parts (an uploaded policy PDF) untouched", () => {
    const ps = createPseudonymiser();
    const doc = { type: "document", source: { data: "base64…" } };
    const req = hideInRequest({ messages: [{ role: "user", content: [doc as never] }] }, ps);
    expect(req.messages[0].content).toEqual([doc]);
  });
});

describe("no marketing to a child", () => {
  const now = new Date("2026-11-03T00:00:00Z");
  it("the minor flag, or a date of birth under 18", () => {
    expect(isMinorRecord({ isMinor: true }, now)).toBe(true);
    expect(isMinorRecord({ dob: "2010-05-01" }, now)).toBe(true);
    expect(isMinorRecord({ dob: "2008-11-02" }, now)).toBe(false); // turned 18 yesterday
    expect(isMinorRecord({ dob: null }, now)).toBe(false);
    expect(isMinorRecord({ dob: "not a date" }, now)).toBe(false);
  });
});

describe("the firm in context", () => {
  it("noted before the first await, it is seen by the caller afterwards", async () => {
    async function withFirm() {
      noteTenant("firm-a");
      await Promise.resolve();
    }
    await (async () => {
      await withFirm();
      expect(currentTenant()).toBe("firm-a");
    })();
  });

  it("concurrent jobs keep their own firm", async () => {
    const seen: string[] = [];
    await Promise.all(
      ["x", "y"].map(async (id) => {
        noteTenant(id);
        await new Promise((r) => setTimeout(r, 5));
        seen.push(`${id}:${currentTenant()}`);
      })
    );
    expect(seen.sort()).toEqual(["x:x", "y:y"]);
  });
});
