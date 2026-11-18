/**
 * The online purchase end to end, against a real database, with Razorpay
 * mocked (this sandbox cannot reach it — and a test must never call it):
 *
 *   quote → account for the chosen package → checkout → verify → activation,
 *   then a renewal auto-debit, the grace period and a late renewal.
 *
 * Proves: the amount is always recomputed on the server; a forged signature
 * is refused; activation, invoices and emails happen once per payment however
 * many times verify / the webhook repeat it; invoices are numbered without
 * gaps under concurrency and can never be edited; the quote endpoint is
 * rate-limited and honeypotted.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto, { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;
const KEY_SECRET = "test_key_secret_billing";
const WEBHOOK_SECRET = "test_webhook_secret_billing";

const session: { tenantId: string; userId: string; roles: string[]; permissions: string[]; branchId: string | null; name: string; email: string } = {
  tenantId: "",
  userId: "",
  roles: ["owner"],
  permissions: [],
  branchId: null,
  name: "Owner",
  email: "",
};
const rz = {
  plans: [] as Array<{ amountPaise: number; period: string; interval?: number }>,
  subs: [] as Array<{ planId: string; startAtUnix?: number; addons?: Array<{ name: string; amountPaise: number }> }>,
  cancelled: [] as string[],
  n: 0,
};
const mails: Array<{ to: string; subject: string; attachments?: unknown[] }> = [];

vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  requireSession: async () => session,
}));
vi.mock("@/lib/auth/rbac", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/rbac")>()), require: () => undefined }));
vi.mock("@/lib/auth/issue-session", () => ({ issueSessionToken: async () => "test-session-token" }));
vi.mock("@/lib/comms/system-email", async (orig) => ({
  ...(await orig<typeof import("@/lib/comms/system-email")>()),
  sendSystemEmail: async (a: { to: string; subject: string; attachments?: unknown[] }) => {
    mails.push(a);
    return { sent: true };
  },
}));
vi.mock("@/lib/billing/razorpay", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/razorpay")>();
  return {
    ...actual,
    razorpayConfigured: async () => true,
    razorpayPublicKeyId: async () => "rzp_test_key",
    createRazorpayPlan: async (p: { amountPaise: number; period: string; interval?: number }) => {
      rz.plans.push(p);
      return { id: `plan_t${++rz.n}` };
    },
    createRazorpaySubscription: async (p: { planId: string; startAtUnix?: number; addons?: Array<{ name: string; amountPaise: number }> }) => {
      rz.subs.push(p);
      return { id: `sub_t${++rz.n}_${randomUUID().slice(0, 6)}`, status: "created" };
    },
    cancelRazorpaySubscription: async (id: string) => {
      rz.cancelled.push(id);
      return { id, status: "cancelled" };
    },
  };
});

const sign = (payment: string, sub: string) => crypto.createHmac("sha256", KEY_SECRET).update(`${payment}|${sub}`).digest("hex");
const req = (url: string, body: unknown, ip = "198.51.100.7", headers: Record<string, string> = {}) =>
  new Request(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }) as never;
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });

describe("quote endpoint abuse controls (no database needed)", () => {
  it("answers a honeypot with a fake success and rate-limits an IP", async () => {
    const { POST } = await import("@/app/api/public/pricing/quote/route");
    const trap = { contactName: "Bot", firmName: "Bot", email: "b@x.in", mobile: "9876543210", aumCrore: 1, users: 1, website: "spam" };
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const first = await json(await POST(req("/api/public/pricing/quote", trap, ip)));
    expect(first.status).toBe(200);
    expect(first.body.quoteId).toBeNull();
    for (let i = 1; i < 20; i++) await POST(req("/api/public/pricing/quote", trap, ip));
    const blocked = await POST(req("/api/public/pricing/quote", trap, ip));
    expect(blocked.status).toBe(429);
  });
});

describe.skipIf(!TEST_DB)("buying online, renewing, grace and late payment", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const email = `buyer-${randomUUID().slice(0, 8)}@example.com`;
  const arn = `ARN-${Math.floor(100000 + Math.random() * 800000)}`;
  let quoteId = "";
  let token = "";
  let currentSub = "";
  const q = async <T = Record<string, any>>(t: ReturnType<typeof import("drizzle-orm").sql>) => (await withSystem((tx) => tx.execute(t))).rows as T[];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
  }, 60_000);

  afterAll(async () => {
    if (!withSystem || !session.tenantId) return;
    await withSystem(async (tx) => {
      await tx.execute(sql`UPDATE tenants SET deleted_at = now() WHERE id = ${session.tenantId}::uuid`);
      // Some policies cast app.tenant_id without a platform branch — name the firm.
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${session.tenantId}, true)`);
      await tx.execute(sql`SELECT platform_purge_tenant(${session.tenantId}::uuid)`);
      await tx.execute(sql`DELETE FROM pricing_quotes WHERE lower(email) = ${email}`);
    }).catch((e) => console.error("cleanup", e));
  });

  it("prices and saves a quote", async () => {
    const { POST } = await import("@/app/api/public/pricing/quote/route");
    const r = await json(await POST(req("/api/public/pricing/quote", { contactName: "Asha Mehta", firmName: "Mehta Wealth", email, mobile: "9876500011", arn, aumCrore: "300", users: 5 }, "198.51.100.21")));
    expect(r.status).toBe(200);
    quoteId = r.body.quoteId;
    token = r.body.token;
    expect(r.body.cycles.map((c: { totalPaise: number }) => c.totalPaise)).toEqual([3_097_500, 17_098_200, 31_594_500]);
    const rows = await q(sql`SELECT users, aum_crore FROM pricing_quotes WHERE id = ${quoteId}::uuid`);
    expect(rows[0]).toMatchObject({ users: 5 });
  });

  it("refuses a quote claimed with the wrong token", async () => {
    const { POST } = await import("@/app/api/public/pricing/signup/route");
    const r = await POST(req("/api/public/pricing/signup", { quoteId, token: "wrong", cycle: "yearly", password: "Secret#123", state: "Maharashtra" }, "198.51.100.22"));
    expect(r.status).toBe(404);
  });

  it("creates the firm for the chosen package and starts a server-priced checkout", async () => {
    const { POST } = await import("@/app/api/public/pricing/signup/route");
    const r = await json(await POST(req("/api/public/pricing/signup", { quoteId, token, cycle: "yearly", password: "Secret#123", state: "Maharashtra", amountPaise: 1 }, "198.51.100.23")));
    expect(r.status).toBe(200);
    expect(r.body.checkout.amountPaise).toBe(31_594_500);
    const sub = rz.subs.at(-1)!;
    expect(sub.addons?.[0].amountPaise).toBe(31_594_500);
    // First automatic debit on the next renewal, a year out.
    expect(sub.startAtUnix! * 1000 - Date.now()).toBeGreaterThan(360 * 86_400_000);
    expect(rz.plans.at(-1)).toMatchObject({ amountPaise: 31_594_500, period: "yearly" });

    const [t] = await q(sql`SELECT t.id, t.onboarding_required, s.status, s.pricing_model, s.seats_override, s.billing_cycle,
                                   u.id AS user_id
                              FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id JOIN users u ON u.tenant_id = t.id
                             WHERE lower(u.email) = ${email}`);
    expect(t).toMatchObject({ onboarding_required: true, status: "pending", pricing_model: "aum", seats_override: 5, billing_cycle: "yearly" });
    session.tenantId = t.id;
    session.userId = t.user_id;
    session.email = email;
    const [qq] = await q(sql`SELECT converted_tenant_id, chosen_cycle FROM pricing_quotes WHERE id = ${quoteId}::uuid`);
    expect(qq).toMatchObject({ converted_tenant_id: t.id, chosen_cycle: "yearly" });
  });

  it("will not create a second account from the same quote", async () => {
    const { POST } = await import("@/app/api/public/pricing/signup/route");
    const r = await POST(req("/api/public/pricing/signup", { quoteId, token, cycle: "yearly", password: "Secret#123", state: "Maharashtra" }, "198.51.100.24"));
    expect(r.status).toBe(409);
  });

  it("Billing checkout recomputes the amount; a client price is ignored", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    const r = await json(await POST(req("/api/billing/checkout", { cycle: "monthly", users: 5, aumCrore: 300, amountPaise: 100, totalPaise: 100 })));
    expect(r.status).toBe(200);
    expect(r.body.amountPaise).toBe(3_097_500);
    currentSub = r.body.subscriptionId;
  });

  it("refuses a forged signature", async () => {
    const { POST } = await import("@/app/api/billing/verify/route");
    const r = await POST(req("/api/billing/verify", { razorpay_payment_id: "pay_forged", razorpay_subscription_id: currentSub, razorpay_signature: "0".repeat(64) }));
    expect(r.status).toBe(400);
    const [s] = await q(sql`SELECT status FROM subscriptions WHERE tenant_id = ${session.tenantId}::uuid`);
    expect(s.status).toBe("pending");
  });

  it("activates once, issues one invoice and one email — however often it is repeated", async () => {
    const { POST } = await import("@/app/api/billing/verify/route");
    const pay = `pay_first_${randomUUID().slice(0, 8)}`;
    const body = { razorpay_payment_id: pay, razorpay_subscription_id: currentSub, razorpay_signature: sign(pay, currentSub) };
    const r1 = await json(await POST(req("/api/billing/verify", body)));
    expect(r1.status).toBe(200);
    expect(r1.body.next).toBe("/onboarding/setup");
    const r2 = await json(await POST(req("/api/billing/verify", body)));
    expect(r2.body.duplicate).toBe(true);

    // The webhook for the same payment, too.
    const { POST: hook } = await import("@/app/api/webhooks/razorpay/route");
    const raw = JSON.stringify({ event: "subscription.authenticated", payload: { subscription: { entity: { id: currentSub } }, payment: { entity: { id: pay, amount: 3_097_500 } } } });
    const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    expect((await hook(req("/api/webhooks/razorpay", raw, "1.1.1.1", { "x-razorpay-signature": sig, "x-razorpay-event-id": `evt_${randomUUID()}` }))).status).toBe(200);

    const [s] = await q(sql`SELECT status, billing_cycle, seats_override, license_start_at, license_end_at, mandate_status, pending_checkout, razorpay_subscription_id FROM subscriptions WHERE tenant_id = ${session.tenantId}::uuid`);
    expect(s).toMatchObject({ status: "active", billing_cycle: "monthly", seats_override: 5, mandate_status: "active", pending_checkout: null, razorpay_subscription_id: currentSub });
    const months = (new Date(s.license_end_at).getTime() - new Date(s.license_start_at).getTime()) / 86_400_000;
    expect(months).toBeGreaterThanOrEqual(28);
    expect(months).toBeLessThanOrEqual(31);

    const inv = await q(sql`SELECT invoice_no, kind, total_paise, igst_paise, cgst_paise, place_of_supply, email_status FROM billing_invoices WHERE tenant_id = ${session.tenantId}::uuid`);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ kind: "first", total_paise: 3_097_500, igst_paise: 472_500, cgst_paise: 0, email_status: "sent" });
    expect(inv[0].invoice_no).toMatch(/^AINA\/\d{4}-\d{2}\/\d{6}$/);
    expect(inv[0].place_of_supply).toMatch(/Maharashtra/);
    const sent = mails.filter((m) => m.subject.includes(inv[0].invoice_no));
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toHaveLength(1);

    // Seats bought are the user limit.
    const { loadTenantLicense } = await import("@/lib/auth/license");
    expect((await loadTenantLicense(session.tenantId, ["owner"])).maxUsers).toBe(5);
  });

  it("a renewal auto-debit extends from the due date and is invoiced once", async () => {
    const [before] = await q(sql`SELECT license_end_at FROM subscriptions WHERE tenant_id = ${session.tenantId}::uuid`);
    const { POST: hook } = await import("@/app/api/webhooks/razorpay/route");
    const pay = `pay_renew_${randomUUID().slice(0, 8)}`;
    const raw = JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: { id: currentSub } }, payment: { entity: { id: pay, amount: 3_097_500 } } } });
    const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    const evt = `evt_${randomUUID()}`;
    for (const e of [evt, evt, `evt_${randomUUID()}`]) {
      const r = await hook(req("/api/webhooks/razorpay", raw, "1.1.1.1", { "x-razorpay-signature": sig, "x-razorpay-event-id": e }));
      expect(r.status).toBe(200);
    }
    const inv = await q(sql`SELECT kind, period_start::text AS ps FROM billing_invoices WHERE razorpay_payment_id = ${pay}`);
    expect(inv).toHaveLength(1);
    expect(inv[0].kind).toBe("renewal");
    const [after] = await q(sql`SELECT license_end_at FROM subscriptions WHERE tenant_id = ${session.tenantId}::uuid`);
    expect(new Date(after.license_end_at).getTime()).toBeGreaterThan(new Date(before.license_end_at).getTime() + 27 * 86_400_000);
  });

  it("a failed mandate does not cut access; the dates and the 7-day grace do", async () => {
    const { loadTenantLicense } = await import("@/lib/auth/license");
    await q(sql`UPDATE subscriptions SET license_end_at = now() - interval '3 days', mandate_status = 'failed' WHERE tenant_id = ${session.tenantId}::uuid`);
    const g = await loadTenantLicense(session.tenantId, ["owner"]);
    expect(g.isRestricted).toBe(false);
    expect(g.renewal?.phase).toBe("grace");
    await q(sql`UPDATE subscriptions SET license_end_at = now() - interval '10 days' WHERE tenant_id = ${session.tenantId}::uuid`);
    const l = await loadTenantLicense(session.tenantId, ["owner"]);
    expect(l.isRestricted).toBe(true);
    expect(l.status).toBe("expired");
  });

  it("a late renewal adds the grace days pro-rata and starts the cycle on the payment date", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    const r = await json(await POST(req("/api/billing/checkout", { cycle: "monthly", users: 5 })));
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("late_renewal");
    expect(r.body.amountPaise).toBe(3_097_500 + 722_800);
    expect(rz.subs.at(-1)!.addons?.map((a) => a.amountPaise)).toEqual([3_097_500, 722_800]);
    const { POST: verify } = await import("@/app/api/billing/verify/route");
    const pay = `pay_late_${randomUUID().slice(0, 8)}`;
    const sub = r.body.subscriptionId as string;
    expect((await verify(req("/api/billing/verify", { razorpay_payment_id: pay, razorpay_subscription_id: sub, razorpay_signature: sign(pay, sub) }))).status).toBe(200);
    const [inv] = await q(sql`SELECT kind, total_paise, lines FROM billing_invoices WHERE razorpay_payment_id = ${pay}`);
    expect(inv.kind).toBe("late_renewal");
    expect(inv.total_paise).toBe(3_820_300);
    expect((inv.lines as Array<{ key: string; amountPaise: number }>).find((l) => l.key === "late_fee")?.amountPaise).toBe(612_500);
    const [s] = await q(sql`SELECT license_start_at FROM subscriptions WHERE tenant_id = ${session.tenantId}::uuid`);
    expect(Math.abs(new Date(s.license_start_at).getTime() - Date.now())).toBeLessThan(10 * 60_000);
    // The replaced Razorpay subscription is cancelled so it cannot debit again.
    expect(rz.cancelled).toContain(currentSub);
  });

  it("an issued invoice cannot be edited or deleted", async () => {
    await expect(q(sql`UPDATE billing_invoices SET total_paise = 1 WHERE tenant_id = ${session.tenantId}::uuid`)).rejects.toThrow();
    await expect(q(sql`DELETE FROM billing_invoices WHERE tenant_id = ${session.tenantId}::uuid`)).rejects.toThrow();
    // Email bookkeeping may move.
    await q(sql`UPDATE billing_invoices SET email_attempts = email_attempts WHERE tenant_id = ${session.tenantId}::uuid`);
  });

  it("numbers invoices without gaps under concurrency, and a rolled-back payment gives its number back", async () => {
    const { issueInvoice } = await import("@/lib/billing/invoice");
    const { invoiceFigures } = await import("@/lib/billing/invoice-core");
    const { quoteCycle } = await import("@/lib/billing/aum-pricing");
    const quote = quoteCycle({ aumCrore: 300, users: 5, cycle: "monthly" });
    const paidAt = new Date("2099-06-01T06:00:00Z"); // FY 2099-00: this test's own series
    const figures = invoiceFigures({ quote, tierLabel: quote.tierLabel, periodStart: paidAt, periodEnd: new Date("2099-07-01T06:00:00Z") });
    const one = (pid: string, fail = false) =>
      withSystem(async (tx) => {
        const r = await issueInvoice(tx, { tenantId: session.tenantId, subscriptionId: null, paymentId: pid, kind: "renewal", figures, periodStart: paidAt, periodEnd: paidAt, sac: "998314", paidAt });
        if (fail) throw new Error("payment rolled back");
        return r;
      });
    await q(sql`DELETE FROM billing_invoice_counters WHERE financial_year = '2099-00'`);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => one(`pay_seq_${i}_${randomUUID().slice(0, 6)}`)));
    await expect(one(`pay_seq_fail_${randomUUID().slice(0, 6)}`, true)).rejects.toThrow();
    const after = await one(`pay_seq_after_${randomUUID().slice(0, 6)}`);
    const seqs = [...results, after].map((r) => Number(r.invoiceNo.split("/")[2])).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(after.invoiceNo).toBe("AINA/2099-00/000007");
    // A new financial year starts again at 1.
    await q(sql`DELETE FROM billing_invoice_counters WHERE financial_year = '2098-99'`);
    const lastFy = await withSystem((tx) =>
      issueInvoice(tx, { tenantId: session.tenantId, subscriptionId: null, paymentId: `pay_fy_${randomUUID().slice(0, 6)}`, kind: "renewal", figures, periodStart: paidAt, periodEnd: paidAt, sac: "998314", paidAt: new Date("2099-03-31T12:00:00Z") })
    );
    expect(lastFy.invoiceNo).toBe("AINA/2098-99/000001");
    await q(sql`DELETE FROM billing_invoice_counters WHERE financial_year = '2098-99'`);
    // Same payment again → the same invoice.
    const again = await one(results[0] ? (await q<{ razorpay_payment_id: string }>(sql`SELECT razorpay_payment_id FROM billing_invoices WHERE invoice_no = ${results[0].invoiceNo}`))[0].razorpay_payment_id : "x");
    expect(again.created).toBe(false);
    await q(sql`DELETE FROM billing_invoice_counters WHERE financial_year = '2099-00'`);
  });

  it("splits CGST + SGST for a Gujarat firm and IGST otherwise; no GSTIN is fine", async () => {
    const { recipientFrom } = await import("@/lib/billing/invoice");
    expect(recipientFrom({ legal_name: "A", address: { state: "Gujarat", city: "Anand" }, gst_number: null, email: null })).toMatchObject({ stateCode: "24", gstin: null });
    expect(recipientFrom({ legal_name: "B", address: null, gst_number: "27AAPFU0939F1ZV", email: null })).toMatchObject({ stateCode: "27", gstin: "27AAPFU0939F1ZV" });
  });
});
