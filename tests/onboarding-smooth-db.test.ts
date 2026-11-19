/**
 * The smoother onboarding against a real database (migrations only, no seed),
 * with SMS and email mocked — a test must never text or email anyone:
 *
 *   - a quote reopens by its token, re-priced; a wrong token is refused; a
 *     converted quote answers "sign in";
 *   - the mobile code: sent, a wrong code costs a try, the right one verifies,
 *     and the owner created from the quote carries mobile_verified_at;
 *   - sign-up refuses a state that contradicts the GSTIN (on the state field);
 *   - step 1 refuses an email that already signs in;
 *   - the quote follow-up goes once, and its link reopens the quote;
 *   - a firm that paid 4 days ago with no clients is nudged once.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ensureStarterPackage } from "./helpers/starter-package";

const TEST_DB = process.env.TEST_DATABASE_URL;

const mails: Array<{ to: string; subject: string; text: string }> = [];
const texts: Array<{ recipient: string; tokens: Record<string, string> }> = [];

vi.mock("@/lib/auth/issue-session", () => ({ issueSessionToken: async () => "test-session-token" }));
vi.mock("@/lib/comms/system-email", async (orig) => ({
  ...(await orig<typeof import("@/lib/comms/system-email")>()),
  sendSystemEmail: async (a: { to: string; subject: string; text: string }) => {
    mails.push(a);
    return { sent: true };
  },
}));
vi.mock("@/lib/comms/email-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/comms/email-config")>()),
  loadEmailConfig: async () => ({ host: "smtp.test", port: 587, secure: false, user: null, pass: null, from: "t@test", configured: true, source: "env" }),
}));
vi.mock("@/lib/comms/adapters/msg91", () => ({
  smsAdapter: {
    send: async (a: { recipient: string; tokens: Record<string, string> }) => {
      texts.push({ recipient: a.recipient, tokens: a.tokens });
      return { externalId: "req_1", status: "sent" };
    },
  },
}));

const req = (url: string, body: unknown, ip: string) =>
  new Request(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }) as never;
const getReq = async (url: string, ip: string) => new (await import("next/server")).NextRequest(`http://x${url}`, { headers: { "x-forwarded-for": ip } });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const ip = () => `198.51.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;

describe.skipIf(!TEST_DB)("smooth onboarding against the database", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const tag = randomUUID().slice(0, 8);
  const buyer = `buyer-${tag}@example.com`;
  const lead = `lead-${tag}@example.com`;
  const stalledOwner = `stalled-${tag}@example.com`;
  const tenants: string[] = [];
  let quoteId = "";
  let token = "";
  const q = async <T = Record<string, any>>(t: ReturnType<typeof import("drizzle-orm").sql>) => (await withSystem((tx) => tx.execute(t))).rows as T[];
  const quoteBody = (email: string) => ({ contactName: "Asha Mehta", firmName: "Mehta Wealth", email, mobile: "9876500011", aumCrore: "300", users: 5 });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.MSG91_AUTH_KEY = "test-key";
    process.env.MSG91_OTP_TEMPLATE_ID = "test-dlt-template";
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    await ensureStarterPackage((t) => q(t), sql);
  }, 60_000);

  afterAll(async () => {
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_OTP_TEMPLATE_ID;
    if (!withSystem) return;
    for (const t of tenants) {
      await withSystem(async (tx) => {
        await tx.execute(sql`UPDATE tenants SET deleted_at = now() WHERE id = ${t}::uuid`);
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${t}, true)`);
        await tx.execute(sql`SELECT platform_purge_tenant(${t}::uuid)`);
      }).catch((e) => console.error("cleanup", e));
    }
    await withSystem((tx) => tx.execute(sql`DELETE FROM pricing_quotes WHERE lower(email) IN (${buyer}, ${lead})`)).catch(() => {});
  });

  it("saves a quote, then reopens it by its token — re-priced on the server", async () => {
    const { POST, GET } = await import("@/app/api/public/pricing/quote/route");
    const r = await json(await POST(req("/api/public/pricing/quote", quoteBody(buyer), ip())));
    expect(r.status).toBe(200);
    quoteId = r.body.quoteId;
    token = r.body.token;

    // Prices stored on the quote are a record only: tamper with them and the reopen ignores it.
    await q(sql`UPDATE pricing_quotes SET quote = jsonb_set(quote, '{cycles,0,totalPaise}', '1') WHERE id = ${quoteId}::uuid`);
    const g = await json(await GET(await getReq(`/api/public/pricing/quote?quote=${quoteId}&t=${token}`, ip())));
    expect(g.status).toBe(200);
    expect(g.body.cycles.map((c: { cycle: string; totalPaise: number }) => c.cycle)).toEqual(["commitment", "yearly"]);
    expect(g.body.cycles[0].totalPaise).toBe(r.body.cycles[0].totalPaise);
    expect(g.body.form).toMatchObject({ email: buyer, mobile: "9876500011", users: "5" });

    const bad = await GET(await getReq(`/api/public/pricing/quote?quote=${quoteId}&t=wrong`, ip()));
    expect(bad.status).toBe(404);
  });

  it("texts a code, counts a wrong one, verifies the right one", async () => {
    const { POST: code } = await import("@/app/api/public/pricing/mobile-code/route");
    const { POST: verify } = await import("@/app/api/public/pricing/mobile-verify/route");
    const s = await json(await code(req("/api/public/pricing/mobile-code", { quoteId, token }, ip())));
    expect(s.body).toMatchObject({ status: "sent", sentTo: "+91 98••• ••011" });
    const texted = texts.at(-1)!;
    expect(texted.recipient).toBe("+919876500011");
    const sentCode = texted.tokens.var1;
    expect(sentCode).toMatch(/^\d{6}$/);

    // A second ask inside a minute waits.
    const again = await json(await code(req("/api/public/pricing/mobile-code", { quoteId, token }, ip())));
    expect(again.status).toBe(429);

    const wrong = await json(await verify(req("/api/public/pricing/mobile-verify", { quoteId, token, code: sentCode === "000000" ? "111111" : "000000" }, ip())));
    expect(wrong.status).toBe(400);
    expect(wrong.body.field).toBe("mobileCode");
    const [a] = await q(sql`SELECT mobile_otp_attempts, mobile_verified_at, mobile_otp_hash FROM pricing_quotes WHERE id = ${quoteId}::uuid`);
    expect(a.mobile_otp_attempts).toBe(1);
    expect(a.mobile_verified_at).toBeNull();
    expect(a.mobile_otp_hash).not.toContain(sentCode);

    const ok = await json(await verify(req("/api/public/pricing/mobile-verify", { quoteId, token, code: sentCode }, ip())));
    expect(ok.status).toBe(200);
    const [b] = await q(sql`SELECT mobile_verified_at FROM pricing_quotes WHERE id = ${quoteId}::uuid`);
    expect(b.mobile_verified_at).not.toBeNull();
  });

  it("refuses a state that contradicts the GSTIN — on the state field", async () => {
    const { POST } = await import("@/app/api/public/pricing/signup/route");
    const { gstinCheckChar } = await import("@/lib/legal/gst");
    const g14 = "24AAAPL1234C1Z";
    const r = await json(await POST(req("/api/public/pricing/signup", { quoteId, token, cycle: "yearly", password: "Secret#123", state: "Maharashtra", gstin: g14 + gstinCheckChar(g14) }, ip())));
    expect(r.status).toBe(400);
    expect(r.body.field).toBe("state");
    expect(r.body.error).toMatch(/Gujarat/);
  });

  it("creates the firm; the owner carries the verified mobile; the quote then says sign in", async () => {
    const { POST } = await import("@/app/api/public/pricing/signup/route");
    const r = await json(await POST(req("/api/public/pricing/signup", { quoteId, token, cycle: "yearly", password: "Secret#123", state: "Maharashtra" }, ip())));
    expect(r.status).toBe(200);
    const [u] = await q(sql`SELECT tenant_id, mobile_verified_at FROM users WHERE lower(email) = ${buyer}`);
    tenants.push(u.tenant_id);
    expect(u.mobile_verified_at).not.toBeNull();

    const { GET } = await import("@/app/api/public/pricing/quote/route");
    const g = await json(await GET(await getReq(`/api/public/pricing/quote?quote=${quoteId}&t=${token}`, ip())));
    expect(g.status).toBe(409);
    expect(g.body).toMatchObject({ converted: true, signIn: "/login" });
  });

  it("step 1 catches an email that already has an account", async () => {
    const { POST } = await import("@/app/api/public/pricing/quote/route");
    const r = await json(await POST(req("/api/public/pricing/quote", quoteBody(buyer.toUpperCase()), ip())));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ field: "email", error: "An account with this email already exists.", signIn: "/login" });
    const n = await q(sql`SELECT count(*)::int AS n FROM pricing_quotes WHERE lower(email) = ${buyer}`);
    expect(n[0].n).toBe(1);
  });

  it("follows up a day-old quote once, with a link that reopens it", async () => {
    const { POST, GET } = await import("@/app/api/public/pricing/quote/route");
    const r = await json(await POST(req("/api/public/pricing/quote", quoteBody(lead), ip())));
    const leadQuote = r.body.quoteId as string;
    await q(sql`UPDATE pricing_quotes SET created_at = now() - interval '30 hours' WHERE id = ${leadQuote}::uuid`);

    const { runQuoteFollowups } = await import("@/lib/onboarding/quote-followup");
    const before = mails.length;
    await runQuoteFollowups();
    const mine = mails.slice(before).filter((m) => m.to === lead);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain("You're receiving this because you asked for a price on our website.");
    const [row] = await q(sql`SELECT followup_sent_at, resume_token_hash FROM pricing_quotes WHERE id = ${leadQuote}::uuid`);
    expect(row.followup_sent_at).not.toBeNull();

    const link = /Continue where you left off: (\S+)/.exec(mine[0].text)![1];
    const u = new URL(link);
    expect(u.searchParams.get("quote")).toBe(leadQuote);
    const g = await json(await GET(await getReq(`/api/public/pricing/quote?quote=${leadQuote}&t=${encodeURIComponent(u.searchParams.get("t")!)}`, ip())));
    expect(g.status).toBe(200);
    // The browser's own claim token keeps working beside it.
    expect((await GET(await getReq(`/api/public/pricing/quote?quote=${leadQuote}&t=${r.body.token}`, ip()))).status).toBe(200);

    await runQuoteFollowups();
    expect(mails.slice(before).filter((m) => m.to === lead)).toHaveLength(1);
  });

  it("nudges a firm that paid 4 days ago and has no clients — once", async () => {
    const { createFirmAccount } = await import("@/lib/onboarding/create-firm");
    const firm = await createFirmAccount({ firmName: `Stalled ${tag}`, arn: null, ownerName: "Ravi Shah", ownerEmail: stalledOwner, password: "Secret#123", mobile: "+919876500022" });
    tenants.push(firm.tenantId);
    const seq = 900_000 + Math.floor(Math.random() * 99_000);
    await q(sql`
      INSERT INTO billing_invoices (tenant_id, invoice_no, financial_year, seq, razorpay_payment_id, kind, issued_at, supplier, recipient,
                                    place_of_supply, sac, lines, taxable_paise, igst_paise, total_paise, amount_in_words, email_status)
      VALUES (${firm.tenantId}::uuid, ${`TEST/${tag}/${seq}`}, ${`T-${tag}`}, ${seq}, ${`pay_test_${tag}`}, 'first', now() - interval '4 days',
              '{}'::jsonb, '{}'::jsonb, 'Gujarat (24)', '998314', '[]'::jsonb, 10000, 1800, 11800, 'test', 'sent')
    `);

    const { loadPaidFirmsWithoutClients, runStalledNudges } = await import("@/lib/onboarding/stalled");
    const listed = await withSystem((tx) => loadPaidFirmsWithoutClients(tx));
    expect(listed.find((f) => f.tenantId === firm.tenantId)).toMatchObject({ ownerEmail: stalledOwner, ownerMobile: "+919876500022", nudgedAt: null });

    const before = mails.length;
    await runStalledNudges();
    const mine = mails.slice(before).filter((m) => m.to === stalledOwner);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe("Need a hand importing your clients?");
    const [t] = await q(sql`SELECT onboarding_nudged_at FROM tenants WHERE id = ${firm.tenantId}::uuid`);
    expect(t.onboarding_nudged_at).not.toBeNull();

    await runStalledNudges();
    expect(mails.slice(before).filter((m) => m.to === stalledOwner)).toHaveLength(1);
  });
});
