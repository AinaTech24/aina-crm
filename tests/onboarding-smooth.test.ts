/**
 * The pure rules behind the smoother self-serve onboarding (2026-11-18):
 * the GSTIN → state rule, the quote follow-up's selection and email, a quote's
 * stage, the stalled-firm selection and nudge, the mobile code's rules (and
 * that SMS never blocks), resume re-pricing and the onboarding-call link.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING, quoteCycle, type PricingSettings } from "@/lib/billing/aum-pricing";
import { gstinCheckChar, gstinStateMismatch, stateFromGstin } from "@/lib/legal/gst";
import { resumeLink, resumeQuote, type ClaimedQuote } from "@/lib/billing/quotes";
import { FOLLOWUP_FOOTER, quoteFollowupEmail, quoteStage, selectQuoteFollowups, type FollowupCandidate } from "@/lib/onboarding/quote-followup";
import { isStalled, selectStalledNudges, stalledNudgeEmail, type StalledFirm } from "@/lib/onboarding/stalled";
import { canSendMobileOtp, checkMobileOtp, maskMobile, MOBILE_OTP_MAX_SENDS, sendMobileOtp, smsOtpConfig, type OtpState } from "@/lib/onboarding/mobile-otp";
import { hashOtpCode } from "@/lib/public-otp";
import { onboardingCallUrl, ONBOARDING_CALL_TEXT } from "@/lib/onboarding/messages";
import { welcomeEmail } from "@/lib/onboarding/welcome";

const gstin = (state: string, pan = "AAAPL1234C") => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const NOW = new Date("2026-11-18T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("GSTIN → state (item 6)", () => {
  it("a valid GSTIN names its state; an incomplete one names nothing", () => {
    expect(stateFromGstin(gstin("24"))).toEqual({ code: "24", name: "Gujarat" });
    expect(stateFromGstin(gstin("27").toLowerCase())).toEqual({ code: "27", name: "Maharashtra" });
    expect(stateFromGstin("24AAAPL1234C")).toBeNull();
    expect(stateFromGstin(gstin("24").slice(0, 14) + "0")).toBeNull(); // wrong check character
    expect(stateFromGstin(gstin("99"))).toBeNull(); // centre jurisdiction: no state
  });

  it("a chosen state that contradicts a valid GSTIN is an error on the state", () => {
    expect(gstinStateMismatch("Maharashtra", gstin("24"))).toBe("Your GSTIN is registered in Gujarat, not Maharashtra.");
    expect(gstinStateMismatch("27", gstin("24"))).toMatch(/Gujarat/);
    expect(gstinStateMismatch("Gujarat", gstin("24"))).toBeNull();
    expect(gstinStateMismatch("gujarat", gstin("24"))).toBeNull();
  });

  it("no state yet, no GSTIN, or a GSTIN that is not valid yet: nothing to compare", () => {
    expect(gstinStateMismatch("", gstin("24"))).toBeNull();
    expect(gstinStateMismatch("Gujarat", "")).toBeNull();
    expect(gstinStateMismatch("Gujarat", "27AAAP")).toBeNull();
    expect(gstinStateMismatch("Gujarat", gstin("99"))).toMatch(/does not name a state/);
  });
});

describe("quote follow-up selection (item 4)", () => {
  const q = (o: Partial<FollowupCandidate> & { id: string }): FollowupCandidate => ({
    email: "asha@mehta.in",
    createdAt: hoursAgo(30),
    convertedTenantId: null,
    followupSentAt: null,
    emailInUse: false,
    ...o,
  });

  it("a day-old open quote is followed up once", () => {
    expect(selectQuoteFollowups([q({ id: "a" })], NOW)).toEqual([{ id: "a", email: "asha@mehta.in", alsoStamp: [] }]);
  });

  it("waits a full day, and leaves quotes older than a week alone", () => {
    expect(selectQuoteFollowups([q({ id: "a", createdAt: hoursAgo(23) })], NOW)).toEqual([]);
    expect(selectQuoteFollowups([q({ id: "a", createdAt: hoursAgo(24 * 8) })], NOW)).toEqual([]);
  });

  it("never twice, never to a firm, never to an email that already signs in", () => {
    expect(selectQuoteFollowups([q({ id: "a", followupSentAt: hoursAgo(2) })], NOW)).toEqual([]);
    expect(selectQuoteFollowups([q({ id: "a", convertedTenantId: "t1" })], NOW)).toEqual([]);
    expect(selectQuoteFollowups([q({ id: "a", emailInUse: true })], NOW)).toEqual([]);
  });

  it("one email per person: the newest quote, the older ones settled with it", () => {
    const out = selectQuoteFollowups(
      [q({ id: "old", createdAt: hoursAgo(50) }), q({ id: "new", email: "ASHA@mehta.in ", createdAt: hoursAgo(26) })],
      NOW
    );
    expect(out).toEqual([{ id: "new", email: "asha@mehta.in", alsoStamp: ["old"] }]);
  });

  it("someone who asked again an hour ago is still deciding — no email yet", () => {
    expect(selectQuoteFollowups([q({ id: "old", createdAt: hoursAgo(50) }), q({ id: "new", createdAt: hoursAgo(1) })], NOW)).toEqual([]);
  });

  it("a person who already had a follow-up, or became a firm, is not written to again", () => {
    expect(selectQuoteFollowups([q({ id: "old", followupSentAt: hoursAgo(100) }), q({ id: "new" })], NOW)).toEqual([]);
    expect(selectQuoteFollowups([q({ id: "old", convertedTenantId: "t" }), q({ id: "new" })], NOW)).toEqual([]);
  });

  it("the email: packages, the resume link, WhatsApp, and why they got it", () => {
    const m = quoteFollowupEmail({
      contactName: "Asha Mehta",
      firmName: "Mehta <Wealth>",
      aumCrore: 300,
      users: 5,
      tierLabel: "Up to ₹500 Cr",
      cycles: [quoteCycle({ aumCrore: 300, users: 5, cycle: "yearly" }, DEFAULT_PRICING)],
      resumeUrl: resumeLink("https://crm.example/", "q-1", "tok en"),
      whatsappUrl: "https://wa.me/918200770942?text=hi",
    });
    expect(m.subject).toContain("Mehta <Wealth>");
    expect(m.text).toContain("Hi Asha,");
    expect(m.text).toContain("Yearly");
    expect(m.text).toContain("Continue where you left off: https://crm.example/pricing?quote=q-1&t=tok%20en");
    expect(m.text).toContain("Questions? WhatsApp us: https://wa.me/918200770942");
    expect(m.text.endsWith(FOLLOWUP_FOOTER)).toBe(true);
    expect(FOLLOWUP_FOOTER).toBe("You're receiving this because you asked for a price on our website.");
    expect(m.html).toContain("Mehta &lt;Wealth&gt;");
    expect(m.html).not.toContain("<Wealth>");
  });

  it("a quote's stage for Aina Admin: the furthest one wins", () => {
    expect(quoteStage({ paidAt: "x", convertedTenantId: "t", followupSentAt: "y" })).toBe("paid");
    expect(quoteStage({ paidAt: null, convertedTenantId: "t", followupSentAt: "y" })).toBe("firm_unpaid");
    expect(quoteStage({ paidAt: null, convertedTenantId: null, followupSentAt: "y" })).toBe("followed_up");
    expect(quoteStage({ paidAt: null, convertedTenantId: null, followupSentAt: null })).toBe("new");
  });
});

describe("stalled firms (item 11)", () => {
  const f = (o: Partial<StalledFirm>): StalledFirm => ({
    tenantId: "t1",
    firmName: "Mehta Wealth",
    firstPaidAt: hoursAgo(24 * 4),
    clientCount: 0,
    nudgedAt: null,
    ownerName: "Asha Mehta",
    ownerEmail: "asha@mehta.in",
    ownerMobile: "+919876500011",
    ...o,
  });

  it("paid three days ago with no clients has stalled; earlier, or with clients, has not", () => {
    expect(isStalled(f({}), NOW)).toBe(true);
    expect(isStalled(f({ firstPaidAt: hoursAgo(72) }), NOW)).toBe(true);
    expect(isStalled(f({ firstPaidAt: hoursAgo(71) }), NOW)).toBe(false);
    expect(isStalled(f({ clientCount: 1 }), NOW)).toBe(false);
  });

  it("each stalled firm is nudged once, and only with an owner to write to", () => {
    expect(selectStalledNudges([f({ tenantId: "a" }), f({ tenantId: "b", nudgedAt: hoursAgo(5) }), f({ tenantId: "c", ownerEmail: null }), f({ tenantId: "d", clientCount: 3 })], NOW).map((x) => x.tenantId)).toEqual(["a"]);
  });

  it("the nudge offers the import and the onboarding call", () => {
    const m = stalledNudgeEmail({ ownerName: "Asha Mehta", firmName: "Mehta Wealth", baseUrl: "https://crm.example", callUrl: "https://cal.example/aina" });
    expect(m.subject).toBe("Need a hand importing your clients?");
    expect(m.text).toContain("Hi Asha,");
    expect(m.text).toContain("https://crm.example/dashboard/rta-imports");
    expect(m.text).toContain("https://crm.example/dashboard/investors/import");
    expect(m.text).toContain("https://cal.example/aina");
    expect(m.html).toContain("Book your free onboarding call");
  });
});

describe("mobile code (item 12)", () => {
  const base: OtpState = { mobile_otp_hash: null, mobile_otp_expires_at: null, mobile_otp_attempts: 0, mobile_otp_sent_at: null, mobile_otp_sends: 0, mobile_verified_at: null };
  const sent = (o: Partial<OtpState> = {}): OtpState => ({
    ...base,
    mobile_otp_hash: hashOtpCode("123456"),
    mobile_otp_expires_at: new Date(NOW.getTime() + 10 * 60_000),
    mobile_otp_sent_at: NOW,
    mobile_otp_sends: 1,
    ...o,
  });

  it("is configured only with MSG91's key AND a DLT OTP template", () => {
    expect(smsOtpConfig({})).toBeNull();
    expect(smsOtpConfig({ MSG91_AUTH_KEY: "k" })).toBeNull();
    expect(smsOtpConfig({ MSG91_OTP_TEMPLATE_ID: "t" })).toBeNull();
    expect(smsOtpConfig({ MSG91_AUTH_KEY: "k", MSG91_OTP_TEMPLATE_ID: "t" })).toEqual({ authKey: "k", templateId: "t", variable: "var1", senderId: undefined });
    expect(smsOtpConfig({ MSG91_AUTH_KEY: "k", MSG91_OTP_TEMPLATE_ID: "t", MSG91_OTP_VAR: "otp" })?.variable).toBe("otp");
  });

  it("the right code within 10 minutes verifies", () => {
    expect(checkMobileOtp(sent(), "123456", NOW)).toEqual({ ok: true });
  });

  it("a wrong code says how many tries are left; the fifth wrong try ends the code", () => {
    const r = checkMobileOtp(sent({ mobile_otp_attempts: 1 }), "000000", NOW);
    expect(r).toMatchObject({ ok: false, reason: "wrong" });
    expect(!r.ok && r.message).toMatch(/3 tries left/);
    expect(checkMobileOtp(sent({ mobile_otp_attempts: 5 }), "123456", NOW)).toMatchObject({ ok: false, reason: "too_many" });
  });

  it("an expired code, or none, never verifies", () => {
    expect(checkMobileOtp(sent({ mobile_otp_expires_at: new Date(NOW.getTime() - 1) }), "123456", NOW)).toMatchObject({ ok: false, reason: "expired" });
    expect(checkMobileOtp(base, "123456", NOW)).toMatchObject({ ok: false, reason: "none" });
  });

  it("resends wait 60 seconds and stop after five; a verified mobile needs no code", () => {
    expect(canSendMobileOtp(base, NOW)).toEqual({ ok: true });
    expect(canSendMobileOtp(sent({ mobile_otp_sent_at: new Date(NOW.getTime() - 20_000) }), NOW)).toEqual({ ok: false, reason: "wait", waitSec: 40 });
    expect(canSendMobileOtp(sent({ mobile_otp_sent_at: new Date(NOW.getTime() - 61_000) }), NOW)).toEqual({ ok: true });
    expect(canSendMobileOtp(sent({ mobile_otp_sends: MOBILE_OTP_MAX_SENDS, mobile_otp_sent_at: hoursAgo(1) }), NOW)).toMatchObject({ ok: false, reason: "too_many" });
    expect(canSendMobileOtp({ ...base, mobile_verified_at: NOW }, NOW)).toMatchObject({ ok: false, reason: "verified" });
  });

  it("masks the number it was sent to", () => {
    expect(maskMobile("+919876543210")).toBe("+91 98••• ••210");
  });

  // A fake transaction: the quote row, and a record of what was written.
  const fakeTx = (row: Record<string, unknown> | undefined) => {
    const writes: string[] = [];
    const tx = {
      execute: async (q: { queryChunks?: unknown[] }) => {
        const text = JSON.stringify(q.queryChunks ?? q);
        if (text.includes("UPDATE pricing_quotes")) {
          writes.push(text);
          return { rows: [] };
        }
        return { rows: row ? [row] : [] };
      },
    };
    return { tx: tx as never, writes };
  };

  it("without SMS configured it skips — and never touches the quote", async () => {
    const { tx, writes } = fakeTx({ mobile: "+919876543210", ...base });
    expect(await sendMobileOtp(tx, "q1", { env: {}, now: NOW })).toEqual({ status: "skipped" });
    expect(writes).toEqual([]);
  });

  it("when MSG91 fails it skips (sign-up carries on, unverified) and stores no code", async () => {
    const { tx, writes } = fakeTx({ mobile: "+919876543210", ...base });
    const r = await sendMobileOtp(tx, "q1", {
      env: { MSG91_AUTH_KEY: "k", MSG91_OTP_TEMPLATE_ID: "t" },
      now: NOW,
      send: async () => {
        throw new Error("MSG91 send failed (503)");
      },
    });
    expect(r).toEqual({ status: "skipped" });
    expect(writes).toEqual([]);
  });

  it("when SMS works it texts a 6-digit code and stores only its hash", async () => {
    const { tx, writes } = fakeTx({ mobile: "+919876543210", ...base });
    let texted = "";
    const r = await sendMobileOtp(tx, "q1", {
      env: { MSG91_AUTH_KEY: "k", MSG91_OTP_TEMPLATE_ID: "t" },
      now: NOW,
      send: async ({ code }) => {
        texted = code;
      },
    });
    expect(r).toEqual({ status: "sent", sentTo: "+91 98••• ••210", resendInSec: 60 });
    expect(texted).toMatch(/^\d{6}$/);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(hashOtpCode(texted));
    expect(writes[0]).not.toContain(`"${texted}"`);
  });
});

describe("resuming a quote (item 5)", () => {
  const claimed: ClaimedQuote = {
    id: "11111111-2222-3333-4444-555555555555",
    contactName: "Asha Mehta",
    firmName: "Mehta Wealth",
    email: "asha@mehta.in",
    mobile: "+919876500011",
    arn: "ARN-123456",
    aumCrore: 300,
    users: 5,
    convertedTenantId: null,
    mobileVerifiedAt: null,
  };

  it("re-prices from the saved AUM and users with TODAY's settings", () => {
    const before = resumeQuote(claimed, "tok", DEFAULT_PRICING);
    const raised: PricingSettings = { ...DEFAULT_PRICING, perUserYearlyPaise: DEFAULT_PRICING.perUserYearlyPaise * 2 };
    const after = resumeQuote(claimed, "tok", raised);
    if (before.kind !== "open" || after.kind !== "open") throw new Error("expected open");
    const yearly = (r: typeof before) => r.cycles.find((c) => c.cycle === "yearly")!.totalPaise;
    expect(yearly(before)).toBe(quoteCycle({ aumCrore: 300, users: 5, cycle: "yearly" }, DEFAULT_PRICING).totalPaise);
    expect(yearly(after)).toBe(quoteCycle({ aumCrore: 300, users: 5, cycle: "yearly" }, raised).totalPaise);
    expect(yearly(after)).toBeGreaterThan(yearly(before));
    // A new firm's first purchase: the commitment and yearly only.
    expect(before.cycles.map((c) => c.cycle)).toEqual(["commitment", "yearly"]);
  });

  it("gives back the details step's form (mobile without +91) and the mobile's state", () => {
    const r = resumeQuote({ ...claimed, mobileVerifiedAt: NOW }, "tok", DEFAULT_PRICING);
    expect(r).toMatchObject({ kind: "open", quoteId: claimed.id, token: "tok", mobileVerified: true, form: { aumCrore: "300", users: "5", mobile: "9876500011", arn: "ARN-123456" } });
  });

  it("a quote that already became a firm says so, and nothing else", () => {
    expect(resumeQuote({ ...claimed, convertedTenantId: "t1" }, "tok", DEFAULT_PRICING)).toEqual({ kind: "converted" });
  });
});

describe("the onboarding call (item 9)", () => {
  it("uses ONBOARDING_CALL_URL when set, else WhatsApp with the agreed first message", () => {
    expect(onboardingCallUrl({ ONBOARDING_CALL_URL: "https://calendly.com/aina/onboarding" })).toBe("https://calendly.com/aina/onboarding");
    const wa = onboardingCallUrl({});
    expect(wa.startsWith("https://wa.me/918200770942?text=")).toBe(true);
    expect(decodeURIComponent(wa.split("text=")[1])).toBe(ONBOARDING_CALL_TEXT);
    expect(ONBOARDING_CALL_TEXT).toBe("Hi, I've just joined AINA CRM — I'd like to book my onboarding call.");
    expect(onboardingCallUrl({ ONBOARDING_CALL_URL: "javascript:alert(1)" })).toBe(wa);
  });

  it("is in the welcome email", () => {
    const m = welcomeEmail({
      ownerName: "Asha",
      firmName: "Mehta Wealth",
      cycleLabel: null,
      users: null,
      tierLabel: null,
      nextRenewal: null,
      nextAmountPaise: null,
      logoMissing: false,
      ndaEmailedTo: null,
      baseUrl: "https://crm.example",
      callUrl: "https://cal.example/aina",
    });
    expect(m.text).toContain("Book your free onboarding call: https://cal.example/aina");
  });
});
