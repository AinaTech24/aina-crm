"use client";

/**
 * In-place edit panel for the Investor detail page (Client Master).
 *
 * Wraps the 6 groups (Identity, Contact, Profile, Compliance, Financials,
 * Lifecycle) and lets the user toggle the whole record into edit mode.
 * Read-only fields (Client ID, PAN, AUM, lifetimeInflow) stay locked even
 * in edit mode because they're system-managed.
 *
 * Posts to PATCH /api/investors/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X, Loader2, Plus, Trash2 } from "lucide-react";

const CATEGORIES = [
  ["individual", "Individual"],
  ["huf", "HUF"],
  ["nri", "NRI"],
  ["company", "Company"],
  ["corporate", "Corporate (legacy)"],
  ["trust", "Trust"],
  ["minor", "Minor"],
  ["other", "Other"],
] as const;

const SEGMENTS = [
  ["HNI", "HNI"],
  ["Affluent", "Affluent"],
  ["Retail", "Retail"],
  ["NRI", "NRI"],
  ["Corporate", "Corporate"],
] as const;

/** A/B/C/D client grade — manually assigned. */
const CLIENT_CATEGORIES = [
  ["A", "A"],
  ["B", "B"],
  ["C", "C"],
  ["D", "D"],
] as const;

const STATUSES = [
  ["active", "Active"],
  ["dormant", "Dormant"],
  ["inactive", "Inactive"],
  ["redemption_risk", "Redemption Risk"],
  ["closed", "Closed"],
] as const;

const RISK_PROFILES = [
  ["conservative", "Conservative"],
  ["moderate", "Moderate"],
  ["aggressive", "Aggressive"],
  ["very_aggressive", "Very aggressive"],
] as const;

export function InvestorEditPanel({
  investor,
  showPan = true,
  showDob = true,
  showPhone = true,
  showEmail = true,
  showWhatsApp = true,
  showNominee = true,
  showBank = true,
  showRiskProfile = true,
}: {
  investor: any;
  showPan?: boolean;
  showDob?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
  showWhatsApp?: boolean;
  showNominee?: boolean;
  showBank?: boolean;
  showRiskProfile?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const seedNominees: { name: string; relation?: string }[] =
    (investor as any).nominees?.length
      ? (investor as any).nominees
      : investor.nomineeName
        ? [{ name: investor.nomineeName, relation: investor.nomineeRelation ?? "" }]
        : [];
  const seedBanks: { bankName: string; accountMasked?: string; ifsc?: string }[] =
    (investor as any).bankAccounts?.length
      ? (investor as any).bankAccounts
      : investor.bankName
        ? [{ bankName: investor.bankName, accountMasked: investor.bankAccountNumberMasked ?? "", ifsc: investor.bankIfsc ?? "" }]
        : [];

  const initial = () => ({
    name: investor.name ?? "",
    pan: investor.pan ?? "",
    dob: investor.dob ? String(investor.dob).slice(0, 10) : "",
    email: investor.email ?? "",
    phone: investor.phone ?? "",
    alternatePhone: investor.alternatePhone ?? "",
    whatsappPhone: investor.whatsappPhone ?? "",
    gender: investor.gender ?? "",
    occupation: investor.occupation ?? "",
    incomeRange: investor.incomeRange ?? "",
    segmentTag: investor.segmentTag ?? "",
    investorCategory: investor.investorCategory ?? "individual",
    clientCategory: investor.clientCategory ?? "",
    riskProfile: investor.riskProfile ?? "",
    nomineeName: investor.nomineeName ?? "",
    nomineeRelation: investor.nomineeRelation ?? "",
    bankName: investor.bankName ?? "",
    bankAccountNumberMasked: investor.bankAccountNumberMasked ?? "",
    bankIfsc: investor.bankIfsc ?? "",
    nominees: seedNominees,
    bankAccounts: seedBanks,
    bseUccCode: investor.bseUccCode ?? "",
    nseCanCode: investor.nseCanCode ?? "",
    mandateStatus: investor.mandateStatus ?? "none",
    mandateRefNo: investor.mandateRefNo ?? "",
    status: investor.status ?? "active",
    reviewFrequency: investor.reviewFrequency ?? "",
    notes: investor.notes ?? "",
    city: investor.address?.city ?? "",
    state: investor.address?.state ?? "",
    pincode: investor.address?.pincode ?? "",
    addressLine1: investor.address?.line1 ?? "",
  });

  const [form, setForm] = useState(initial);

  function set<K extends keyof ReturnType<typeof initial>>(k: K, v: any) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        name: form.name,
        // Master identity — now editable (correct typos in PAN / DOB / alt mobile).
        pan: form.pan ? form.pan.toUpperCase() : null,
        dob: form.dob || null,
        alternatePhone: form.alternatePhone || undefined,
        // Client Category (A/B/C/D) + Segment are assigned here. Empty → cleared.
        clientCategory: form.clientCategory || null,
        segmentTag: form.segmentTag || undefined,
        // Previously dropped on save (silent data loss): entity type, gender,
        // notes and address are all rendered editable, so persist them too.
        investorCategory: form.investorCategory || undefined,
        gender: form.gender || null,
        // Explicit review cadence — empty string clears it (back to tier-driven).
        reviewFrequency: form.reviewFrequency || null,
        notes: form.notes,
        address: {
          line1: form.addressLine1 || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          pincode: form.pincode || undefined,
        },
      };
      if (showEmail) payload.email = form.email || "";
      if (showPhone) {
        payload.phone = form.phone || undefined;
        payload.whatsappPhone = form.whatsappPhone || undefined;
      }
      if (showRiskProfile) {
        payload.riskProfile = form.riskProfile || undefined;
      }
      if (showNominee) {
        // Send the full list; the API mirrors the first entry into the legacy
        // single columns. Drop blank rows.
        payload.nominees = form.nominees
          .map((n) => ({ name: (n.name || "").trim(), relation: (n.relation || "").trim() || undefined }))
          .filter((n) => n.name);
      }
      if (showBank) {
        payload.bankAccounts = form.bankAccounts
          .map((b) => ({
            bankName: (b.bankName || "").trim(),
            accountMasked: (b.accountMasked || "").trim() || undefined,
            ifsc: (b.ifsc || "").trim().toUpperCase() || undefined,
          }))
          .filter((b) => b.bankName);
      }

      const res = await fetch(`/api/investors/${investor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setForm(initial());
    setEditing(false);
    setErr(null);
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Master record</h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
            >
              <X className="size-3.5" /> Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {err && (
        <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-sm mb-3">{err}</div>
      )}

      <Group title="Identity">
        <KV label="Name">
          {editing ? (
            <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
          ) : (
            <span>{investor.name}</span>
          )}
        </KV>
        {showPan && (
          <KV label="PAN" mono>
            {editing ? (
              <input
                value={form.pan}
                onChange={(e) => set("pan", e.target.value.toUpperCase())}
                maxLength={10}
                placeholder="ABCDE1234F"
                className={`${inputCls} uppercase`}
              />
            ) : (
              <span>{investor.pan ?? "—"}</span>
            )}
          </KV>
        )}
        {showDob && (
          <KV label="DOB">
            {editing ? (
              <input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} className={inputCls} />
            ) : (
              <span>{investor.dob ? new Date(investor.dob).toLocaleDateString("en-IN") : "—"}</span>
            )}
          </KV>
        )}
        <KV label="Gender">
          {editing ? (
            <select value={form.gender} onChange={(e) => set("gender", e.target.value)} className={inputCls}>
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </select>
          ) : (
            <span>{labelFor(investor.gender, [["M", "Male"], ["F", "Female"], ["O", "Other"]])}</span>
          )}
        </KV>
      </Group>

      {(showPhone || showEmail) && (
        <Group title="Contact">
          {showPhone && (
            <KV label="Mobile">
              {editing ? (
                <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.phone ?? "—"}</span>
              )}
            </KV>
          )}
          {showPhone && (
            <KV label="Alt mobile">
              {editing ? (
                <input value={form.alternatePhone} onChange={(e) => set("alternatePhone", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.alternatePhone ?? "—"}</span>
              )}
            </KV>
          )}
          {showEmail && (
            <KV label="Email">
              {editing ? (
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.email ?? "—"}</span>
              )}
            </KV>
          )}
          {showPhone && (
            <KV label="WhatsApp">
              {editing ? (
                <input value={form.whatsappPhone} onChange={(e) => set("whatsappPhone", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.whatsappPhone ?? "—"}</span>
              )}
            </KV>
          )}
        </Group>
      )}

      <Group title="Profile">
        <KV label="Client Category (A–D)">
          {editing ? (
            <select value={form.clientCategory} onChange={(e) => set("clientCategory", e.target.value)} className={inputCls}>
              <option value="">— Not categorised —</option>
              {CLIENT_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{`Category ${l}`}</option>)}
            </select>
          ) : (
            <span>{investor.clientCategory ? `Category ${investor.clientCategory}` : "—"}</span>
          )}
        </KV>
        <KV label="Entity type">
          {editing ? (
            <select value={form.investorCategory} onChange={(e) => set("investorCategory", e.target.value)} className={inputCls}>
              {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          ) : (
            <span className="capitalize">{(investor.investorCategory ?? "—").replace("corporate", "Company")}</span>
          )}
        </KV>
        <KV label="Client type (segment)">
          {editing ? (
            <select value={form.segmentTag} onChange={(e) => set("segmentTag", e.target.value)} className={inputCls}>
              <option value="">—</option>
              {SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          ) : (
            <span>{investor.segmentTag ?? "—"}</span>
          )}
        </KV>
        <KV label="Review frequency">
          {editing ? (
            <select value={form.reviewFrequency} onChange={(e) => set("reviewFrequency", e.target.value)} className={inputCls}>
              <option value="">Auto (by service tier)</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="half_yearly">Half-yearly</option>
              <option value="annual">Yearly</option>
            </select>
          ) : (
            <span className="capitalize">
              {investor.reviewFrequency ? investor.reviewFrequency.replace(/_/g, "-") : "Auto (by service tier)"}
            </span>
          )}
        </KV>
        {showRiskProfile && (
          <KV label="Risk profile">
            {editing ? (
              <select value={form.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} className={inputCls}>
                <option value="">Not assessed</option>
                {RISK_PROFILES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : (
              <span className="capitalize">{(investor.riskProfile ?? "not assessed").replace(/_/g, " ")}</span>
            )}
          </KV>
        )}
      </Group>

      {(showNominee || showBank) && (
        <Group title="Nominee & bank">
          {showNominee && (
            <div className="col-span-3">
              <div className="text-xs text-muted-foreground mb-1">Nominees</div>
              {editing ? (
                <div className="space-y-2">
                  {form.nominees.length === 0 && <div className="text-xs text-muted-foreground">No nominees added.</div>}
                  {form.nominees.map((n, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input value={n.name} onChange={(e) => set("nominees", form.nominees.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} placeholder="Nominee name" className={`${inputCls} flex-1`} />
                      <input value={n.relation ?? ""} onChange={(e) => set("nominees", form.nominees.map((x, idx) => idx === i ? { ...x, relation: e.target.value } : x))} placeholder="Relation" className={`${inputCls} w-36`} />
                      <button type="button" onClick={() => set("nominees", form.nominees.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-rose-600 shrink-0 p-1" aria-label="Remove nominee"><Trash2 className="size-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => set("nominees", [...form.nominees, { name: "", relation: "" }])} className="btn-ghost text-xs"><Plus className="size-3.5" /> Add nominee</button>
                </div>
              ) : (
                <div className="text-sm space-y-0.5">
                  {form.nominees.length === 0 ? <span>—</span> : form.nominees.map((n, i) => (
                    <div key={i}>{n.name}{n.relation ? <span className="text-muted-foreground"> · {n.relation}</span> : null}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {showBank && (
            <div className="col-span-3">
              <div className="text-xs text-muted-foreground mb-1">Bank accounts</div>
              {editing ? (
                <div className="space-y-2">
                  {form.bankAccounts.length === 0 && <div className="text-xs text-muted-foreground">No bank accounts added.</div>}
                  {form.bankAccounts.map((b, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input value={b.bankName} onChange={(e) => set("bankAccounts", form.bankAccounts.map((x, idx) => idx === i ? { ...x, bankName: e.target.value } : x))} placeholder="Bank name" className={`${inputCls} flex-1`} />
                      <input value={b.accountMasked ?? ""} onChange={(e) => set("bankAccounts", form.bankAccounts.map((x, idx) => idx === i ? { ...x, accountMasked: e.target.value } : x))} placeholder="A/c (masked)" className={`${inputCls} w-32 font-mono`} />
                      <input value={b.ifsc ?? ""} onChange={(e) => set("bankAccounts", form.bankAccounts.map((x, idx) => idx === i ? { ...x, ifsc: e.target.value } : x))} placeholder="IFSC" className={`${inputCls} w-28 font-mono`} />
                      <button type="button" onClick={() => set("bankAccounts", form.bankAccounts.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-rose-600 shrink-0 p-1" aria-label="Remove bank account"><Trash2 className="size-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => set("bankAccounts", [...form.bankAccounts, { bankName: "", accountMasked: "", ifsc: "" }])} className="btn-ghost text-xs"><Plus className="size-3.5" /> Add bank account</button>
                </div>
              ) : (
                <div className="text-sm space-y-0.5">
                  {form.bankAccounts.length === 0 ? <span>—</span> : form.bankAccounts.map((b, i) => (
                    <div key={i}>{b.bankName}{b.accountMasked ? <span className="font-mono text-muted-foreground"> · {b.accountMasked}</span> : null}{b.ifsc ? <span className="font-mono text-muted-foreground"> · {b.ifsc}</span> : null}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Group>
      )}

      <Group title="Notes">
        {editing ? (
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-2 py-1 text-sm bg-background col-span-3"
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap col-span-3 text-muted-foreground">
            {investor.notes || <em>No internal notes.</em>}
          </p>
        )}
      </Group>
    </div>
  );
}

const inputCls = "w-full border rounded-md px-2 py-1 text-sm bg-background";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t first:border-t-0 first:pt-0 pt-4 mt-4 first:mt-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function KV({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

function labelFor(val: any, opts: ReadonlyArray<readonly [string, string]>): string {
  if (!val) return "—";
  return opts.find(([k]) => k === val)?.[1] ?? String(val);
}
