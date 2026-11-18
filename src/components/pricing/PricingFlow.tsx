"use client";

/**
 * "Get pricing" — three steps on one page, mobile first:
 *   1. the firm's AUM, users and contact details → the server prices it and saves the quote;
 *   2. the packages a new firm may buy: the 6-month commitment and Yearly
 *      (monthly and half-yearly open up after the commitment);
 *   3. create the firm's account for the chosen package, then pay in Razorpay
 *      Checkout. The server verifies the payment and opens the setup wizard.
 * Every figure shown comes from the server; nothing typed here sets a price.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, FileText, Lock, Minus, Plus, ReceiptText, ShieldCheck } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PackageCards } from "@/components/billing/PackageCards";
import { openRazorpayCheckout, verifyCheckout, type CheckoutStart } from "@/components/billing/razorpay-checkout";
import { cycleLabel, inr, type CycleKey, type CycleQuote } from "@/lib/billing/aum-pricing";
import { GST_STATES } from "@/lib/legal/gst";
import { cn } from "@/lib/utils";

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
  const users = Math.max(1, Number(form.users) || 1);
  const stepIndex = step === "details" ? 0 : step === "packages" ? 1 : 2;

  return (
    <div className="space-y-8">
      <Stepper current={stepIndex} />

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-2xl border p-4 text-sm",
            notice.tone === "error" ? "border-site-crimson/30 bg-site-crimson/5 text-site-text" : "border-site-sand bg-site-paper text-site-text",
          )}
        >
          <p>{notice.text}</p>
          {notice.next && (
            <Link href={notice.next} className="mt-2 inline-flex items-center gap-1 font-semibold text-site-crimson">
              Go to Billing <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      )}

      {step === "details" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <form onSubmit={getQuote} className={CARD} noValidate>
            <div className="space-y-6">
              <fieldset className="space-y-4">
                <legend className={cn(LEGEND, "float-left w-full mb-4")}>Your practice</legend>
                <div className="clear-both grid gap-4 sm:grid-cols-2">
                  <Field label="Your AUM" required hint="Assets under management, roughly." error={errors.aumCrore}>
                    {(id, d, inv) => (
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-site-muted">₹</span>
                        <input
                          id={id}
                          aria-describedby={d}
                          aria-invalid={inv}
                          inputMode="decimal"
                          className="input-base pl-7 pr-12 text-base font-semibold"
                          value={form.aumCrore}
                          onChange={(e) => set("aumCrore", e.target.value)}
                          placeholder="e.g. 300"
                          required
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-site-muted">Cr</span>
                      </div>
                    )}
                  </Field>
                  <Field label="CRM users" required hint="People in your firm who will sign in." error={errors.users}>
                    {(id, d, inv) => (
                      <div className="flex items-stretch gap-2">
                        <button type="button" aria-label="Fewer users" className={STEP_BTN} disabled={users <= 1} onClick={() => set("users", String(users - 1))}>
                          <Minus className="size-4" />
                        </button>
                        <input
                          id={id}
                          aria-describedby={d}
                          aria-invalid={inv}
                          inputMode="numeric"
                          className="input-base text-center text-base font-semibold"
                          value={form.users}
                          onChange={(e) => set("users", e.target.value.replace(/\D/g, ""))}
                          required
                        />
                        <button type="button" aria-label="More users" className={STEP_BTN} onClick={() => set("users", String(users + 1))}>
                          <Plus className="size-4" />
                        </button>
                      </div>
                    )}
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-site-muted">Quick pick:</span>
                  {AUM_PICKS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => set("aumCrore", String(v))}
                      aria-pressed={form.aumCrore === String(v)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition",
                        form.aumCrore === String(v) ? "border-site-ink bg-site-ink text-white" : "border-site-sand bg-white text-site-text hover:border-site-ink/40",
                      )}
                    >
                      ₹{v.toLocaleString("en-IN")} Cr
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-4 border-t border-site-sand pt-6">
                <legend className={cn(LEGEND, "float-left w-full mb-4")}>About you</legend>
                <div className="clear-both grid gap-4 sm:grid-cols-2">
                  <Field label="Your name" required error={errors.contactName}>
                    {(id, d, inv) => (
                      <input
                        id={id}
                        aria-describedby={d}
                        aria-invalid={inv}
                        className="input-base"
                        autoComplete="name"
                        value={form.contactName}
                        onChange={(e) => set("contactName", e.target.value)}
                        required
                      />
                    )}
                  </Field>
                  <Field label="Firm name" required error={errors.firmName}>
                    {(id, d, inv) => (
                      <input
                        id={id}
                        aria-describedby={d}
                        aria-invalid={inv}
                        className="input-base"
                        autoComplete="organization"
                        value={form.firmName}
                        onChange={(e) => set("firmName", e.target.value)}
                        required
                      />
                    )}
                  </Field>
                  <Field label="Email" required error={errors.email}>
                    {(id, d, inv) => (
                      <input
                        id={id}
                        aria-describedby={d}
                        aria-invalid={inv}
                        type="email"
                        className="input-base"
                        autoComplete="email"
                        value={form.email}
                        onChange={(e) => set("email", e.target.value)}
                        required
                      />
                    )}
                  </Field>
                  <Field label="Mobile" required error={errors.mobile}>
                    {(id, d, inv) => (
                      <input
                        id={id}
                        aria-describedby={d}
                        aria-invalid={inv}
                        type="tel"
                        inputMode="tel"
                        className="input-base"
                        autoComplete="tel"
                        value={form.mobile}
                        onChange={(e) => set("mobile", e.target.value)}
                        placeholder="98765 43210"
                        required
                      />
                    )}
                  </Field>
                  <Field label="ARN" optional error={errors.arn}>
                    {(id, d, inv) => (
                      <input
                        id={id}
                        aria-describedby={d}
                        aria-invalid={inv}
                        className="input-base"
                        value={form.arn}
                        onChange={(e) => set("arn", e.target.value)}
                        placeholder="ARN-123456"
                      />
                    )}
                  </Field>
                </div>
              </fieldset>
            </div>
            {/* Honeypot — hidden from people, filled by bots. */}
            <div aria-hidden className="hidden">
              <label htmlFor="pricing-website">Website</label>
              <input id="pricing-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-site-sand pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-site-muted">No payment yet — you&apos;ll see your packages first.</p>
              <button type="submit" disabled={busy} className={PRIMARY}>
                {busy ? "Working out your price…" : "See my packages"} <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          </form>

          <aside className="space-y-4">
            <div className="rounded-3xl bg-site-ink p-6 text-white">
              <h2 className="font-brand text-lg font-bold">How it works</h2>
              <ol className="mt-4 space-y-4">
                {HOW.map((h, i) => (
                  <li key={h.t} className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-site-rose">{i + 1}</span>
                    <div>
                      <p className="font-semibold">{h.t}</p>
                      <p className="mt-0.5 text-sm text-white/70">{h.d}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <ul className="space-y-3 rounded-3xl border border-site-sand bg-site-paper p-6 text-sm">
              {TRUST.map(({ icon: Icon, t }) => (
                <li key={t} className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-site-crimson" aria-hidden />
                  <span className="text-site-text">{t}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}

      {step === "packages" && quote && (
        <div className="space-y-6">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-site-sand bg-site-paper px-5 py-3">
            <p className="text-sm text-site-muted">
              Prices for <strong className="text-site-ink">{form.firmName}</strong>
              <span className="mx-2 text-site-sand">|</span>₹{form.aumCrore} Cr · {quote.tierLabel}
              <span className="mx-2 text-site-sand">|</span>
              {form.users} user{form.users === "1" ? "" : "s"}
            </p>
            <button type="button" className={GHOST} onClick={() => setStep("details")}>
              <ArrowLeft className="size-4" aria-hidden /> Edit details
            </button>
          </div>
          <PackageCards
            appearance="site"
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
            <p className="mx-auto max-w-4xl text-sm text-site-muted">
              Online sign-up is paused right now — we have your details and will be in touch, or write to support@ainatech.in.
            </p>
          )}
        </div>
      )}

      {step === "account" && quote && chosen && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <form onSubmit={createAccount} className={CARD} noValidate>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-brand text-xl font-bold text-site-ink">Create your firm&apos;s account</h2>
                <p className="mt-1 text-sm text-site-muted">You&apos;ll sign in with this email after payment.</p>
              </div>
              <button type="button" className={GHOST} onClick={() => setStep("packages")}>
                <ArrowLeft className="size-4" aria-hidden /> Packages
              </button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Sign-in email">{(id) => <input id={id} className="input-base" value={form.email} disabled />}</Field>
              <Field label="Choose a password" required hint="At least 8 characters." error={errors.password}>
                {(id, d, inv) => (
                  <PasswordInput
                    id={id}
                    aria-describedby={d}
                    aria-invalid={inv}
                    autoComplete="new-password"
                    value={account.password}
                    onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))}
                    required
                  />
                )}
              </Field>
              <Field label="Your firm's state" required hint="For your GST tax invoice." error={errors.state}>
                {(id, d, inv) => (
                  <select
                    id={id}
                    aria-describedby={d}
                    aria-invalid={inv}
                    className="input-base"
                    value={account.state}
                    onChange={(e) => setAccount((a) => ({ ...a, state: e.target.value }))}
                    required
                  >
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
                  <input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={inv}
                    className="input-base uppercase"
                    value={account.gstin}
                    onChange={(e) =>
                      setAccount((a) => ({
                        ...a,
                        gstin: e.target.value.toUpperCase(),
                      }))
                    }
                    maxLength={15}
                  />
                )}
              </Field>
            </div>
            <p className="mt-6 text-sm text-site-muted">
              You will accept the{" "}
              <Link className="font-semibold text-site-crimson underline" href="/terms" target="_blank">
                Terms of Service
              </Link>{" "}
              and sign the NDA during setup, right after payment. The mandate renews automatically; you can change the package from Billing.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-site-sand pt-6 sm:flex-row sm:items-center sm:justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm text-site-muted">
                <ShieldCheck className="size-4 text-site-mint" aria-hidden /> Secure payment by Razorpay
              </span>
              <button type="submit" disabled={busy} className={PRIMARY}>
                <Lock className="size-4" aria-hidden /> {busy ? "Creating your account…" : `Create account & pay ${inr(chosen.totalPaise)}`}
              </button>
            </div>
          </form>

          <aside className="order-first rounded-3xl border border-site-sand bg-site-paper p-6 lg:order-none lg:sticky lg:top-24">
            <p className="text-xs font-bold uppercase tracking-widest text-site-crimson">Your order</p>
            <h3 className="mt-2 font-brand text-xl font-bold text-site-ink">{cycleLabel(chosen.cycle, chosen.months)}</h3>
            <p className="mt-1 text-sm text-site-muted">
              {form.firmName} · {chosen.users} user
              {chosen.users === 1 ? "" : "s"} · {chosen.tierLabel}
            </p>
            <dl className="mt-5 space-y-2 text-sm">
              <SumRow label={`Subtotal (${chosen.months} mo)`} value={inr(chosen.subtotalPaise)} />
              {chosen.discountPaise > 0 && <SumRow label="Discount" value={`− ${inr(chosen.discountPaise)}`} accent />}
              <SumRow label={`GST ${(chosen.gstBp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`} value={inr(chosen.gstPaise)} />
              {chosen.roundOffPaise !== 0 && <SumRow label="Round off" value={inr(chosen.roundOffPaise)} />}
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-site-sand pt-4">
              <span className="font-semibold text-site-ink">Pay today</span>
              <span className="font-brand text-2xl font-extrabold tabular-nums text-site-ink">{inr(chosen.totalPaise)}</span>
            </div>
            <p className="mt-3 text-sm text-site-muted">
              {chosen.cycle === "commitment"
                ? `Covers the first ${chosen.months} months. Then monthly, unless you choose half-yearly or yearly.`
                : `Renews every ${chosen.months === 1 ? "month" : `${chosen.months} months`} by auto-debit.`}
            </p>
            {chosen.savingVsMonthlyPaise > 0 && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-site-mint/10 px-2.5 py-1 text-sm font-semibold text-site-mint">
                <Check className="size-4" aria-hidden /> You save {inr(chosen.savingVsMonthlyPaise)} vs monthly
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

const CARD = "rounded-3xl border border-site-sand bg-site-paper p-6 sm:p-8 shadow-sm";
const LEGEND = "text-xs font-bold uppercase tracking-widest text-site-crimson";
const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-site-crimson px-7 py-3.5 text-sm font-bold text-white transition hover:bg-site-crimson-deep disabled:cursor-not-allowed disabled:opacity-60";
const GHOST = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-site-ink transition hover:bg-site-cream";
const STEP_BTN =
  "grid w-11 shrink-0 place-items-center rounded-lg border border-site-sand bg-white text-site-ink transition hover:border-site-ink/40 disabled:opacity-40";

const AUM_PICKS = [100, 300, 500, 750, 1000, 1500];

const HOW = [
  {
    t: "Tell us about your practice",
    d: "Your AUM and how many people will use the CRM.",
  },
  {
    t: "Pick a package",
    d: "See every option with GST, line by line. No surprises.",
  },
  {
    t: "Pay and set up",
    d: "Pay securely, add your logo and details, and start.",
  },
];

const TRUST = [
  { icon: ShieldCheck, t: "Secure payment and auto-debit by Razorpay" },
  { icon: ReceiptText, t: "GST tax invoice emailed with every payment" },
  { icon: FileText, t: "Terms and NDA signed online during setup" },
  { icon: BadgeCheck, t: "Built for Indian mutual fund distributors" },
];

const STEPS = ["Your details", "Choose a package", "Account & payment"];

function Stepper({ current }: { current: number }) {
  return (
    <div className="space-y-2">
      <ol className="flex items-center gap-2 sm:gap-3" aria-label="Steps">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" aria-current={active ? "step" : undefined}>
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition",
                  done && "bg-site-mint text-white",
                  active && "bg-site-crimson text-white ring-4 ring-site-crimson/15",
                  !done && !active && "border border-site-sand bg-site-paper text-site-muted",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className={cn("hidden truncate text-sm font-semibold sm:block", active ? "text-site-ink" : "text-site-muted")}>{label}</span>
              {i < STEPS.length - 1 && <span className={cn("h-px flex-1", done ? "bg-site-mint" : "bg-site-sand")} aria-hidden />}
            </li>
          );
        })}
      </ol>
      <p className="text-sm font-semibold text-site-ink sm:hidden">
        Step {current + 1} of {STEPS.length} · {STEPS[current]}
      </p>
    </div>
  );
}

function SumRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-site-muted">{label}</dt>
      <dd className={cn("tabular-nums", accent ? "font-semibold text-site-mint" : "text-site-text")}>{value}</dd>
    </div>
  );
}
