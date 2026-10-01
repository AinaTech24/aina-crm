"use client";

/**
 * The firm's public complaint form — the client half of /complaint/[token].
 *
 * No CRM chrome, so a firm can link to it or put it in an iframe on its own
 * website. It posts to /api/public/complaints/[token]; the reference number on
 * the thank-you screen is the service request the complaint opened.
 */

import { useState, type ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format";

type Firm = { name: string; logoUrl: string | null; primaryColor: string | null; arn: string | null };

const INPUT =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

const EMPTY = { name: "", phone: "", email: "", pan: "", folio: "", category: "", details: "" };

export function PublicComplaintForm({
  token,
  firm,
  categories,
}: {
  token: string;
  firm: Firm;
  categories: Array<{ value: string; label: string }>;
}) {
  const brand = firm.primaryColor || "#1e3a8a";
  const [f, setF] = useState(EMPTY);
  // Honeypot: a person never sees it, a form-filling bot fills it.
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ ticketNo: string | null; respondBy: string | null } | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/public/complaints/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, website: hp || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Your complaint could not be sent. Please try again.");
        return;
      }
      setDone({ ticketNo: j.ticketNo ?? null, respondBy: j.respondBy ?? null });
    } catch {
      setErr("Your complaint could not be sent — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell firm={firm} brand={brand}>
        <div className="space-y-4 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto size-12" style={{ color: brand }} aria-hidden />
          <h2 className="text-xl font-semibold text-foreground">Complaint registered</h2>
          {done.ticketNo && (
            <p className="text-sm text-muted-foreground">
              Your reference number is <strong className="text-foreground">{done.ticketNo}</strong>. Please quote it
              whenever you contact {firm.name}.
            </p>
          )}
          {done.respondBy && (
            <p className="text-sm text-muted-foreground">
              You will hear back by <strong className="text-foreground">{formatDate(done.respondBy)}</strong>.
            </p>
          )}
          <p className="rounded-lg bg-secondary px-4 py-3 text-left text-xs text-muted-foreground">
            Not satisfied with the response? You can take your complaint to SEBI&apos;s SCORES portal (
            <a className="underline" href="https://scores.sebi.gov.in" target="_blank" rel="noopener noreferrer">
              scores.sebi.gov.in
            </a>
            ) or the SMART ODR portal (
            <a className="underline" href="https://smartodr.in" target="_blank" rel="noopener noreferrer">
              smartodr.in
            </a>
            ).
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell firm={firm} brand={brand}>
      <form onSubmit={submit} className="space-y-4 p-6 sm:p-8" noValidate>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Register a complaint</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell us what went wrong. Every complaint is acknowledged and answered within 21 days.
          </p>
        </div>

        {/* Honeypot — off-screen, out of the tab order, hidden from screen readers. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          aria-hidden="true"
          style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px", opacity: 0 }}
        />

        <Field id="cf-name" label="Full name" required>
          <input id="cf-name" className={INPUT} value={f.name} onChange={set("name")} autoComplete="name" required maxLength={120} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cf-phone" label="Mobile">
            <input id="cf-phone" type="tel" inputMode="tel" className={INPUT} value={f.phone} onChange={set("phone")} autoComplete="tel" />
          </Field>
          <Field id="cf-email" label="Email">
            <input id="cf-email" type="email" className={INPUT} value={f.email} onChange={set("email")} autoComplete="email" />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">Give at least one, so we can reply to you.</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cf-pan" label="PAN" hint="Optional">
            <input id="cf-pan" className={INPUT} value={f.pan} onChange={set("pan")} maxLength={10} placeholder="ABCDE1234F" />
          </Field>
          <Field id="cf-folio" label="Folio or scheme" hint="Optional">
            <input id="cf-folio" className={INPUT} value={f.folio} onChange={set("folio")} maxLength={80} />
          </Field>
        </div>

        <Field id="cf-category" label="What is it about?">
          <select id="cf-category" className={INPUT} value={f.category} onChange={set("category")}>
            <option value="">Choose one</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field id="cf-details" label="Your complaint" required>
          <textarea
            id="cf-details"
            className={INPUT}
            rows={6}
            value={f.details}
            onChange={set("details")}
            maxLength={4000}
            required
            placeholder="What happened, and when? Include any transaction, scheme or date that helps us look into it."
          />
        </Field>

        {err && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: brand }}
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {busy ? "Sending…" : "Submit complaint"}
        </button>
        <p className="text-xs text-muted-foreground">
          Your details are used only to look into and answer this complaint.
        </p>
      </form>
    </Shell>
  );
}

function Shell({ firm, brand, children }: { firm: Firm; brand: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-secondary px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-3 px-6 py-5 text-white sm:px-8" style={{ backgroundColor: brand }}>
          {firm.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={firm.logoUrl} alt="" className="h-10 w-auto rounded bg-white p-1" />
          )}
          <h1 className="text-base font-semibold">{firm.name}</h1>
        </div>
        {children}
        <div className="border-t border-border px-6 py-3 text-xs text-muted-foreground sm:px-8">
          {firm.name}
          {firm.arn && <> · AMFI-registered Mutual Fund Distributor · ARN-{firm.arn.replace(/^ARN-?/i, "")}</>}
        </div>
      </div>
    </main>
  );
}

function Field({ id, label, required, hint, children }: { id: string; label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {hint && <span className="font-normal"> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}
