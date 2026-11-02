"use client";

/**
 * Log a DPDP rights request. Picking the client or lead fills the requester's
 * details; someone not on the CRM (a former enquiry, a family member asking
 * for a deceased client) is typed in. The 90-day clock starts on the day the
 * request was received.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, FieldSection } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { DateField } from "@/components/ui/DateField";
import { notify } from "@/components/ui/Toast";
import { REQUEST_CHANNELS, REQUEST_TYPES, RESPONSE_DAYS, type RequestChannel, type RequestType } from "@/lib/privacy/requests-core";

type Hit = { type: "investor" | "lead"; id: string; name: string; email: string | null; phone: string | null };

export function NewPrivacyRequestForm({ today }: { today: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [subject, setSubject] = useState<Hit | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<RequestType>("access");
  const [channel, setChannel] = useState<RequestChannel>("email");
  const [receivedOn, setReceivedOn] = useState(today);
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (subject || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/privacy-requests/subjects?q=${encodeURIComponent(q.trim())}`);
        const j = await r.json();
        setHits(Array.isArray(j.hits) ? j.hits : []);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, subject]);

  function pick(h: Hit) {
    setSubject(h);
    setName(h.name);
    setEmail(h.email ?? "");
    setPhone(h.phone ?? "");
    setQ("");
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/privacy-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: subject ? { type: subject.type, id: subject.id } : null,
          requesterName: name,
          requesterEmail: email,
          requesterPhone: phone,
          type,
          channel,
          receivedOn,
          details,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      notify.success(`Logged as ${j.reference}. A task is on your list.`);
      router.push(`/dashboard/privacy-requests/${j.id}`);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <FieldSection title="Who is asking" description="Find the client or lead. If they are not on the CRM, type their details below.">
        <div className="sm:col-span-2">
          {subject ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">
              <span className="font-medium">{subject.name}</span>
              <span className="text-muted-foreground">{subject.type === "investor" ? "Client" : "Lead"}</span>
              <button type="button" className="btn-icon ml-auto" aria-label="Remove" onClick={() => setSubject(null)}>
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <Field label="Find a client or lead" optional>
              {(id, describedBy) => (
                <div className="relative">
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    className="input-base w-full"
                    placeholder="Name, mobile, email or PAN"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    autoComplete="off"
                  />
                  {hits.length > 0 && (
                    <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                      {hits.map((h) => (
                        <li key={`${h.type}:${h.id}`}>
                          <button type="button" onClick={() => pick(h)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary">
                            <span className="font-medium">{h.name}</span>
                            <span className="text-muted-foreground">{h.type === "investor" ? "Client" : "Lead"}</span>
                            <span className="ml-auto truncate text-muted-foreground">{h.phone ?? h.email ?? ""}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Field>
          )}
        </div>
        <Field label="Name" required>
          {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />}
        </Field>
        <Field label="Email" optional>
          {(id, d) => <input id={id} aria-describedby={d} type="email" className="input-base w-full" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Phone" optional>
          {(id, d) => <input id={id} aria-describedby={d} type="tel" className="input-base w-full" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />}
        </Field>
      </FieldSection>

      <FieldSection title="The request" description={`Answer within ${RESPONSE_DAYS} days of the day it was received.`}>
        <Field label="What they are asking for" required>
          {(id, d) => (
            <select id={id} aria-describedby={d} className="input-base w-full" value={type} onChange={(e) => setType(e.target.value as RequestType)}>
              {Object.entries(REQUEST_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </Field>
        <Field label="How it came in" required>
          {(id, d) => (
            <select id={id} aria-describedby={d} className="input-base w-full" value={channel} onChange={(e) => setChannel(e.target.value as RequestChannel)}>
              {Object.entries(REQUEST_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </Field>
        <Field label="Received on" required>
          {(id) => <DateField id={id} value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} />}
        </Field>
        <Field label="Details" optional className="sm:col-span-2">
          {(id, d) => (
            <textarea id={id} aria-describedby={d} rows={4} className="input-base w-full" maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} />
          )}
        </Field>
      </FieldSection>

      <FormActions className="card-surface rounded-xl border">
        <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Log request"}
        </Button>
      </FormActions>
    </div>
  );
}
