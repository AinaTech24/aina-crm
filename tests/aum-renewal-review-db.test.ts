/**
 * Renewal priced from the AUM the CRM holds (rule B): 7 days before a renewal
 * the tier is re-decided from the firm's AUM — up and down — recorded once,
 * applied from the NEXT cycle only, with the declared AUM kept (and said) when
 * the CRM has no AUM. Razorpay is mocked.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ensureStarterPackage } from "./helpers/starter-package";

const TEST_DB = process.env.TEST_DATABASE_URL;
const rz = { updates: [] as Array<{ id: string; planId: string }>, refuse: false, n: 0 };
const mails: Array<{ to: string; subject: string }> = [];

vi.mock("@/lib/billing/razorpay", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/razorpay")>()),
  createRazorpayPlan: async () => ({ id: `plan_rr_${++rz.n}` }),
  updateRazorpaySubscriptionPlan: async (id: string, planId: string) => {
    if (rz.refuse) throw new Error("Razorpay: update not supported for this payment method");
    rz.updates.push({ id, planId });
    return { id };
  },
}));
vi.mock("@/lib/comms/system-email", async (orig) => ({
  ...(await orig<typeof import("@/lib/comms/system-email")>()),
  sendSystemEmail: async (a: { to: string; subject: string }) => {
    mails.push(a);
    return { sent: true };
  },
}));

describe.skipIf(!TEST_DB)("renewal review", () => {
  const tenant = randomUUID();
  const owner = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let reviewRenewal: typeof import("@/lib/billing/renewal-review").reviewRenewal;
  const q = async (t: ReturnType<typeof import("drizzle-orm").sql>) => (await withSystem((tx) => tx.execute(t))).rows as Array<Record<string, any>>;
  const sub = async () => (await q(sql`SELECT aum_tier_key, cycle_total_paise, next_cycle, license_end_at FROM subscriptions WHERE tenant_id = ${tenant}::uuid`))[0];
  const snapshot = (crore: number) =>
    q(sql`INSERT INTO firm_snapshots (tenant_id, snapshot_date, total_aum) VALUES (${tenant}::uuid, (now() AT TIME ZONE 'Asia/Kolkata')::date, ${crore * 1e7})
          ON CONFLICT (tenant_id, snapshot_date) DO UPDATE SET total_aum = EXCLUDED.total_aum`);
  const dueIn = (days: number) => q(sql`UPDATE subscriptions SET license_end_at = now() + make_interval(days => ${days}::int) WHERE tenant_id = ${tenant}::uuid`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    await ensureStarterPackage((t) => q(t), sql);
    ({ reviewRenewal } = await import("@/lib/billing/renewal-review"));
    const { quoteCycle } = await import("@/lib/billing/aum-pricing");
    const quote = quoteCycle({ aumCrore: 300, users: 5, cycle: "monthly" });
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Review Wealth', 'Review Wealth', ${"ARN-RR-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${tenant}::uuid, ${"rr-" + tenant.slice(0, 6) + "@example.com"}, 'Rhea', ARRAY['owner']::text[], 'active')`);
    await q(sql`
      INSERT INTO subscriptions (tenant_id, package_id, package_key, status, billing_cycle, pricing_model, seats_override,
                                 declared_aum_crore, aum_crore_in_force, aum_source, aum_tier_key, monthly_base_paise,
                                 cycle_total_paise, cycle_quote, license_start_at, license_end_at, razorpay_subscription_id, mandate_status)
      SELECT ${tenant}::uuid, id, key, 'active', 'monthly', 'aum', 5, 300, 300, 'declared', 'upto_500', ${quote.monthlyBasePaise},
             ${quote.totalPaise}, ${JSON.stringify(quote)}::jsonb, now() - interval '25 days', now() + interval '5 days', 'sub_rr_live', 'active'
        FROM packages ORDER BY (key = 'starter') DESC LIMIT 1`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await withSystem(async (tx) => {
      await tx.execute(sql`UPDATE tenants SET deleted_at = now() WHERE id = ${tenant}::uuid`);
      // Some policies cast app.tenant_id without a platform branch — name the firm.
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant}, true)`);
      await tx.execute(sql`SELECT platform_purge_tenant(${tenant}::uuid)`);
    }).catch((e) => console.error("cleanup", e));
  });

  it("is not due more than 7 days ahead", async () => {
    await dueIn(20);
    expect(await reviewRenewal(tenant)).toMatchObject({ status: "skipped", reason: "not_due" });
    await dueIn(5);
  });

  it("no AUM in the CRM: keeps the declared AUM and says so — never zero", async () => {
    const r = await reviewRenewal(tenant);
    expect(r).toMatchObject({ status: "reviewed", changed: false, tierChanged: false });
    if (r.status !== "reviewed") return;
    expect(r.aum).toMatchObject({ source: "declared", aumCrore: 300 });
    const { aumSourceText } = await import("@/lib/billing/renewal-review");
    expect(aumSourceText(r.aum)).toMatch(/declared/);
    expect(rz.updates).toHaveLength(0);
  });

  it("a re-run for the same renewal does nothing", async () => {
    const before = mails.length;
    expect(await reviewRenewal(tenant)).toMatchObject({ status: "skipped", reason: "already_reviewed" });
    const rows = await q(sql`SELECT count(*)::int AS n FROM billing_renewal_reviews WHERE tenant_id = ${tenant}::uuid`);
    expect(rows[0].n).toBe(1);
    expect(mails.length).toBe(before);
  });

  it("AUM up: the next cycle moves up a tier, from the next cycle only", async () => {
    await snapshot(750);
    await dueIn(4); // a new renewal date
    const r = await reviewRenewal(tenant);
    expect(r).toMatchObject({ status: "reviewed", changed: true, tierChanged: true });
    const s = await sub();
    expect(s.aum_tier_key).toBe("upto_500"); // in force: unchanged mid-cycle
    expect(s.cycle_total_paise).toBe(3_097_500);
    expect(s.next_cycle).toMatchObject({ tierKey: "upto_1000", aumSource: "crm_snapshot", aumCrore: 750, razorpayAction: "updated" });
    expect(rz.updates.at(-1)?.id).toBe("sub_rr_live");
    const notes = await q(sql`SELECT title FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'billing.renewal_repriced'`);
    expect(notes.length).toBe(1);
    expect(mails.at(-1)?.subject).toMatch(/₹500 – 1,000 Cr/);
    const audit = await q(sql`SELECT after FROM audit_log WHERE tenant_id = ${tenant}::uuid AND action = 'billing.renewal_repriced' ORDER BY at DESC LIMIT 1`);
    expect(audit[0].after).toMatchObject({ tier: "upto_1000", aumSource: "crm_snapshot" });
  });

  it("the renewal debit at the new price applies the new tier", async () => {
    const { recordRenewalCharge } = await import("@/lib/billing/payments");
    const { DEFAULT_PRICING } = await import("@/lib/billing/aum-pricing");
    const next = (await sub()).next_cycle as { quote: { totalPaise: number } };
    await withSystem((tx) => recordRenewalCharge(tx, { razorpaySubscriptionId: "sub_rr_live", paymentId: `pay_rr_${randomUUID().slice(0, 6)}`, amountPaise: next.quote.totalPaise, settings: DEFAULT_PRICING }));
    const s = await sub();
    expect(s.aum_tier_key).toBe("upto_1000");
    expect(s.cycle_total_paise).toBe(next.quote.totalPaise);
    expect(s.next_cycle).toBeNull();
  });

  it("AUM down: the next renewal moves down a tier; a refused mandate update asks for re-authorisation", async () => {
    await snapshot(50);
    rz.refuse = true;
    const end = new Date((await sub()).license_end_at);
    const r = await reviewRenewal(tenant, { now: new Date(end.getTime() - 3 * 86_400_000) });
    expect(r).toMatchObject({ status: "reviewed", tierChanged: true });
    expect((await sub()).next_cycle).toMatchObject({ tierKey: "upto_500", razorpayAction: "reauth_required" });
    rz.refuse = false;
  });
});

/**
 * The end of a 6-month commitment (the owner's rule of 2026-11-18): 7 days
 * before it, the owner is asked to choose (in-app + email); with no choice the
 * firm continues MONTHLY — the Razorpay plan the checkout already made, so it
 * is not switched — and the owner's choice, when made, is honoured through the
 * plan-change path.
 */
describe.skipIf(!TEST_DB)("end of the 6-month commitment", () => {
  const tenant = randomUUID();
  const owner = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let reviewRenewal: typeof import("@/lib/billing/renewal-review").reviewRenewal;
  const q = async (t: ReturnType<typeof import("drizzle-orm").sql>) => (await withSystem((tx) => tx.execute(t))).rows as Array<Record<string, any>>;
  const sub = async () =>
    (await q(sql`SELECT billing_cycle, cycle_total_paise, next_cycle, license_end_at, razorpay_plan_paise, scheduled_change FROM subscriptions WHERE tenant_id = ${tenant}::uuid`))[0];
  const monthly = 3_097_500;
  const yearly = 31_594_500;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ reviewRenewal } = await import("@/lib/billing/renewal-review"));
    await ensureStarterPackage((t) => q(t), sql);
    const { quoteCycle } = await import("@/lib/billing/aum-pricing");
    const quote = quoteCycle({ aumCrore: 300, users: 5, cycle: "commitment" });
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Commit Wealth', 'Commit Wealth', ${"ARN-CM-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${tenant}::uuid, ${"cm-" + tenant.slice(0, 6) + "@example.com"}, 'Kavya', ARRAY['owner']::text[], 'active')`);
    await q(sql`
      INSERT INTO subscriptions (tenant_id, package_id, package_key, status, billing_cycle, pricing_model, seats_override,
                                 declared_aum_crore, aum_crore_in_force, aum_source, aum_tier_key, monthly_base_paise,
                                 cycle_total_paise, cycle_quote, license_start_at, license_end_at, razorpay_subscription_id,
                                 razorpay_plan_paise, mandate_status, last_payment_at)
      SELECT ${tenant}::uuid, id, key, 'active', 'commitment', 'aum', 5, 300, 300, 'declared', 'upto_500', ${quote.monthlyBasePaise},
             ${quote.totalPaise}, ${JSON.stringify(quote)}::jsonb, now() - interval '175 days', now() + interval '5 days', 'sub_cm_live',
             ${monthly}, 'active', now() - interval '175 days'
        FROM packages ORDER BY (key = 'starter') DESC LIMIT 1`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await withSystem(async (tx) => {
      await tx.execute(sql`UPDATE tenants SET deleted_at = now() WHERE id = ${tenant}::uuid`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant}, true)`);
      await tx.execute(sql`SELECT platform_purge_tenant(${tenant}::uuid)`);
    }).catch((e) => console.error("cleanup", e));
  });

  it("7 days before: asks the owner to choose, defaults to monthly, and leaves the monthly Razorpay plan alone", async () => {
    const updatesBefore = rz.updates.length;
    const r = await reviewRenewal(tenant);
    expect(r).toMatchObject({ status: "reviewed", commitmentEnding: true, changed: true });
    const s = await sub();
    expect(s.billing_cycle).toBe("commitment"); // in force until it ends
    expect(s.next_cycle).toMatchObject({ cycle: "monthly", razorpayAction: "none" });
    expect(s.next_cycle.quote.totalPaise).toBe(monthly);
    expect(rz.updates.length).toBe(updatesBefore);
    const notes = await q(sql`SELECT title, body FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'billing.commitment_ending'`);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/6-month commitment ends on .* choose how to continue/);
    expect(notes[0].body).toMatch(/continues monthly at ₹30,975/);
    expect(mails.at(-1)?.subject).toMatch(/6-month commitment ends on/);
  });

  it("the owner's choice is honoured: the plan moves to yearly from the commitment's end", async () => {
    const { scheduleChange } = await import("@/lib/billing/change");
    const { DEFAULT_PRICING } = await import("@/lib/billing/aum-pricing");
    // The commitment is never something to change to.
    await expect(scheduleChange(tenant, { cycle: "commitment", users: 5 }, DEFAULT_PRICING, owner)).rejects.toThrow(/monthly, half-yearly or yearly/);
    const r = await scheduleChange(tenant, { cycle: "yearly", users: 5 }, DEFAULT_PRICING, owner);
    expect(r.review).toMatchObject({ status: "reviewed", commitmentEnding: true });
    const s = await sub();
    expect(s.next_cycle).toMatchObject({ cycle: "yearly", razorpayAction: "updated" });
    expect(s.next_cycle.quote.totalPaise).toBe(yearly);
    expect(s.razorpay_plan_paise).toBe(yearly);
    expect(rz.updates.at(-1)?.id).toBe("sub_cm_live");
    const notes = await q(sql`SELECT body FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'billing.commitment_ending' ORDER BY created_at DESC LIMIT 1`);
    expect(notes[0].body).toMatch(/You chose yearly/);

    // The debit at the yearly price starts a 12-month cycle on yearly.
    const { recordRenewalCharge } = await import("@/lib/billing/payments");
    const before = new Date(s.license_end_at);
    await withSystem((tx) => recordRenewalCharge(tx, { razorpaySubscriptionId: "sub_cm_live", paymentId: `pay_cm_${randomUUID().slice(0, 6)}`, amountPaise: yearly, settings: DEFAULT_PRICING }));
    const after = await sub();
    expect(after).toMatchObject({ billing_cycle: "yearly", cycle_total_paise: yearly, next_cycle: null, scheduled_change: null });
    const days = (new Date(after.license_end_at).getTime() - before.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(364);
    expect(days).toBeLessThanOrEqual(366);
    const inv = await q(sql`SELECT kind, total_paise FROM billing_invoices WHERE tenant_id = ${tenant}::uuid`);
    expect(inv).toEqual([{ kind: "renewal", total_paise: yearly }]);
  });
});
