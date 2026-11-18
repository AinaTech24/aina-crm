"use client";

/**
 * "Get pricing" — three steps on one page, mobile first:
 *   1. the firm's AUM, users and contact details → the server prices it and saves the quote;
 *   2. the packages a new firm may buy: the 6-month commitment and Yearly
 *      (monthly and half-yearly open up after the commitment);
 *   3. create the firm's account for the chosen package, then pay in Razorpay
 *      Checkout. The server verifies the payment and opens the setup wizard.
 * Every figure shown comes from the server; nothing typed here sets a price.
 *
 * A saved quote can be reopened: `/pricing?quote=<id>&t=<token>` (the
 * follow-up email's link) lands on the packages, re-priced by the server with
 * today's settings. Progress (quote id + token, the details typed, the step)
 * is kept in sessionStorage so a refresh does not lose it — never the password.
 * At the account step the mobile is verified with a texted code when SMS is
 * configured (skippable; sign-up never waits on SMS), and a valid GSTIN fills
 * the firm's state.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarCheck, Check, FileText, Lock, MessageCircle, Minus, Plus, ReceiptText, ShieldCheck } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PackageCards } from "@/components/billing/PackageCards";
import { openRazorpayCheckout, verifyCheckout, type CheckoutStart } from "@/components/billing/razorpay-checkout";
import { cycleLabel, inr, type CycleKey, type CycleQuote } from "@/lib/billing/aum-pricing";
import { GST_STATES, gstinStateMismatch, stateFromGstin } from "@/lib/legal/gst";
import { DEMO_URL } from "@/lib/landing/links";
import { WHATSAPP_US_URL } from "@/lib/onboarding/messages";
import { cn } from "@/lib/utils";

type Quote = { quoteId: string | null; token: string | null; cycles: CycleQuote[]; tierLabel: string; onlineSignup: boolean; mobileVerified?: boolean };
type Step = "details" | "packages" | "account" | "done";
type Form = { aumCrore: string; users: string; contactName: string; firmName: string; email: string; mobile: string; arn: string; website: string };
type Notice = { tone: "error" | "info"; text: string; next?: string; nextLabel?: string };
type MobileCheck =
  | { state: "idle" | "sending" | "skipped" | "verified" }
  | { state: "sent"; sentTo: string; skippedByUser?: boolean };

const BLANK: Form = { aumCrore: "", users: "1", contactName: "", firmName: "", email: "", mobile: "", arn: "", website: "" };
const STORE_KEY = "aina:pricing:v1";

type Saved = { quoteId: string; token: string; form: Form; step: Step; cycle: CycleKey; state?: string; gstin?: string };

function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function writeSaved(s: Saved | null) {
  try {
    if (s) sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* storage blocked — progress just isn't kept */
  }
}

export function PricingFlow() {
  const [step, setStep] = useState<Step>("details");
  const [form, setForm] = useState<Form>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailTaken, setEmailTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [cycle, setCycle] = useState<CycleKey>("yearly");
  const [account, setAccount] = useState({ password: "", state: "", gstin: "" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mobile, setMobile] = useState<MobileCheck>({ state: "idle" });
  const [mobileCode, setMobileCode] = useState("");
  const [mobileBusy, setMobileBusy] = useState(false);

  const set = (k: keyof Form, v: string) => {
    setForm((s) => ({ ...s, [k]: v }));
    if (k === "email") setEmailTaken(false);
  };

  // Reopen a saved quote: the follow-up email's link wins, else this tab's own progress.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("quote") && params.get("t") ? { quoteId: params.get("quote")!, token: params.get("t")! } : null;
    const saved = readSaved();
    const target = fromLink ?? (saved ? { quoteId: saved.quoteId, token: saved.token } : null);
    if (fromLink) {
      // Keep the token out of the address bar (and out of a copied link).
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (!target) return;
    void (async () => {
      setResuming(true);
      try {
        const r = await fetch(`/api/public/pricing/quote?quote=${encodeURIComponent(target.quoteId)}&t=${encodeURIComponent(target.token)}`);
        const j = (await r.json().catch(() => ({}))) as Record<string, any>;
        if (r.status === 409 && j.converted) {
          writeSaved(null);
          setNotice({ tone: "info", text: "An account was already created from this quote — sign in to continue.", next: "/login", nextLabel: "Sign in" });
          return;
        }
        if (!r.ok) {
          writeSaved(null);
          if (fromLink) setNotice({ tone: "error", text: j.error ?? "This link has expired. Please get pricing again." });
          return;
        }
        setForm({ ...BLANK, ...(j.form as Partial<Form>) });
        setQuote(j as Quote);
        if (j.mobileVerified) setMobile({ state: "verified" });
        const sameQuote = !fromLink && saved && saved.quoteId === j.quoteId;
        if (sameQuote && saved.step === "account") {
          setCycle(saved.cycle);
          setAccount((a) => ({ ...a, state: saved.state ?? "", gstin: saved.gstin ?? "" }));
          setStep("account");
        } else {
          setStep("packages");
        }
      } catch {
        /* offline — start fresh */
      } finally {
        setResuming(false);
      }
    })();
  }, []);

  // Keep progress for a refresh (never the password).
  useEffect(() => {
    if (!quote?.quoteId || !quote.token || step === "done") return;
    writeSaved({ quoteId: quote.quoteId, token: quote.token, form, step, cycle, state: account.state, gstin: account.gstin });
  }, [quote, form, step, cycle, account.state, account.gstin]);

  async function getQuote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setEmailTaken(false);
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
        if (j.code === "email_taken") setEmailTaken(true);
        return;
      }
      setQuote(j as Quote);
      setMobile({ state: "idle" });
      setMobileCode("");
      setStep("packages");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  // Account step: text a code to the mobile — only when the server says SMS is set up.
  const codeAskedFor = useRef<string | null>(null);
  useEffect(() => {
    if (step !== "account" || !quote?.quoteId || !quote.token || mobile.state !== "idle") return;
    // Once per quote (a re-run of the effect must not ask again and hit the resend wait).
    if (codeAskedFor.current === quote.quoteId) return;
    codeAskedFor.current = quote.quoteId;
    setMobile({ state: "sending" });
    void (async () => {
      try {
        const r = await fetch("/api/public/pricing/mobile-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quoteId: quote.quoteId, token: quote.token }),
        });
        const j = (await r.json().catch(() => ({}))) as Record<string, any>;
        if (j.status === "sent") setMobile({ state: "sent", sentTo: j.sentTo });
        else if (j.status === "verified") setMobile({ state: "verified" });
        else setMobile({ state: "skipped" });
      } catch {
        setMobile({ state: "skipped" });
      }
    })();
  }, [step, quote, mobile.state]);

  async function resendCode() {
    if (!quote?.quoteId || !quote.token) return;
    setMobileBusy(true);
    setErrors((e) => ({ ...e, mobileCode: "" }));
    try {
      const r = await fetch("/api/public/pricing/mobile-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId, token: quote.token }),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, any>;
      if (j.status === "sent") setMobile({ state: "sent", sentTo: j.sentTo });
      else if (j.status === "verified") setMobile({ state: "verified" });
      else if (j.status === "wait" || j.status === "too_many") setErrors((e) => ({ ...e, mobileCode: j.error }));
      else setMobile({ state: "skipped" });
    } finally {
      setMobileBusy(false);
    }
  }

  /** True when the mobile step lets the account be created now. */
  async function verifyCode(): Promise<boolean> {
    if (mobile.state !== "sent" || mobile.skippedByUser) return true;
    if (!/^\d{6}$/.test(mobileCode)) {
      setErrors((e) => ({ ...e, mobileCode: "Enter the 6-digit code we texted you — or skip it for now." }));
      return false;
    }
    setMobileBusy(true);
    try {
      const r = await fetch("/api/public/pricing/mobile-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote?.quoteId, token: quote?.token, code: mobileCode }),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, any>;
      if (!r.ok) {
        setErrors((e) => ({ ...e, mobileCode: j.error ?? "That code is not right." }));
        return false;
      }
      setMobile({ state: "verified" });
      return true;
    } finally {
      setMobileBusy(false);
    }
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!quote?.quoteId || !quote.token) return;
    setErrors({});
    setNotice(null);
    const mismatch = gstinStateMismatch(account.state, account.gstin);
    if (mismatch) {
      setErrors({ state: mismatch });
      return;
    }
    if (!(await verifyCode())) return;
    setBusy(true);
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
      // The quote is now an account: a refresh must not reopen it.
      writeSaved(null);
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
  const gstinState = stateFromGstin(account.gstin);
  // The same rule the sign-up API enforces (lib/legal/gst.ts).
  const stateMismatch = gstinStateMismatch(account.state, account.gstin);
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
              {notice.nextLabel ?? "Go to Billing"} <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      )}

      {resuming && (
        <p role="status" className="rounded-2xl border border-site-sand bg-site-paper p-4 text-sm text-site-muted">
          Opening your saved packages…
        </p>
      )}

      {step === "details" && !resuming && (
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
                  <div className="space-y-1.5">
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
                    {emailTaken && (
                      <Link href="/login" className="inline-flex items-center gap-1 text-sm font-semibold text-site-crimson underline">
                        Sign in instead <ArrowRight className="size-4" aria-hidden />
                      </Link>
                    )}
                  </div>
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
          <NotReady />
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
              <Field
                label="Your firm's state"
                required
                hint={gstinState ? "Filled in from your GSTIN." : "For your GST tax invoice."}
                error={errors.state || stateMismatch}
              >
                {(id, d, inv) => (
                  <select
                    id={id}
                    aria-describedby={d}
                    aria-invalid={inv}
                    className="input-base"
                    value={account.state}
                    onChange={(e) => {
                      const state = e.target.value;
                      setAccount((a) => ({ ...a, state }));
                      setErrors((x) => ({ ...x, state: "" }));
                    }}
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
                    onChange={(e) => {
                      const gstin = e.target.value.toUpperCase().replace(/\s/g, "");
                      // A valid GSTIN names the state (its first two digits) — fill it in.
                      const st = stateFromGstin(gstin);
                      setAccount((a) => ({ ...a, gstin, state: st ? st.name : a.state }));
                      setErrors((x) => ({ ...x, gstin: "", ...(st ? { state: "" } : {}) }));
                    }}
                    maxLength={15}
                  />
                )}
              </Field>
              {mobile.state === "verified" && (
                <p className="sm:col-span-2 inline-flex items-center gap-1.5 text-sm font-semibold text-site-mint">
                  <Check className="size-4" aria-hidden /> Mobile verified
                </p>
              )}
              {mobile.state === "sent" && (
                <div className="sm:col-span-2">
                  {mobile.skippedByUser ? (
                    <p className="text-sm text-site-muted">
                      You can verify your mobile later.{" "}
                      <button type="button" className="font-semibold text-site-crimson underline" onClick={() => setMobile({ ...mobile, skippedByUser: false })}>
                        Enter the code now
                      </button>
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <Field label="Code sent to your mobile" required hint={`We texted a 6-digit code to ${mobile.sentTo}. It is valid for 10 minutes.`} error={errors.mobileCode}>
                        {(id, d, inv) => (
                          <input
                            id={id}
                            aria-describedby={d}
                            aria-invalid={inv}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            className="input-base tracking-widest"
                            value={mobileCode}
                            onChange={(e) => {
                              setMobileCode(e.target.value.replace(/\D/g, ""));
                              setErrors((x) => ({ ...x, mobileCode: "" }));
                            }}
                          />
                        )}
                      </Field>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:pt-7">
                        <button type="button" className="text-sm font-semibold text-site-ink underline disabled:opacity-60" disabled={mobileBusy} onClick={resendCode}>
                          Send a new code
                        </button>
                        <button
                          type="button"
                          className="text-sm font-semibold text-site-muted underline"
                          onClick={() => {
                            setMobile({ ...mobile, skippedByUser: true });
                            setErrors((x) => ({ ...x, mobileCode: "" }));
                          }}
                        >
                          Skip for now
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
              <button type="submit" disabled={busy || mobileBusy || mobile.state === "sending"} className={PRIMARY}>
                <Lock className="size-4" aria-hidden />{" "}
                {busy ? "Creating your account…" : mobileBusy ? "Checking the code…" : `Create account & pay ${inr(chosen.totalPaise)}`}
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
const OUTLINE =
  "inline-flex items-center justify-center gap-2 rounded-full border border-site-ink/20 bg-white px-5 py-2.5 text-sm font-bold text-site-ink transition hover:border-site-ink/50";
const GHOST ="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-site-ink transition hover:bg-site-cream";
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

/** Below the packages: for someone who wants to talk before buying. */
function NotReady() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 rounded-3xl border border-site-sand bg-site-paper p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div>
        <h2 className="font-brand text-lg font-bold text-site-ink">Not ready to buy?</h2>
        <p className="mt-0.5 text-sm text-site-muted">Talk to us first — we are happy to answer questions or show you the CRM.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
        <a href={WHATSAPP_US_URL} target="_blank" rel="noopener noreferrer" className={OUTLINE}>
          <MessageCircle className="size-4" aria-hidden /> WhatsApp us
        </a>
        <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={OUTLINE}>
          <CalendarCheck className="size-4" aria-hidden /> Book a demo
        </a>
      </div>
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
