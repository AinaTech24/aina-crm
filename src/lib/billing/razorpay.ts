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
export function verifyRazorpayWebhook(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Create a Razorpay customer for a tenant.
 * Uses direct fetch API with HTTP Basic Authentication.
 */
export async function createRazorpayCustomer(params: {
  name: string;
  email: string;
  contact?: string;
  notes?: Record<string, string>;
}): Promise<{ id: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (process.env.RAZORPAY_MODE !== "live" || !keyId || !keySecret) {
    return { id: `cust_stub_${Date.now()}` };
  }

  const authString = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/customers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${authString}`,
    },
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      contact: params.contact,
      notes: params.notes,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Razorpay Customer creation failed: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return { id: data.id };
}
