"use client";

/**
 * The firm's public service request form — the client half of
 * /service-request/[token].
 *
 * No CRM chrome, so a firm can send the link or put it in an iframe on its own
 * website. It posts to /api/public/service-requests/[token]; the service IDs on
 * the thank-you screen are the service requests it opened.
 *
 * A service is picked from a dropdown; "Other" opens a box for the client to
 * type what they need.
 */

import { useState, type ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format";

import { PrivacyNoticeLink } from "@/components/privacy/PrivacyNoticeLink";
type Firm = { name: string; logoUrl: string | null; primaryColor: string | null; arn: string | null; tenantId?: string };
type Opened = { serviceId: string; service: string; respondBy: string | null; alreadyOpen: boolean };

const INPUT =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

const EMPTY = { name: "", phone: "", email: "", otherText: "", details: "" };

export function PublicServiceRequestForm({
  token,
  firm,
  services,
}: {
  token: string;
  firm: Firm;
  services: Array<{ value: string; label: string }>;
}) {
  const brand = firm.primaryColor || "#1e3a8a";
  const [f, setF] = useState(EMPTY);
  // "" is not chosen yet.
  const [service, setService] = useState("");
  // Honeypot: a person never sees it, a form-filling bot fills it.
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Opened[] | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const hasOther = service === "other";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/public/service-requests/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, services: service ? [service] : [], website: hp || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Your request could not be sent. Please try again.");
        return;
      }
      setDone(j.requests ?? []);
    } catch {
      setErr("Your request could not be sent — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell firm={firm} brand={brand}>
        <div className="space-y-4 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto size-12" style={{ color: brand }} aria-hidden />
          <h2 className="text-xl font-semibold text-foreground">Request received</h2>
          {done.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                Please keep your service {done.length > 1 ? "IDs" : "ID"}. Quote {done.length > 1 ? "them" : "it"} whenever you
                contact {firm.name}.
              </p>
              <ul className="space-y-2 text-left">
                {done.map((r) => (
                  <li key={r.serviceId} className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-4 py-3">
                    <span className="text-sm text-foreground">{r.service}</span>
                    <span className="text-right">
                      <strong className="block font-mono text-sm text-foreground">{r.serviceId}</strong>
                      {r.respondBy && <span className="block text-xs text-muted-foreground">by {formatDate(r.respondBy)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-xs text-muted-foreground">{firm.name} will get in touch with you if anything more is needed.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell firm={firm} brand={brand}>
      <form onSubmit={submit} className="space-y-4 p-6 sm:p-8" noValidate>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Request a service</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose what you need and tell us who you are. You will get a service ID for your request.
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

        <Field id="sf-service" label="What do you need?" required>
          <select id="sf-service" className={INPUT} value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Choose a service</option>
            {services.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        {hasOther && (
          <Field id="sf-other" label="Tell us what you need" required>
            <input
              id="sf-other"
              className={INPUT}
              value={f.otherText}
              onChange={set("otherText")}
              maxLength={200}
              placeholder="Type your request"
              autoFocus
            />
          </Field>
        )}

        <Field id="sf-name" label="Full name" required>
          <input id="sf-name" className={INPUT} value={f.name} onChange={set("name")} autoComplete="name" required maxLength={120} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="sf-phone" label="Mobile">
            <input id="sf-phone" type="tel" inputMode="tel" className={INPUT} value={f.phone} onChange={set("phone")} autoComplete="tel" />
          </Field>
          <Field id="sf-email" label="Email">
            <input id="sf-email" type="email" className={INPUT} value={f.email} onChange={set("email")} autoComplete="email" />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">Give at least one, as registered with us, so we can find your account.</p>

        <Field id="sf-details" label="Description">
          <textarea
            id="sf-details"
            className={INPUT}
            rows={4}
            value={f.details}
            onChange={set("details")}
            maxLength={2000}
            placeholder="Anything we should know — for example the scheme, amount, new bank details or nominee name."
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
          {busy ? "Sending…" : "Submit request"}
        </button>
        <p className="text-xs text-muted-foreground">Your details are used only to act on this request.</p>
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
      {firm.tenantId && <PrivacyNoticeLink tenantId={firm.tenantId} firmName={firm.name} className="mt-4" />}
    </main>
  );
}

function Field({ id, label, required, children }: { id: string; label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
    </div>
  );
}
