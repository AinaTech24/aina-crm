"use client";

/**
 * Dedicated, editable Referrals section for the Client 360 page.
 *
 * Read view: one card per referral (name, relation, mobile, email, note). Edit
 * opens a right drawer with the shared multi-referral editor (ReferralsField)
 * and saves via PATCH /api/investors/[id] { referrals } — same endpoint the
 * master-record editor uses, so RBAC + audit are enforced server-side. Mirrors
 * NomineeSection.
 */

import { useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Share2, Pencil, X, Loader2, Save, UserPlus } from "lucide-react";
import { ReferralsField } from "./ReferralsField";
import type { Referral } from "@/lib/investors/referral";
import { useToast } from "@/components/ui/Toast";

/**
 * A lead that names this client as its referrer (`leads.referred_by_investor_id`).
 * Derived, never edited here — the link is owned by the lead record.
 */
export type ReferredLead = {
  id: string;
  name: string;
  stage: string | null;
  createdAt: string | null;
  convertedAt: string | null;
  convertedInvestorId: string | null;
  convertedName: string | null;
  convertedAum: number | null;
};

/** "23 Apr 2026" — matches the date style used elsewhere on the 360 page. */
function fmtDate(v: string): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Compact INR for the converted-referral subtitle. */
function fmtInr(n: number): string {
  return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const LOST_STAGES = new Set(["lost", "not_interested", "not_qualified"]);

export function ReferralSection({
  investorId,
  referrals,
  referredLeads = [],
  canEdit = true,
}: {
  investorId: string;
  referrals: Referral[];
  /** Leads referred by this client — shown read-only alongside the manual list. */
  referredLeads?: ReferredLead[];
  canEdit?: boolean;
}) {
  const seed: Referral[] = referrals && referrals.length ? referrals : [];
  const converted = referredLeads.filter((l) => l.convertedInvestorId);
  const total = seed.length + referredLeads.length;

  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Referral[]>(seed);

  function startEdit() {
    setDraft(seed.length ? seed : [{ name: "" }]);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const cleaned = draft
        .map((n) => ({
          ...n,
          name: (n.name || "").trim(),
          relation: (n.relation || "").trim() || undefined,
          mobile: (n.mobile || "").trim() || undefined,
          email: (n.email || "").trim() || undefined,
          note: (n.note || "").trim() || undefined,
        }))
        .filter((n) => n.name);
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referrals: cleaned }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Referrals");
        return;
      }
      toast.success("Referrals updated");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Referrals");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4 border-b pb-3">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <Share2 className="size-4 text-brand-cyan" /> Referrals
          {total > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({total}
              {converted.length > 0 ? ` · ${converted.length} converted` : ""})
            </span>
          )}
        </h2>
        {canEdit && (
          <button
            onClick={startEdit}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
          >
            <Pencil className="size-3.5" /> {seed.length ? "Edit" : "Add referral"}
          </button>
        )}
      </div>

      {/* Leads that named this client as referrer. Read-only: the link lives on
          the lead, so it is edited there. A converted referral stays listed and
          points at the client it became — losing it on conversion hid exactly
          the referrals worth talking about. */}
      {referredLeads.length > 0 && (
        <div className={seed.length > 0 ? "mb-5" : ""}>
          <div className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            Leads referred by this client ({referredLeads.length})
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {referredLeads.map((l) => {
              const isConverted = !!l.convertedInvestorId;
              const isLost = !isConverted && l.stage != null && LOST_STAGES.has(l.stage);
              return (
                <div key={l.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={isConverted ? `/dashboard/investors/${l.convertedInvestorId}` : `/dashboard/leads/${l.id}`}
                      className="text-sm font-semibold hover:underline truncate"
                    >
                      {isConverted ? l.convertedName || l.name : l.name}
                    </Link>
                    <span
                      className={`chip text-2xs shrink-0 ${
                        isConverted
                          ? "bg-emerald-50 text-emerald-700"
                          : isLost
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {isConverted ? "Client" : (l.stage ?? "lead").replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1.5 text-2xs text-muted-foreground">
                    {isConverted ? (
                      <>
                        Converted{l.convertedAt ? ` ${fmtDate(l.convertedAt)}` : ""}
                        {l.convertedAum != null && l.convertedAum > 0 ? ` · ${fmtInr(l.convertedAum)} AUM` : ""}
                      </>
                    ) : (
                      <>Lead{l.createdAt ? ` added ${fmtDate(l.createdAt)}` : ""}</>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {seed.length === 0 && referredLeads.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          <UserPlus className="size-7 mx-auto text-muted-foreground/40 mb-2" />
          No referrals recorded for this client yet.
          {canEdit && (
            <div className="mt-2">
              <button onClick={startEdit} className="text-brand-cyan hover:underline text-xs font-medium">
                Add a referral
              </button>
            </div>
          )}
        </div>
      ) : seed.length === 0 ? null : (
        <div>
          {referredLeads.length > 0 && (
            <div className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              Added manually ({seed.length})
            </div>
          )}
        <div className="grid gap-3 sm:grid-cols-2">
          {seed.map((n, i) => (
            <div key={i} className="rounded-lg border border-border bg-secondary/20 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                  Referral {i + 1}
                </span>
              </div>
              <div className="text-sm font-semibold">{n.name || "—"}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <RefKV label="Relation" value={n.relation} cap />
                <RefKV label="Mobile" value={n.mobile} mono />
                <RefKV label="Email" value={n.email} />
              </div>
              {n.note && <div className="mt-2.5 text-2xs text-muted-foreground whitespace-pre-wrap">{n.note}</div>}
            </div>
          ))}
        </div>
        </div>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => !busy && setOpen(false)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-card shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Share2 className="size-4 text-brand-cyan" /> Edit referrals
              </h3>
              <button onClick={() => !busy && setOpen(false)} className="btn-icon h-7 w-7">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
              <ReferralsField value={draft} onChange={setDraft} />
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button onClick={save} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save referrals
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function RefKV({ label, value, cap, mono }: { label: string; value?: string | null; cap?: boolean; mono?: boolean }) {
  return (
    <div>
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className={`${mono ? "font-mono" : ""} ${cap ? "capitalize" : ""} break-words`}>{value || "—"}</div>
    </div>
  );
}
