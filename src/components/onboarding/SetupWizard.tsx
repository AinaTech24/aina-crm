"use client";

/**
 * The setup wizard after payment: 1 firm details · 2 logo · 3 Terms · 4 NDA ·
 * 5 done. In re-accept mode (a new Terms / NDA version) only those steps.
 * Mobile first; every step saves on its own, so leaving half way loses nothing.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, FileSignature, ImageUp, Building2, ScrollText, PartyPopper, LogOut, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { notify } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { GST_STATES } from "@/lib/legal/gst";
import { pincodeFill } from "@/lib/pincode/autofill";
import { StartHere } from "./StartHere";

export type SetupFirm = {
  legalName: string;
  displayName: string;
  arn: string;
  arnExpiry: string;
  principalEuin: string;
  pan: string;
  gstRegistered: boolean;
  gstin: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  email: string;
  phone: string;
  billingEmail: string;
};

type Doc = { id: string; kind: "terms" | "nda"; version: number; title: string; body: string };
type StepKey = "firm" | "logo" | "terms" | "nda" | "done";

const STEP_META: Record<StepKey, { label: string; icon: typeof Building2 }> = {
  firm: { label: "Firm details", icon: Building2 },
  logo: { label: "Logo", icon: ImageUp },
  terms: { label: "Terms", icon: ScrollText },
  nda: { label: "NDA", icon: FileSignature },
  done: { label: "Done", icon: PartyPopper },
};

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  return { ok: r.ok, j };
}

export function SetupWizard(p: {
  mode: "setup" | "reaccept";
  canManage: boolean;
  firm: SetupFirm;
  firmComplete: boolean;
  logoUrl: string | null;
  pending: Array<"terms" | "nda">;
  emailVerified: boolean;
  signerName: string;
  signerEmail: string;
  docs: Doc[];
  /** "Book your free onboarding call" (lib/onboarding/messages.ts — the env is server-side). */
  callUrl: string;
}) {
  const steps: StepKey[] = useMemo(
    () => (p.mode === "setup" ? ["firm", "logo", "terms", "nda", "done"] : [...p.pending, "done"]),
    [p.mode, p.pending]
  );
  const [done, setDone] = useState<Record<StepKey, boolean>>({
    firm: p.firmComplete,
    logo: !!p.logoUrl,
    terms: !p.pending.includes("terms"),
    nda: !p.pending.includes("nda"),
    done: false,
  });
  const firstOpen = steps.find((s) => !done[s] && s !== "logo") ?? "done";
  const [step, setStep] = useState<StepKey>(firstOpen);
  const next = (from: StepKey) => {
    const i = steps.indexOf(from);
    setStep(steps[Math.min(i + 1, steps.length - 1)]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!p.canManage) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">Your firm is being set up</h1>
        <p className="text-muted-foreground">
          {p.mode === "setup"
            ? "The firm's owner is finishing the setup — firm details, Terms and the NDA. You can sign in again once it is done."
            : "The firm's owner needs to accept an updated agreement. You can continue once they have."}
        </p>
        <LogoutButton />
      </div>
    );
  }

  const docOf = (k: "terms" | "nda") => p.docs.find((d) => d.kind === k)!;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{p.mode === "setup" ? "Set up your firm" : "Updated agreements"}</h1>
        <p className="text-muted-foreground text-sm">
          {p.mode === "setup"
            ? "Payment received — thank you. A few details and two agreements, then your CRM is ready."
            : "A new version of an agreement has been published. Please accept it to continue."}
        </p>
      </header>

      <ol className="flex flex-wrap gap-2" aria-label="Setup steps">
        {steps.map((s, i) => {
          const Icon = STEP_META[s].icon;
          const current = s === step;
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => setStep(s)}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "chip gap-1.5",
                  current ? "bg-primary text-primary-foreground" : done[s] ? "bg-success/10 text-success" : "bg-secondary text-secondary-foreground"
                )}
              >
                {done[s] && !current ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                {i + 1}. {STEP_META[s].label}
              </button>
            </li>
          );
        })}
      </ol>

      {step === "firm" && <FirmStep initial={p.firm} onSaved={() => { setDone((d) => ({ ...d, firm: true })); next("firm"); }} />}
      {step === "logo" && <LogoStep initialUrl={p.logoUrl} onDone={(uploaded) => { if (uploaded) setDone((d) => ({ ...d, logo: true })); next("logo"); }} />}
      {step === "terms" && <TermsStep doc={docOf("terms")} accepted={done.terms} onAccepted={() => { setDone((d) => ({ ...d, terms: true })); next("terms"); }} />}
      {step === "nda" && (
        <NdaStep
          doc={docOf("nda")}
          signed={done.nda}
          emailVerified={p.emailVerified}
          signerName={p.signerName}
          signerEmail={p.signerEmail}
          onSigned={() => { setDone((d) => ({ ...d, nda: true })); next("nda"); }}
        />
      )}
      {step === "done" && <DoneStep mode={p.mode} ready={steps.filter((s) => s !== "done" && s !== "logo").every((s) => done[s])} logoSkipped={p.mode === "setup" && !done.logo} callUrl={p.callUrl} />}

      <footer className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border text-sm">
        <span className="text-muted-foreground">
          Need help? <Link className="text-primary underline" href="/dashboard/support">Support</Link> ·{" "}
          <Link className="text-primary underline" href="/dashboard/billing">Billing</Link>
        </span>
        <LogoutButton />
      </footer>
    </div>
  );
}

function LogoutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<LogOut className="size-4" />}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.assign("/login");
      }}
    >
      Sign out
    </Button>
  );
}

function FirmStep({ initial, onSaved }: { initial: SetupFirm; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof SetupFirm, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SetupFirm>(k: K, v: SetupFirm[K]) => setF((s) => ({ ...s, [k]: v }));

  async function lookupPin(pin: string) {
    if (!/^[1-9]\d{5}$/.test(pin)) return;
    const r = await fetch(`/api/pincode/${pin}`).catch(() => null);
    if (!r?.ok) return;
    const place = (await r.json()) as { city: string; state: string };
    // Fill only what is blank — never overwrite what was typed.
    setF((s) => {
      const fill = pincodeFill({ city: s.city, state: s.state, country: "India" }, place);
      return { ...s, city: fill.set.city ?? s.city, state: fill.set.state ?? s.state };
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { ok, j } = await post("/api/onboarding/setup/firm", f);
      if (!ok) {
        setErrors(j.errors ?? {});
        notify.error(j.error ?? "Please check the highlighted fields.");
        return;
      }
      notify.success("Firm details saved.");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const text = (k: keyof SetupFirm, label: string, o: { required?: boolean; optional?: boolean; hint?: string; type?: string; upper?: boolean; inputMode?: "text" | "numeric" | "tel" | "email" } = {}) => (
    <Field label={label} required={o.required} optional={o.optional} hint={o.hint} error={errors[k]}>
      {(id, d, inv) => (
        <input
          id={id}
          aria-describedby={d}
          aria-invalid={inv}
          type={o.type ?? "text"}
          inputMode={o.inputMode}
          className={cn("input-base", o.upper && "uppercase")}
          value={String(f[k] ?? "")}
          onChange={(e) => set(k, (o.upper ? e.target.value.toUpperCase() : e.target.value) as never)}
          onBlur={k === "pincode" ? (e) => lookupPin(e.target.value.trim()) : undefined}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={save} className="card-surface p-5 sm:p-6 space-y-5" noValidate>
      <div>
        <h2 className="section-title">Firm details</h2>
        <p className="section-subtitle mt-0.5">As on your registrations — they appear on your tax invoices and agreements.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("legalName", "Legal name", { required: true })}
        {text("displayName", "Display name", { hint: "What your team and clients see." })}
        {text("arn", "ARN", { required: true, upper: true })}
        {text("arnExpiry", "ARN valid until", { optional: true, type: "date" })}
        {text("principalEuin", "Principal EUIN", { optional: true, upper: true })}
        {text("pan", "Firm PAN", { required: true, upper: true, hint: "10 characters, e.g. ABCFA1234K." })}
      </div>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!f.gstRegistered} onChange={(e) => set("gstRegistered", !e.target.checked)} />
          My firm is not GST-registered
        </label>
        {f.gstRegistered && <div className="grid gap-4 sm:grid-cols-2">{text("gstin", "GSTIN", { required: true, upper: true })}</div>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("addressLine1", "Registered address", { required: true })}
        {text("addressLine2", "Address line 2", { optional: true })}
        {text("pincode", "Pincode", { required: true, inputMode: "numeric", hint: "City and state fill in if they are blank." })}
        {text("city", "City", { required: true })}
        <Field label="State" required error={errors.state}>
          {(id, d, inv) => (
            <select id={id} aria-describedby={d} aria-invalid={inv} className="input-base" value={f.state} onChange={(e) => set("state", e.target.value)}>
              <option value="">Select…</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.name}>{s.name}</option>
              ))}
            </select>
          )}
        </Field>
        {text("email", "Contact email", { required: true, type: "email", inputMode: "email" })}
        {text("phone", "Contact phone", { required: true, type: "tel", inputMode: "tel" })}
        {text("billingEmail", "Billing email", { optional: true, type: "email", inputMode: "email", hint: "Also receives your tax invoices." })}
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>Save and continue</Button>
      </div>
    </form>
  );
}

function LogoStep({ initialUrl, onDone }: { initialUrl: string | null; onDone: (uploaded: boolean) => void }) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setErr(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setErr("Choose a PNG, JPG or WebP image.");
    if (file.size > 2 * 1024 * 1024) return setErr("The logo must be 2 MB or smaller.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/onboarding/setup/logo", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error ?? "Upload failed.");
      setUrl(j.url);
      notify.success("Logo saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-surface p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="section-title">Your firm&apos;s logo</h2>
        <p className="section-subtitle mt-0.5">It goes on every client email, statement and report. Strongly recommended — you can add it later in Settings.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="size-24 rounded-xl border border-border bg-card grid place-items-center overflow-hidden">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Your logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageUp className="size-8 text-muted-foreground" />
          )}
        </div>
        <label className={cn("btn-secondary cursor-pointer", busy && "opacity-60")}>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          {busy ? "Uploading…" : url ? "Replace logo" : "Upload logo"}
        </label>
        <span className="text-xs text-muted-foreground">PNG, JPG or WebP, up to 2 MB.</span>
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {!url && <Button variant="ghost" onClick={() => onDone(false)}>Skip for now</Button>}
        <Button variant="primary" disabled={!url} onClick={() => onDone(true)}>Continue</Button>
      </div>
    </section>
  );
}

function LegalText({ body }: { body: string }) {
  const blocks = body.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-card p-4 text-sm leading-relaxed space-y-2" tabIndex={0} aria-label="Agreement text">
      {blocks.map((l, i) =>
        l.startsWith("## ") ? <h3 key={i} className="font-semibold pt-2">{l.slice(3)}</h3> : l.startsWith("- ") ? <p key={i} className="pl-4">• {l.slice(2)}</p> : <p key={i}>{l}</p>
      )}
    </div>
  );
}

function TermsStep({ doc, accepted, onAccepted }: { doc: Doc; accepted: boolean; onAccepted: () => void }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    try {
      const { ok, j } = await post("/api/onboarding/setup/terms", { documentId: doc.id, agree: true });
      if (!ok) return notify.error(j.error ?? "Could not record your acceptance.");
      notify.success("Terms accepted.");
      onAccepted();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card-surface p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="section-title">{doc.title}</h2>
        <p className="section-subtitle mt-0.5">Version {doc.version}. Please read it in full.</p>
      </div>
      <LegalText body={doc.body} />
      {accepted ? (
        <p className="text-sm text-success flex items-center gap-1.5"><Check className="size-4" /> Accepted.</p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I have read the Terms of Service (version {doc.version}) and accept them on behalf of my firm.
          </label>
          <div className="flex justify-end">
            <Button variant="primary" disabled={!agree} loading={busy} onClick={accept}>Accept and continue</Button>
          </div>
        </>
      )}
    </section>
  );
}

function NdaStep({ doc, signed, emailVerified, signerName, signerEmail, onSigned }: { doc: Doc; signed: boolean; emailVerified: boolean; signerName: string; signerEmail: string; onSigned: () => void }) {
  const [name, setName] = useState(signerName);
  const [designation, setDesignation] = useState("");
  const [agree, setAgree] = useState(false);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"code" | "sign" | "verify" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function sendCode() {
    setBusy("code");
    setErrors({});
    try {
      const { ok, j } = await post("/api/onboarding/setup/nda-code", { documentId: doc.id });
      if (!ok) return setErrors({ code: j.error ?? "Could not send the code." });
      setSentTo(j.sentTo);
      notify.success(`Code sent to ${j.sentTo}.`);
    } finally {
      setBusy(null);
    }
  }
  async function resendVerification() {
    setBusy("verify");
    try {
      const r = await fetch("/api/auth/verify-email", { method: "POST" });
      if (r.ok) notify.success(`Confirmation link sent to ${signerEmail}. Open it, then come back here.`);
      else notify.error("Could not send the confirmation link.");
    } finally {
      setBusy(null);
    }
  }
  async function sign(e: React.FormEvent) {
    e.preventDefault();
    setBusy("sign");
    setErrors({});
    try {
      const { ok, j } = await post("/api/onboarding/setup/nda-sign", { documentId: doc.id, signerName: name, designation, code, agree });
      if (!ok) {
        setErrors({ [j.field ?? "form"]: j.error ?? "Could not sign." });
        return;
      }
      notify.success("NDA signed — a signed copy is on its way to your email.");
      onSigned();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card-surface p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="section-title">{doc.title}</h2>
        <p className="section-subtitle mt-0.5">Version {doc.version}. You sign it with a one-time code sent to your verified email.</p>
      </div>
      <LegalText body={doc.body} />
      {signed ? (
        <p className="text-sm text-success flex items-center gap-1.5"><Check className="size-4" /> Signed. A copy is in your email and in Compliance documents.</p>
      ) : !emailVerified ? (
        <div className="rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm space-y-2">
          <p>Confirm your email ({signerEmail}) first — the signing code can only go to a verified address.</p>
          <Button size="sm" icon={<Mail className="size-4" />} loading={busy === "verify"} onClick={resendVerification}>Send the confirmation link again</Button>
        </div>
      ) : (
        <form onSubmit={sign} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your full name" required error={errors.signerName}>
              {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="input-base" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
            </Field>
            <Field label="Designation" required hint="e.g. Partner, Proprietor, Director" error={errors.designation}>
              {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="input-base" value={designation} onChange={(e) => setDesignation(e.target.value)} />}
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I agree to this Non-Disclosure Agreement (version {doc.version}) and am authorised to sign it for my firm.
          </label>
          {errors.agree && <p role="alert" className="text-sm text-destructive">{errors.agree}</p>}
          <div className="grid gap-3 sm:grid-cols-2 items-end">
            <Field label="One-time code" hint={sentTo ? `Sent to ${sentTo}. Valid for 10 minutes.` : "We email it to you."} error={errors.code}>
              {(id, d, inv) => (
                <input id={id} aria-describedby={d} aria-invalid={inv} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input-base tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              )}
            </Field>
            <Button variant="secondary" loading={busy === "code"} onClick={sendCode}>{sentTo ? "Send a new code" : "Email me a code"}</Button>
          </div>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!agree || code.length !== 6} loading={busy === "sign"}>Sign the NDA</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function DoneStep({ mode, ready, logoSkipped, callUrl }: { mode: "setup" | "reaccept"; ready: boolean; logoSkipped: boolean; callUrl: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  // Setup is recorded complete first — until it is, the dashboard sends the firm back here.
  async function finish(to?: string) {
    setBusy(to ?? "default");
    try {
      const { ok, j } = await post("/api/onboarding/setup/complete", {});
      if (!ok) return notify.error(j.error ?? "Something is still missing.");
      window.location.assign(to ?? j.next ?? "/dashboard");
    } finally {
      setBusy(null);
    }
  }
  if (mode === "setup" && ready) {
    return (
      <section className="card-surface p-5 sm:p-6 space-y-5">
        <div className="text-center space-y-2">
          <PartyPopper className="size-10 mx-auto text-primary" />
          <h2 className="text-xl font-bold">All set — your CRM is ready</h2>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            We will email you a welcome note with your plan.{logoSkipped ? " You can add your logo any time in Settings." : ""}
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="section-title">Start here</h3>
          <StartHere callUrl={callUrl} onGo={(href) => void finish(href)} busyHref={busy} />
        </div>
        <div className="text-center">
          <Button variant="link" disabled={!!busy} onClick={() => void finish("/dashboard")}>
            Skip — take me to my dashboard
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className="card-surface p-5 sm:p-6 space-y-4 text-center">
      <PartyPopper className="size-10 mx-auto text-primary" />
      <h2 className="text-xl font-bold">{ready ? (mode === "setup" ? "All set" : "Thank you") : "Almost there"}</h2>
      <p className="text-muted-foreground text-sm max-w-md mx-auto">
        {ready
          ? mode === "setup"
            ? `Your CRM is ready. We will email you a welcome note with your plan and first steps.${logoSkipped ? " You can add your logo any time in Settings." : ""}`
            : "Your acceptance is recorded."
          : "Finish the steps above that are not ticked yet."}
      </p>
      <Button variant="primary" disabled={!ready} loading={!!busy} onClick={() => void finish()}>Go to your CRM</Button>
    </section>
  );
}
