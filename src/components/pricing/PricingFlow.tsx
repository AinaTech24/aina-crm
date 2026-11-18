"use client";

/**
 * "Get pricing" — three steps on one page, mobile first:
 *   1. the firm's AUM, users and contact details → the server prices it and saves the quote;
 *   2. three packages side by side (Monthly · Half-yearly · Yearly);
 *   3. create the firm's account for the chosen package, then pay in Razorpay
 *      Checkout. The server verifies the payment and opens the setup wizard.
 * Every figure shown comes from the server; nothing typed here sets a price.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PackageCards } from "@/components/billing/PackageCards";
import { openRazorpayCheckout, verifyCheckout, type CheckoutStart } from "@/components/billing/razorpay-checkout";
import { CYCLE_LABEL, inr, type CycleKey, type CycleQuote } from "@/lib/billing/aum-pricing";
import { GST_STATES } from "@/lib/legal/gst";

type Quote = { quoteId: string | null; token: string | null; cycles: CycleQuote[]; tierLabel: string; onlineSignup: boolean };
type Step = "details" | "packages" | "account" | "done";

export function PricingFlow() {
  const [step, setStep] = useState<Step>("details");
  const [form, setForm] = useState({ aumCrore: "", users: "1", contactName: "", firmName: "", email: "", mobile: "", arn: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [cycle, setCycle] = useState<CycleKey>("yearly");
  const [account, setAccount] = useState({ password: "", state: "", gstin: "" });
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string; next?: string } | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  async function getQuote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setNotice(null);
    try {
      const r = await fetch("/api/public/pricing/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, users: Number(form.users) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.field) setErrors({ [j.field]: j.error });
        else setNotice({ tone: "error", text: j.error ?? "Could not price that — please try again." });
        return;
      }
      setQuote(j as Quote);
      setStep("packages");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!quote?.quoteId || !quote.token) return;
    setBusy(true);
    setErrors({});
    setNotice(null);
    try {
      const r = await fetch("/api/public/pricing/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId, token: quote.token, cycle, ...account }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; field?: string; checkout?: CheckoutStart; next?: string; paymentsOff?: boolean };
      if (!r.ok) {
        if (j.field) setErrors({ [j.field]: j.error ?? "Please check this" });
        else setNotice({ tone: "error", text: j.error ?? "Could not create the account." });
        return;
      }
      if (!j.checkout) {
        setStep("done");
        setNotice({
          tone: "info",
          text: j.paymentsOff
            ? "Your account is ready. Online payment is not switched on yet — finish from Billing once it is, or write to us."
            : "Your account is ready. Finish the payment from Billing.",
          next: j.next ?? "/dashboard/billing",
        });
        return;
      }
      await pay(j.checkout);
    } finally {
      setBusy(false);
    }
  }

  async function pay(start: CheckoutStart) {
    const res = await openRazorpayCheckout({ ...start, prefill: { name: form.contactName, email: form.email, contact: form.mobile } });
    if (res.status === "paid") {
      const v = await verifyCheckout(res);
      if (v.ok) {
        window.location.assign(v.next);
        return;
      }
      setStep("done");
      setNotice({ tone: "error", text: v.error, next: "/dashboard/billing" });
      return;
    }
    setStep("done");
    setNotice({
      tone: res.status === "failed" ? "error" : "info",
      text:
        (res.status === "failed" ? `${res.error} ` : "") +
        "Your account is created. You can finish the payment from Billing at any time — your package is saved there.",
      next: "/dashboard/billing",
    });
  }

  const chosen = quote?.cycles.find((q) => q.cycle === cycle) ?? null;

  return (
    <div className="space-y-6">
      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm" : "rounded-xl border border-border bg-secondary/70 p-4 text-sm"}>
          <p>{notice.text}</p>
          {notice.next && (
            <Link href={notice.next} className="mt-2 inline-flex items-center gap-1 font-semibold text-primary">
              Go to Billing <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      )}

      {step === "details" && (
        <form onSubmit={getQuote} className="card-surface p-5 sm:p-6 space-y-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your AUM (₹ crore)" required hint="Assets under management, roughly. Firms under ₹100 Cr pay the first tier." error={errors.aumCrore}>
              {(id, d, inv) => (
                <input id={id} aria-describedby={d} aria-invalid={inv} inputMode="decimal" className="input-base" value={form.aumCrore} onChange={(e) => set("aumCrore", e.target.value)} placeholder="e.g. 300" required />
              )}
            </Field>
            <Field label="CRM users" required hint="People in your firm who will sign in." error={errors.users}>
              {(id, d, inv) => (
                <input id={id} aria-describedby={d} aria-invalid={inv} inputMode="numeric" className="input-base" value={form.users} onChange={(e) => set("users", e.target.value.replace(/\D/g, ""))} required />
              )}
            </Field>
            <Field label="Your name" required error={errors.contactName}>
              {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="input-base" autoComplete="name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} required />}
            </Field>
            <Field label="Firm name" required error={errors.firmName}>
              {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="input-base" autoComplete="organization" value={form.firmName} onChange={(e) => set("firmName", e.target.value)} required />}
            </Field>
            <Field label="Email" required error={errors.email}>
              {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} type="email" className="input-base" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />}
            </Field>
            <Field label="Mobile" required error={errors.mobile}>
              {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} type="tel" inputMode="tel" className="input-base" autoComplete="tel" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="98765 43210" required />}
            </Field>
            <Field label="ARN" optional error={errors.arn}>
              {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="input-base" value={form.arn} onChange={(e) => set("arn", e.target.value)} placeholder="ARN-123456" />}
            </Field>
          </div>
          {/* Honeypot — hidden from people, filled by bots. */}
          <div aria-hidden className="hidden">
            <label htmlFor="pricing-website">Website</label>
            <input id="pricing-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Prices exclude GST; we add 18% and show it line by line.</p>
            <Button type="submit" variant="primary" loading={busy} icon={<ArrowRight className="size-4" />}>
              See my packages
            </Button>
          </div>
        </form>
      )}

      {step === "packages" && quote && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              For <strong className="text-foreground">{form.firmName}</strong> · ₹{form.aumCrore} Cr ({quote.tierLabel}) · {form.users} user{form.users === "1" ? "" : "s"}
            </p>
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("details")}>
              Change
            </Button>
          </div>
          <PackageCards
            quotes={quote.cycles}
            tierLabel={quote.tierLabel}
            onChoose={(c) => {
              setCycle(c);
              setStep("account");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            disabled={!quote.onlineSignup || !quote.quoteId}
          />
          {!quote.onlineSignup && (
            <p className="text-sm text-muted-foreground">
              Online sign-up is paused right now — we have your details and will be in touch, or write to support@ainatech.in.
            </p>
          )}
        </div>
      )}

      {step === "account" && quote && chosen && (
        <form onSubmit={createAccount} className="card-surface p-5 sm:p-6 space-y-5" noValidate>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Create your firm&apos;s account</h2>
              <p className="section-subtitle mt-0.5">
                {CYCLE_LABEL[chosen.cycle]} · {chosen.users} user{chosen.users === 1 ? "" : "s"} · {inr(chosen.totalPaise)} incl. GST every{" "}
                {chosen.months === 1 ? "month" : `${chosen.months} months`}
              </p>
            </div>
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("packages")}>
              Packages
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sign-in email">
              {(id) => <input id={id} className="input-base" value={form.email} disabled />}
            </Field>
            <Field label="Choose a password" required hint="At least 8 characters." error={errors.password}>
              {(id, d, inv) => (
                <PasswordInput id={id} aria-describedby={d} aria-invalid={inv} autoComplete="new-password" value={account.password} onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))} required />
              )}
            </Field>
            <Field label="Your firm's state" required hint="For your GST tax invoice." error={errors.state}>
              {(id, d, inv) => (
                <select id={id} aria-describedby={d} aria-invalid={inv} className="input-base" value={account.state} onChange={(e) => setAccount((a) => ({ ...a, state: e.target.value }))} required>
                  <option value="">Select…</option>
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="GSTIN" optional hint="Leave blank if your firm is not GST-registered." error={errors.gstin}>
              {(id, d, inv) => (
                <input id={id} aria-describedby={d} aria-invalid={inv} className="input-base uppercase" value={account.gstin} onChange={(e) => setAccount((a) => ({ ...a, gstin: e.target.value.toUpperCase() }))} maxLength={15} />
              )}
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            You will accept the <Link className="text-primary underline" href="/terms" target="_blank">Terms of Service</Link> and sign the
            NDA during setup, right after payment. The mandate renews automatically; you can change the package from Billing.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" /> Secure payment by Razorpay
            </span>
            <Button type="submit" variant="primary" loading={busy}>
              Create account &amp; pay {inr(chosen.totalPaise)}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
