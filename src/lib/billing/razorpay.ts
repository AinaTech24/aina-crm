/**
 * Razorpay subscription billing — scaffold.
 *
 * Real wiring:
 *   1. Set up plans in Razorpay dashboard:
 *      - Starter:      ₹14,999/year (or ₹1,499/month)
 *      - Growth:       ₹39,999/year
 *      - Professional: ₹89,999/year
 *      - Enterprise:   custom, negotiated
 *   2. Each tenant gets a Razorpay Customer on signup completion.
 *   3. On checkout, create a Subscription with the plan_id + customer_id.
 *   4. Razorpay webhook fires on invoice paid / failed → updates
 *      tenants.status + tenants.plan + sends receipt email.
 *
 * Useful Razorpay endpoints:
 *   POST /v1/customers
 *   POST /v1/subscriptions
 *   GET  /v1/subscriptions/{id}
 *   POST /v1/subscriptions/{id}/cancel
 *   Webhook signature: X-Razorpay-Signature (HMAC SHA256)
 */

import crypto from "node:crypto";
import { loadRazorpayConfig } from "./razorpay-config";

export type RazorpayPlan = "starter" | "growth" | "professional" | "enterprise";

export type PlanConfig = {
  key: RazorpayPlan;
  name: string;
  annualPaise: number;
  monthlyPaise?: number;
  seatsIncluded: number;
  addOnSeatPriceMonthlyPaise: number;
  features: {
    workflows: boolean;
    workflowJourneys: boolean; // multi-step + branches
    whatsappBroadcast: boolean;
    emailJourneys: boolean;
    videoSessions: "none" | "limited" | "unlimited";
    aiAssistant: "none" | "tier1" | "tier2" | "tier3";
    whiteLabel: boolean;
    customReports: boolean;
    maxInvestors: number;
  };
};

export const PLANS: Record<RazorpayPlan, PlanConfig> = {
  starter: {
    key: "starter",
    name: "Starter",
    annualPaise: 14_999 * 100,
    seatsIncluded: 2,
    addOnSeatPriceMonthlyPaise: 1_000 * 100,
    features: {
      workflows: true,
      workflowJourneys: false,
      whatsappBroadcast: false,
      emailJourneys: false,
      videoSessions: "none",
      aiAssistant: "none",
      whiteLabel: false,
      customReports: false,
      maxInvestors: 200,
    },
  },
  growth: {
    key: "growth",
    name: "Growth",
    annualPaise: 39_999 * 100,
    seatsIncluded: 3,
    addOnSeatPriceMonthlyPaise: 500 * 100,
    features: {
      workflows: true,
      workflowJourneys: true,
      whatsappBroadcast: true,
      emailJourneys: true,
      videoSessions: "limited",
      aiAssistant: "tier1",
      whiteLabel: false,
      customReports: false,
      maxInvestors: 1000,
    },
  },
  professional: {
    key: "professional",
    name: "Professional",
    annualPaise: 89_999 * 100,
    seatsIncluded: 7,
    addOnSeatPriceMonthlyPaise: 400 * 100,
    features: {
      workflows: true,
      workflowJourneys: true,
      whatsappBroadcast: true,
      emailJourneys: true,
      videoSessions: "unlimited",
      aiAssistant: "tier2",
      whiteLabel: true,
      customReports: true,
      maxInvestors: 5000,
    },
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    annualPaise: 200_000 * 100,
    seatsIncluded: 15,
    addOnSeatPriceMonthlyPaise: 0, // negotiated
    features: {
      workflows: true,
      workflowJourneys: true,
      whatsappBroadcast: true,
      emailJourneys: true,
      videoSessions: "unlimited",
      aiAssistant: "tier3",
      whiteLabel: true,
      customReports: true,
      maxInvestors: Number.MAX_SAFE_INTEGER,
    },
  },
};

export function planFor(tenantPlan: string): PlanConfig {
  return PLANS[(tenantPlan ?? "starter") as RazorpayPlan] ?? PLANS.starter;
}

export function isFeatureAvailable(tenantPlan: string, feature: keyof PlanConfig["features"]): boolean {
  const p = planFor(tenantPlan);
  const v = p.features[feature];
  if (typeof v === "boolean") return v;
  return v !== "none";
}

/**
 * Verify a Razorpay webhook signature.
 */
export async function verifyRazorpayWebhook(rawBody: string, signature: string): Promise<boolean> {
  const secret = (await loadRazorpayConfig()).webhookSecret;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Verify a Razorpay subscription-checkout signature (returned to the browser by
 * Checkout.js). The HMAC is over "<payment_id>|<subscription_id>" keyed by the
 * API SECRET — confirms the mandate authorization is genuine before we trust it.
 */
export async function verifySubscriptionPayment(params: {
  razorpayPaymentId: string;
  razorpaySubscriptionId: string;
  razorpaySignature: string;
}): Promise<boolean> {
  const secret = (await loadRazorpayConfig()).keySecret;
  if (!secret) return false;
  // Subscriptions: HMAC of `payment_id|subscription_id` (note the order).
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${params.razorpayPaymentId}|${params.razorpaySubscriptionId}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(params.razorpaySignature));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API client. Razorpay TEST and LIVE share api.razorpay.com — the key PREFIX
// (rzp_test_ vs rzp_live_) selects the environment. So we call the real API
// whenever keys are present, regardless of RAZORPAY_MODE; only stub when keys
// are absent (local dev with no billing configured).
// ---------------------------------------------------------------------------

export async function razorpayConfigured(): Promise<boolean> {
  const cfg = await loadRazorpayConfig();
  return !!(cfg.keyId && cfg.keySecret);
}

export async function razorpayPublicKeyId(): Promise<string> {
  return (await loadRazorpayConfig()).keyId ?? "";
}

async function razorpayApi<T = any>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const { keyId, keySecret } = await loadRazorpayConfig();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured. Set the keys in Aina Admin → Settings → Razorpay.");
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = json?.error?.description ?? res.statusText ?? "Razorpay API error";
    throw new Error(`Razorpay ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return json as T;
}

/**
 * Create a Razorpay customer for a tenant. Real API when keys exist; otherwise
 * a deterministic stub so local dev without billing still works.
 */
export async function createRazorpayCustomer(params: {
  name: string;
  email: string;
  contact?: string;
  notes?: Record<string, string>;
}): Promise<{ id: string }> {
  if (!(await razorpayConfigured())) return { id: `cust_stub_${Date.now()}` };
  const data = await razorpayApi<{ id: string }>("/v1/customers", "POST", {
    name: params.name,
    email: params.email,
    contact: params.contact,
    notes: params.notes,
    fail_existing: 0, // reuse if a customer with this email already exists
  });
  return { id: data.id };
}

/**
 * Create a recurring Plan. Amount in paise. `period`/`interval` define the
 * cycle (e.g. yearly = period:"yearly", interval:1).
 */
export async function createRazorpayPlan(params: {
  amountPaise: number;
  period: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  name: string;
  notes?: Record<string, string>;
}): Promise<{ id: string }> {
  if (!(await razorpayConfigured())) return { id: `plan_stub_${Date.now()}` };
  const data = await razorpayApi<{ id: string }>("/v1/plans", "POST", {
    period: params.period,
    interval: params.interval ?? 1,
    item: { name: params.name, amount: params.amountPaise, currency: "INR" },
    notes: params.notes,
  });
  return { id: data.id };
}

/**
 * Create a Subscription on a plan. `startAtUnix` (seconds) defers the first
 * charge — used for trial auto-charge (mandate authorized now, first debit at
 * trial end). `totalCount` is the number of billing cycles.
 */
export async function createRazorpaySubscription(params: {
  planId: string;
  totalCount: number;
  customerNotify?: boolean;
  startAtUnix?: number;
  notes?: Record<string, string>;
}): Promise<{ id: string; short_url?: string; status?: string }> {
  if (!(await razorpayConfigured())) {
    return { id: `sub_stub_${Date.now()}`, status: "created" };
  }
  return razorpayApi("/v1/subscriptions", "POST", {
    plan_id: params.planId,
    total_count: params.totalCount,
    quantity: 1,
    customer_notify: params.customerNotify ? 1 : 0,
    ...(params.startAtUnix ? { start_at: params.startAtUnix } : {}),
    notes: params.notes,
  });
}

export async function fetchRazorpaySubscription(id: string): Promise<any> {
  if (!(await razorpayConfigured())) return { id, status: "created" };
  return razorpayApi(`/v1/subscriptions/${id}`, "GET");
}

export async function cancelRazorpaySubscription(id: string, atCycleEnd = false): Promise<any> {
  if (!(await razorpayConfigured())) return { id, status: "cancelled" };
  return razorpayApi(`/v1/subscriptions/${id}/cancel`, "POST", { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
}

/**
 * The firm's ANNUAL charge in paise, from its package + subscription:
 *   base yearly  +  (seats × per-user yearly)
 * Seats = the firm's seat override, else the package's max users. Add-on
 * features are billed separately when purchased (future), not here.
 */
export function computeAnnualAmountPaise(
  pkg: { yearlyPricePaise?: number | null; perUserYearlyPaise?: number | null; maxUsers?: number | null },
  sub: { seatsOverride?: number | null }
): { amountPaise: number; seats: number } {
  const seats = Math.max(1, sub.seatsOverride ?? pkg.maxUsers ?? 1);
  const base = pkg.yearlyPricePaise ?? 0;
  const perUser = pkg.perUserYearlyPaise ?? 0;
  return { amountPaise: base + seats * perUser, seats };
}
