/**
 * Opens Razorpay Checkout for a subscription the server created, and turns its
 * callbacks into one promise. The server then verifies the returned signature
 * (POST /api/billing/verify) — nothing here is trusted on its own.
 */

export type CheckoutStart = {
  keyId: string;
  subscriptionId: string;
  amountPaise: number;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
};

export type CheckoutResult =
  | { status: "paid"; paymentId: string; subscriptionId: string; signature: string }
  | { status: "dismissed" }
  | { status: "failed"; error: string };

type RazorpayResponse = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayInstance = { open: () => void; on: (ev: string, cb: (r: { error?: { description?: string } }) => void) => void };
type RazorpayCtor = new (opts: Record<string, unknown>) => RazorpayInstance;

const SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadScript(): Promise<RazorpayCtor | null> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.onload = () => resolve((window as unknown as { Razorpay?: RazorpayCtor }).Razorpay ?? null);
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  });
}

export async function openRazorpayCheckout(start: CheckoutStart): Promise<CheckoutResult> {
  const Razorpay = await loadScript();
  if (!Razorpay) return { status: "failed", error: "Could not load the payment window. Check your connection and try again." };
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: CheckoutResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const rzp = new Razorpay({
      key: start.keyId,
      subscription_id: start.subscriptionId,
      name: "AINA CRM",
      description: start.description,
      prefill: start.prefill,
      theme: { color: "#C5202A" },
      handler: (r: RazorpayResponse) =>
        done({ status: "paid", paymentId: r.razorpay_payment_id, subscriptionId: r.razorpay_subscription_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => done({ status: "dismissed" }) },
    });
    rzp.on("payment.failed", (r) => done({ status: "failed", error: r?.error?.description ?? "The payment did not go through." }));
    rzp.open();
  });
}

/** Ask the server to verify the payment and activate. Returns where to go next. */
export async function verifyCheckout(r: Extract<CheckoutResult, { status: "paid" }>): Promise<{ ok: true; next: string } | { ok: false; error: string }> {
  const res = await fetch("/api/billing/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ razorpay_payment_id: r.paymentId, razorpay_subscription_id: r.subscriptionId, razorpay_signature: r.signature }),
  });
  const j = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
  if (!res.ok) return { ok: false, error: j.error ?? "We could not confirm the payment. If money was taken, it will be matched automatically — contact support if access does not open." };
  return { ok: true, next: j.next ?? "/dashboard/billing" };
}
