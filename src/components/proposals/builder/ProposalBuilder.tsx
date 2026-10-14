"use client";

/**
 * The proposal builder — four steps, in the order an RM thinks about it:
 *
 *   1. Client       who it's for, and what the CRM already knows about them
 *   2. Recommend    the one recommendation list, checked against the profile
 *   3. Review       the PDF exactly as the client gets it (rendered, not saved)
 *   4. Send         validity, the suitability note, then email / WhatsApp /
 *                   a link to copy — each previewed before it goes
 *
 * It replaces a single 1,300-line form that started blank every time, and a
 * separate recommendation worksheet whose rows the client never saw.
 *
 * The same component edits a draft (`proposalId`). Once a proposal has been
 * sent it opens read-only: a sent proposal is the record of what the client
 * saw, so changes go into a new version (Revise), never over the top.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, FileSignature, Link2, Loader2, Mail, MessageCircle, Plus, RefreshCw, Save, Send, Lock } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import Link from "next/link";
import type { ProposalSnapshot } from "@/lib/proposals/snapshot";
import { PROPOSAL_ACCEPTANCE_TEXT } from "@/lib/proposals/acceptance";
import { itemKindLabel, itemName } from "@/lib/proposals/items";
import { draftSuitabilityNote } from "@/lib/proposals/suitability-note";
import { RecipientPicker, type Recipient } from "./RecipientPicker";
import { RecommendStep, type Item } from "./RecommendStep";

type ProposalType = "comprehensive" | "mutual_fund" | "insurance" | "pms" | "aif" | "mixed";
type RiskRating = "conservative" | "moderate" | "aggressive" | "mixed";

const STEPS = ["Client", "Recommend", "Review as client", "Send"] as const;

/**
 * What the disclaimer box used to start with. The PDF now prints the full
 * SEBI / AMFI disclosures itself, so a new proposal starts with no extra one —
 * this text only meant the same lines printed twice. A saved proposal keeps
 * whatever it has.
 */
const OLD_DEFAULT_DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme-related documents carefully. Past performance is not indicative of future returns. Insurance is the subject matter of solicitation. The information provided here is for illustrative purposes only.";

const EDITABLE = ["draft", "ready"];

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The proposal type that describes its products, unless the RM chose one. */
function typeFor(items: Item[]): ProposalType {
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size === 0 || kinds.size > 1) return kinds.size > 1 ? "mixed" : "mutual_fund";
  const only = [...kinds][0];
  return only === "mf" ? "mutual_fund" : only === "other" ? "mixed" : (only as ProposalType);
}

const RISK_FROM_PROFILE: Record<string, RiskRating> = {
  conservative: "conservative",
  moderate: "moderate",
  aggressive: "aggressive",
  very_aggressive: "aggressive",
};

const PROFILE_LABEL: Record<string, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
  very_aggressive: "Very aggressive",
};

export function ProposalBuilder({ proposalId: initialId }: { proposalId?: string }) {
  const router = useRouter();
  const toast = useToast();

  const [proposalId, setProposalId] = useState<string | null>(initialId ?? null);
  const [meta, setMeta] = useState<{ number: string | null; version: number; status: string; sentAt: string | null }>({
    number: null,
    version: 1,
    status: "draft",
    sentAt: null,
  });
  const [loading, setLoading] = useState(!!initialId);

  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [familyMemberId, setFamilyMemberId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProposalSnapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  const [title, setTitle] = useState("Investment Proposal");
  const [type, setType] = useState<ProposalType>("mutual_fund");
  const [riskRating, setRiskRating] = useState<RiskRating>("moderate");
  const riskTouched = useRef(false);
  const [validUntil, setValidUntil] = useState(inDays(30));
  const [coverLetter, setCoverLetter] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  /** Why it suits the client — the send route requires it. */
  const [suitabilityNote, setSuitabilityNote] = useState("");
  const [items, setItems] = useState<Item[]>([]);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | "draft" | "send">(null);
  const [err, setErr] = useState<string | null>(null);

  const locked = !!proposalId && !EDITABLE.includes(meta.status);

  // The suitability note is drafted from what the earlier steps captured — the
  // client, their confirmed risk profile, the funds and the amounts — the
  // first time the advisor reaches the Send step with the box still empty.
  // They read it, add what only they know, and it is theirs from then on.
  const noteDrafted = useRef(false);
  useEffect(() => {
    if (step !== 3 || locked || noteDrafted.current) return;
    noteDrafted.current = true;
    if (suitabilityNote.trim()) return;
    const draft = draftSuitabilityNote({
      clientName: recipient?.name ?? "",
      riskProfile: snapshot?.risk.status === "Completed" ? snapshot.risk.category : null,
      goals: snapshot?.goals ?? [],
      items,
    });
    if (draft) setSuitabilityNote(draft.slice(0, 2000));
  }, [step, locked, suitabilityNote, recipient, snapshot, items]);

  // ── Load: an existing proposal, or a recipient passed in the URL ─────────
  useEffect(() => {
    let dead = false;
    (async () => {
      if (initialId) {
        const r = await fetch(`/api/proposals/${initialId}`);
        if (!r.ok) {
          if (!dead) setErr("This proposal could not be loaded.");
          setLoading(false);
          return;
        }
        const p = await r.json();
        if (dead) return;
        riskTouched.current = true;
        setMeta({ number: p.proposalNumber ?? null, version: p.version ?? 1, status: p.status, sentAt: p.sentAt ?? null });
        setRecipient({
          type: p.recipientType,
          id: p.recipientType === "lead" ? p.leadId : p.recipientType === "family" ? p.familyId : p.investorId,
          name: p.recipientName,
        });
        if (p.recipientType === "family" && p.investorId) setFamilyMemberId(p.investorId);
        setTitle(p.title ?? "Investment Proposal");
        setType(p.type ?? "mutual_fund");
        setRiskRating(p.riskRating ?? "moderate");
        setValidUntil(p.validUntil ? String(p.validUntil).slice(0, 10) : inDays(30));
        setCoverLetter(p.coverLetter ?? "");
        setDisclaimer(p.disclaimer ?? "");
        setSuitabilityNote(p.suitabilityNote ?? "");
        setItems(Array.isArray(p.products) ? p.products : []);
        setLoading(false);
        return;
      }
      const q = new URLSearchParams(window.location.search);
      const uuid = (k: string) => {
        const v = q.get(k);
        return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
      };
      const investorId = uuid("investorId"), leadId = uuid("leadId"), familyId = uuid("familyId");
      if (familyId) {
        const r = await fetch(`/api/families/${familyId}`);
        const j = r.ok ? await r.json() : null;
        const fam = j?.family ?? j;
        if (!dead && fam?.id) setRecipient({ type: "family", id: fam.id, name: fam.familyName ?? (fam.headName ? `${fam.headName} Family` : "Family") });
      } else if (investorId || leadId) {
        const r = await fetch(`/api/proposals/snapshot?${investorId ? `investorId=${investorId}` : `leadId=${leadId}`}`);
        const s = r.ok ? await r.json() : null;
        if (!dead && s?.name) setRecipient({ type: investorId ? "investor" : "lead", id: (investorId ?? leadId)!, name: s.name });
      }
    })().catch(() => setLoading(false));
    return () => {
      dead = true;
    };
  }, [initialId]);

  // ── What the CRM knows about the recipient ───────────────────────────────
  useEffect(() => {
    if (!recipient) {
      setSnapshot(null);
      return;
    }
    const qs =
      recipient.type === "lead"
        ? `leadId=${recipient.id}`
        : recipient.type === "family"
          ? familyMemberId
            ? `investorId=${familyMemberId}`
            : `familyId=${recipient.id}`
          : `investorId=${recipient.id}`;
    let dead = false;
    setSnapLoading(true);
    fetch(`/api/proposals/snapshot?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (dead) return;
        setSnapshot(s);
        const fromProfile = s?.risk?.category ? RISK_FROM_PROFILE[s.risk.category] : null;
        if (fromProfile && !riskTouched.current) setRiskRating(fromProfile);
      })
      .catch(() => !dead && setSnapshot(null))
      .finally(() => !dead && setSnapLoading(false));
    return () => {
      dead = true;
    };
  }, [recipient, familyMemberId]);

  // The type follows the products (there is no picker — the firm's call,
  // 2026-10-07): Mutual Fund, Insurance, … or Mixed when they differ.
  useEffect(() => {
    setType(typeFor(items));
  }, [items]);

  // ── Validation per step ─────────────────────────────────────────────────
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!recipient) out.push("Pick who the proposal is for.");
    if (!title.trim()) out.push("Give the proposal a title.");
    if (items.length === 0) out.push("Add at least one recommendation.");
    for (const it of items) {
      if (!itemName(it).trim() || itemName(it) === "Recommendation") {
        out.push(`Every ${itemKindLabel(it)} line needs a name.`);
        break;
      }
    }
    return out;
  }, [recipient, title, items]);

  /** What stops a SEND (a draft saves without these). Mirrors the send route. */
  const sendBlockers = useMemo(() => {
    const out = [...missing];
    if (items.some((it) => it.kind === "mf") && snapshot && snapshot.risk.status !== "Completed") {
      out.push(
        snapshot.risk.status === "Provisional"
          ? "The client's risk profile is only provisional — they must confirm it before a mutual fund proposal goes out."
          : snapshot.risk.status === "Due for review"
            ? "The client's risk profile is more than a year old — they must redo it before a mutual fund proposal goes out."
            : "A mutual fund proposal needs the client's confirmed risk profile — send them the link from the Client step."
      );
    }
    if (!suitabilityNote.trim()) out.push("Write why this proposal suits the client (suitability note).");
    return out;
  }, [missing, items, snapshot, suitabilityNote]);

  /** The builder's content, as the preview and the save both send it. */
  const content = () => ({
    title: title.trim(),
    type,
    riskRating,
    validUntil,
    coverLetter: coverLetter || undefined,
    disclaimer,
    suitabilityNote: suitabilityNote.trim() || undefined,
    products: items,
  });

  /** Save the proposal (create it the first time); returns its id, or null when it could not. */
  async function persist(): Promise<string | null> {
    if (missing.length) {
      setErr(missing[0]);
      return null;
    }
    setErr(null);
    const body: Record<string, unknown> = content();
    let id = proposalId;
    if (id) {
      const r = await fetch(`/api/proposals/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(describeError(j, r.status));
      return id;
    }
    Object.assign(body, { recipientType: recipient!.type });
    if (recipient!.type === "investor") body.investorId = recipient!.id;
    else if (recipient!.type === "lead") body.leadId = recipient!.id;
    else {
      body.familyId = recipient!.id;
      if (familyMemberId) body.investorId = familyMemberId;
    }
    // Opened from an opportunity ("Prepare proposal"): link the proposal to it.
    const opportunityId = new URLSearchParams(window.location.search).get("opportunityId");
    if (opportunityId && /^[0-9a-f-]{36}$/i.test(opportunityId)) body.opportunityId = opportunityId;
    const r = await fetch("/api/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(describeError(j, r.status));
    id = j.id as string;
    setProposalId(id);
    setMeta((m) => ({ ...m, number: j.proposalNumber ?? null, version: 1, status: "draft" }));
    window.history.replaceState(null, "", `/dashboard/proposals/${id}/edit`);
    return id;
  }

  async function saveDraft() {
    setBusy("draft");
    try {
      if (await persist()) toast.success("Draft saved");
    } catch (e: any) {
      setErr(e?.message ?? "Could not save the proposal.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="card-surface p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin mx-auto mb-2" /> Loading the proposal…
      </div>
    );
  }

  const heading = proposalId
    ? `${meta.number ?? "Proposal"}${meta.version > 1 ? ` · version ${meta.version}` : ""}`
    : recipient
      ? `New proposal · ${recipient.name}`
      : "New proposal";

  return (
    <div className="space-y-4 max-w-5xl mx-auto w-full">
      <PageHeaderCard
        title={<><FileSignature className="size-5 text-brand-cyan" /> {heading}</>}
        subtitle={
          snapshot?.rm
            ? `RM ${snapshot.rm}${snapshot.family ? ` · ${snapshot.family} family` : ""}`
            : undefined
        }
      />

      {locked && (
        <div className="rounded-lg border border-border bg-secondary/60 p-3 text-sm flex items-start gap-2">
          <Lock className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            This proposal has been sent{meta.sentAt ? ` (${formatDate(meta.sentAt)})` : ""}, so it is kept exactly as
            the client saw it. To change it, open the proposal and choose <b>Revise</b> — that creates version {meta.version + 1} with a fresh link.
          </div>
        </div>
      )}

      {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">{err}</div>}

      {/* Stepper */}
      <Card className="p-0 overflow-hidden">
        <ol className="flex overflow-x-auto" aria-label="Proposal steps">
          {STEPS.map((label, i) => {
            const done = i < step;
            const on = i === step;
            return (
              <li key={label} className="flex-1 min-w-max">
                <button
                  type="button"
                  onClick={() => (i === 0 || recipient) && setStep(i)}
                  aria-current={on ? "step" : undefined}
                  className={`w-full flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition ${
                    on ? "border-primary text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span
                    className={`grid place-items-center size-5 rounded-full text-2xs ${
                      on ? "bg-primary text-primary-foreground" : done ? "bg-success/15 text-success" : "bg-secondary"
                    }`}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      {step === 0 && (
        <>
          <Card>
            <CardHeader title="Who is this for?" />
            <div className="px-5 pb-5">
              <RecipientPicker value={recipient} onChange={setRecipient} familyMemberId={familyMemberId} onFamilyMember={setFamilyMemberId} locked={!!proposalId} />
            </div>
          </Card>

          {recipient && <SnapshotCard snapshot={snapshot} loading={snapLoading} />}

          <Card>
            <CardHeader title="Title and framing" />
            <fieldset disabled={locked} className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium">Proposal title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base mt-1" placeholder="Retirement plan" />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Overall risk rating</span>
                <SelectField
                  value={riskRating}
                  onChange={(e) => {
                    riskTouched.current = true;
                    setRiskRating(e.target.value as RiskRating);
                  }}
                  className="input-base mt-1"
                >
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                  <option value="mixed">Mixed</option>
                </SelectField>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium" title="Shown above the recommendations in the PDF">Cover letter</span>
                <textarea
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  rows={3}
                  placeholder={`Dear ${recipient?.name?.split(" ")[0] ?? "Sunita"},\n\nFollowing our conversation, here is what we discussed…`}
                  className="input-base mt-1"
                />
              </label>
            </fieldset>
          </Card>
        </>
      )}

      {step === 1 && (
        <Card>
          <CardHeader
            title={`Recommendations (${items.length})`}
            subtitle={
              snapshot?.risk.category
                ? `Checked against a ${PROFILE_LABEL[snapshot.risk.category] ?? snapshot.risk.category} risk profile as you add them.`
                : "No risk profile on file, so fit can't be checked yet."
            }
          />
          <div className="px-5 pb-5">
            <RecommendStep items={items} setItems={setItems} snapshot={snapshot} locked={locked} />
          </div>
        </Card>
      )}

      {step === 2 && recipient && (
        <ReviewStep
          name={recipient.name}
          previewBody={() => ({
            ...content(),
            recipient: { type: recipient.type, id: recipient.id, ...(familyMemberId ? { memberId: familyMemberId } : {}) },
            proposalNumber: meta.number ?? undefined,
            version: meta.version,
          })}
          disclaimer={disclaimer}
          setDisclaimer={setDisclaimer}
          locked={locked}
        />
      )}

      {step === 3 && (
        <Card>
          <CardHeader title="Send" />
          <div className="px-5 pb-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-medium">Valid until</span>
                <DateField value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="input-base mt-1" disabled={locked} />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium">
                  Why this suits {recipient?.name?.split(" ")[0] ?? "the client"} <span className="text-destructive">*</span>
                </span>
                <textarea
                  value={suitabilityNote}
                  onChange={(e) => setSuitabilityNote(e.target.value.slice(0, 2000))}
                  rows={2}
                  disabled={locked}
                  placeholder="e.g. 15-year retirement goal; equity within the client's aggressive band; discussed the volatility."
                  className="input-base mt-1"
                />
              </label>
            </div>
            {snapshot && !snapshot.hasEmail && !snapshot.hasPhone && (
              <div className="rounded-lg border border-warning/50 bg-warning/5 text-sm p-3">
                {recipient?.name} has no email or phone on file — only a link can reach them.
              </div>
            )}
            {sendBlockers.length > 0 ? (
              <ul className="space-y-1 text-sm text-destructive">
                {sendBlockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            ) : (
              !locked && (
                <SendChannels
                  firstName={recipient?.name?.split(" ")[0] ?? "the client"}
                  hasEmail={!!snapshot?.hasEmail}
                  hasPhone={!!snapshot?.hasPhone}
                  persist={persist}
                  onSent={(id) => router.push(`/dashboard/proposals/${id}`)}
                  onError={setErr}
                />
              )
            )}
            <p className="text-2xs text-muted-foreground">
              Sending marks it Proposal Sent and sets you a follow-up; you'll see when it is opened.
            </p>
          </div>
        </Card>
      )}

      {/* One bar for moving through the steps — always in reach. */}
      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
        <div>
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className={buttonClass("ghost", "sm", "gap-1.5")}>
              <ArrowLeft className="size-4" /> {STEPS[step - 1]}
            </button>
          )}
        </div>
        {!locked && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={saveDraft} disabled={busy !== null || !recipient} className={buttonClass("secondary", "sm", "gap-1.5")}>
              {busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save draft
            </button>
            {step < STEPS.length - 1 && (
              <button type="button" onClick={() => setStep(step + 1)} disabled={!recipient} className={buttonClass("primary", "sm", "gap-1.5")}>
                {STEPS[step + 1]} <ArrowRight className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Step 4's three ways out. Picking one shows exactly what goes (POST
 * /api/proposals/[id]/send with preview — nothing is sent or changed), then
 * the button sends it: email from the firm's mailbox with the PDF attached,
 * WhatsApp through the RM's own WhatsApp (wa.me), or the client's proposal
 * link to copy. The proposal is saved first each time.
 */
function SendChannels({
  firstName, hasEmail, hasPhone, persist, onSent, onError,
}: {
  firstName: string;
  hasEmail: boolean;
  hasPhone: boolean;
  persist: () => Promise<string | null>;
  onSent: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const toast = useToast();
  const [channel, setChannel] = useState<"email" | "whatsapp" | "link" | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [sentLink, setSentLink] = useState<{ id: string; url: string } | null>(null);

  async function pick(next: "email" | "whatsapp" | "link") {
    setChannel(next);
    setPreview(null);
    onError(null);
    setBusy("preview");
    try {
      const id = await persist();
      if (!id) return;
      const r = await fetch(`/api/proposals/${id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: next, preview: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Couldn't prepare it (${r.status})`);
      setPreview(j);
    } catch (e: any) {
      onError(e?.message ?? "Couldn't prepare the message.");
      setChannel(null);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!channel) return;
    setBusy("send");
    onError(null);
    // Open the WhatsApp tab inside the click, before any await — a tab opened
    // after one is blocked as a pop-up.
    const waTab = channel === "whatsapp" ? window.open("", "_blank") : null;
    try {
      const id = await persist();
      if (!id) { waTab?.close(); return; }
      const r = await fetch(`/api/proposals/${id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Couldn't send (${r.status})`);
      if (channel === "whatsapp" && j.waUrl) {
        if (waTab) waTab.location.href = j.waUrl;
        else window.open(j.waUrl, "_blank");
        toast.success("WhatsApp opened with the message — press send there");
        onSent(id);
      } else if (channel === "link" && j.url) {
        try { await navigator.clipboard.writeText(j.url); toast.success("Link copied"); } catch {}
        setSentLink({ id, url: j.url });
      } else {
        toast.success(`Emailed to ${firstName}, with the PDF attached`);
        onSent(id);
      }
    } catch (e: any) {
      waTab?.close();
      onError(e?.message ?? "Couldn't send the proposal.");
    } finally {
      setBusy(null);
    }
  }

  if (sentLink) {
    return (
      <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3">
        <div className="text-sm font-medium">Proposal marked sent. Paste this link to {firstName}:</div>
        <div className="flex gap-1">
          <input readOnly value={sentLink.url} onFocus={(e) => e.target.select()} aria-label="Proposal link" className="input-base w-full text-xs" />
          <button type="button" onClick={() => navigator.clipboard.writeText(sentLink.url).then(() => toast.success("Link copied"), () => {})} className={buttonClass("secondary", "sm", "gap-1.5")}>
            <Copy className="size-3.5" /> Copy
          </button>
          <button type="button" onClick={() => onSent(sentLink.id)} className={buttonClass("primary", "sm")}>Done</button>
        </div>
      </div>
    );
  }

  const options = [
    { key: "email" as const, label: "Email", icon: Mail, off: !hasEmail && "No email on file" },
    { key: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle, off: !hasPhone && "No phone on file" },
    { key: "link" as const, label: "Copy link", icon: Link2, off: false as const },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="How to send">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => pick(o.key)}
            disabled={!!o.off || busy !== null}
            title={o.off || undefined}
            aria-pressed={channel === o.key}
            className={buttonClass(channel === o.key ? "primary" : "secondary", "sm", "gap-1.5")}
          >
            <o.icon className="size-4" /> {o.label}
          </button>
        ))}
      </div>

      {busy === "preview" && (
        <div className="text-sm text-muted-foreground"><Loader2 className="mr-1.5 inline size-4 animate-spin" /> Preparing the message…</div>
      )}

      {preview && channel && (
        <div className="space-y-2">
          {preview.to && <div className="text-xs text-muted-foreground">To {preview.to}{preview.subject ? ` · ${preview.subject}` : ""}</div>}
          {preview.html ? (
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-80 w-full rounded-lg border border-border bg-white" />
          ) : (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/40 p-3 text-sm font-sans">{preview.text}</pre>
          )}
          {preview.attachment && <div className="text-2xs text-muted-foreground">Attached: {preview.attachment}</div>}
          <button type="button" onClick={send} disabled={busy !== null} className={buttonClass("primary", "md", "gap-1.5")}>
            {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : channel === "link" ? <Copy className="size-4" /> : <Send className="size-4" />}
            {channel === "email" ? "Send email" : channel === "whatsapp" ? "Open WhatsApp and send" : "Mark sent and copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 1: the snapshot ──────────────────────────────────────────────────

function SnapshotCard({ snapshot: s, loading }: { snapshot: ProposalSnapshot | null; loading: boolean }) {
  if (loading && !s) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin inline mr-2" /> Reading what the CRM knows…
      </Card>
    );
  }
  if (!s) return null;

  const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const riskTone = s.risk.status === "Completed" ? "success" : s.risk.status === "Not completed" ? "neutral" : "warning";

  // Only what the CRM actually holds — a prospect's five empty dashes said nothing.
  const tiles = [
    s.risk.category && {
      label: "Risk category",
      value: `${PROFILE_LABEL[s.risk.category] ?? s.risk.category}${s.risk.score != null ? ` · ${s.risk.score}` : ""}`,
    },
    s.holdings && { label: "Current AUM", value: inr(s.holdings.aum) },
    s.holdings && { label: "Running SIPs", value: `${inr(s.holdings.sipBook)}/mo` },
    s.holdings?.equityPct != null && {
      label: "Equity share",
      value: `${Math.round(s.holdings.equityPct)}%`,
      hint: s.band ? `band ${s.band.floor}–${s.band.ceiling}%` : undefined,
      warn: s.band != null && s.holdings.equityPct > s.band.ceiling,
    },
    s.goals[0] && { label: "Goal", value: `${s.goals[0].name}${s.goals[0].targetYear ? ` ${s.goals[0].targetYear}` : ""}` },
  ].filter(Boolean) as Array<{ label: string; value: string; hint?: string; warn?: boolean }>;

  return (
    <Card>
      <CardHeader
        title="From the CRM"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone={riskTone as any} raw dot>
              {s.risk.status === "Completed" && s.risk.signedAt
                ? `Risk profile confirmed ${formatDate(s.risk.signedAt)}`
                : `Risk profile: ${s.risk.status.toLowerCase()}`}
            </Badge>
            {s.risk.status !== "Completed" && <RiskProfileAction snapshot={s} />}
          </div>
        }
      />
      {tiles.length > 0 && (
        <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {tiles.map((t) => <Tile key={t.label} {...t} />)}
        </div>
      )}
    </Card>
  );
}

/**
 * The client's risk profile is not confirmed (an MF proposal needs one):
 * send them the questionnaire link — or, for a client, fill it in with them
 * now. The link is the same one the lead journey sends (POST /api/share-tokens,
 * kind risk_profile); it is shown to copy, never sent from here.
 */
function RiskProfileAction({ snapshot: s }: { snapshot: ProposalSnapshot }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  async function makeLink() {
    setBusy(true);
    try {
      const res = await fetch("/api/share-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "risk_profile", subjectType: s.kind, subjectId: s.subjectId, expiresInDays: 21 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) throw new Error(j.error ?? `Couldn't create the link (${res.status})`);
      setUrl(j.url);
      try { await navigator.clipboard.writeText(j.url); toast.success("Risk profile link copied — send it to the client"); } catch {}
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't create the link", "Risk profile");
    } finally {
      setBusy(false);
    }
  }

  if (url) {
    return (
      <span className="flex items-center gap-1">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Risk profile link" className="input-base h-8 w-56 text-xs" />
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copied"), () => {})}
          className={buttonClass("ghost", "icon")}
          aria-label="Copy link"
          title="Copy link"
        >
          <Copy className="size-3.5" />
        </button>
      </span>
    );
  }
  return (
    <>
      <button type="button" onClick={makeLink} disabled={busy} className={buttonClass("secondary", "sm", "gap-1.5")}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Send risk profile link
      </button>
      {s.kind === "investor" && (
        <Link href={`/dashboard/risk-profiles/new?investorId=${s.subjectId}`} className={buttonClass("ghost", "sm")}>
          Fill now
        </Link>
      )}
    </>
  );
}

/** `warn`: the client's book is ALREADY outside their band — worth knowing
 *  before recommending anything, not only after. */
function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 min-w-0 ${warn ? "bg-warning/10" : "bg-secondary/60"}`}>
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums break-words ${warn ? "text-warning" : ""}`}>{value}</div>
      {hint && <div className={`text-2xs ${warn ? "text-warning" : "text-muted-foreground"}`}>{warn ? `above the ${hint.replace(/^band /, "")} band` : hint}</div>}
    </div>
  );
}

// ─── Step 3: the PDF the client gets ────────────────────────────────────────

/**
 * The proposal PDF rendered from what is in the builder (POST
 * /api/proposals/preview-pdf — nothing is saved), shown inline, so what the
 * RM checks is the document the client receives. Below it, the words the
 * client signs, and the firm's own extra disclosure behind "Add a disclosure".
 */
function ReviewStep({
  name,
  previewBody,
  disclaimer,
  setDisclaimer,
  locked,
}: {
  name: string;
  previewBody: () => Record<string, unknown>;
  disclaimer: string;
  setDisclaimer: (s: string) => void;
  locked: boolean;
}) {
  const first = name.split(" ")[0] || "The client";
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(!!disclaimer.trim() && disclaimer.trim() !== OLD_DEFAULT_DISCLAIMER);
  const bodyRef = useRef(previewBody);
  bodyRef.current = previewBody;

  async function render() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/proposals/preview-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bodyRef.current()),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Couldn't render the PDF (${r.status})`);
      }
      const blob = await r.blob();
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't render the PDF.");
    } finally {
      setLoading(false);
    }
  }

  // Render on arrival; release the blob on the way out.
  useEffect(() => {
    void render();
    return () => setUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader
          title={`What ${first} receives`}
          action={
            <button type="button" onClick={render} disabled={loading} className={buttonClass("ghost", "sm", "gap-1.5")}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
            </button>
          }
        />
        <div className="px-5 pb-5">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : url ? (
            <iframe title="Proposal PDF" src={url} className="h-[80vh] w-full rounded-lg border border-border" />
          ) : (
            <div className="grid h-60 place-items-center text-sm text-muted-foreground">
              <span><Loader2 className="mr-1.5 inline size-4 animate-spin" /> Rendering the PDF…</span>
            </div>
          )}
        </div>
      </Card>
      <Card className="p-5 space-y-3">
        <div>
          <div className="text-xs font-semibold mb-1">What {first} signs</div>
          <div className="rounded-lg border bg-secondary p-3 text-sm leading-relaxed">{PROPOSAL_ACCEPTANCE_TEXT}</div>
        </div>
        {showDisclaimer ? (
          <label className="block">
            <span className="text-xs font-medium">Additional disclosure</span>
            <textarea value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} rows={3} className="input-base text-xs mt-1" disabled={locked} />
          </label>
        ) : (
          !locked && (
            <button type="button" onClick={() => setShowDisclaimer(true)} className={buttonClass("ghost", "sm", "gap-1.5")}>
              <Plus className="size-3.5" /> Add a disclosure
            </button>
          )
        )}
      </Card>
    </div>
  );
}

function describeError(j: any, status: number): string {
  const issue = Array.isArray(j?.issues) ? j.issues[0] : null;
  const detail = issue ? ` — ${(issue.path ?? []).join(".") || "field"}: ${issue.message}` : "";
  return (j?.error ?? `Save failed (${status})`) + detail;
}
