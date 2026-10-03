"use client";

/**
 * The proposal builder — four steps, in the order an RM thinks about it:
 *
 *   1. Client       who it's for, and what the CRM already knows about them
 *   2. Recommend    the one recommendation list, checked against the profile
 *   3. Review       exactly what the client will see and sign
 *   4. Send         validity, then on to the send page
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
import { ArrowLeft, ArrowRight, Check, FileSignature, Loader2, Save, Send, Lock } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import type { ProposalSnapshot } from "@/lib/proposals/snapshot";
import { PROPOSAL_ACCEPTANCE_TEXT } from "@/lib/proposals/acceptance";
import { itemAmountText, itemKindLabel, itemName, itemRiskLabel } from "@/lib/proposals/items";
import { RecipientPicker, type Recipient } from "./RecipientPicker";
import { RecommendStep, type Item } from "./RecommendStep";

type ProposalType = "comprehensive" | "mutual_fund" | "insurance" | "pms" | "aif" | "mixed";
type RiskRating = "conservative" | "moderate" | "aggressive" | "mixed";

const STEPS = ["Client", "Recommend", "Review as client", "Send"] as const;

const DEFAULT_DISCLAIMER =
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
  const typeTouched = useRef(false);
  const [riskRating, setRiskRating] = useState<RiskRating>("moderate");
  const riskTouched = useRef(false);
  const [validUntil, setValidUntil] = useState(inDays(30));
  const [coverLetter, setCoverLetter] = useState("");
  const [disclaimer, setDisclaimer] = useState(DEFAULT_DISCLAIMER);
  const [items, setItems] = useState<Item[]>([]);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | "draft" | "send">(null);
  const [err, setErr] = useState<string | null>(null);

  const locked = !!proposalId && !EDITABLE.includes(meta.status);

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
        typeTouched.current = true;
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
        setDisclaimer(p.disclaimer ?? DEFAULT_DISCLAIMER);
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

  // The type follows the products until the RM picks one.
  useEffect(() => {
    if (!typeTouched.current) setType(typeFor(items));
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

  async function save(intent: "draft" | "send") {
    if (missing.length) {
      setErr(missing[0]);
      return;
    }
    setBusy(intent);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        type,
        riskRating,
        validUntil,
        coverLetter: coverLetter || undefined,
        disclaimer,
        products: items,
      };
      let id = proposalId;
      if (id) {
        const r = await fetch(`/api/proposals/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(describeError(j, r.status));
      } else {
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
      }
      if (intent === "send") {
        router.push(`/dashboard/proposals/${id}`);
      } else {
        toast.success("Draft saved");
      }
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
            : "Build it from what the CRM already knows, check the fit, then send."
        }
        actions={
          !locked && (
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => save("draft")} disabled={busy !== null || !recipient} className="btn-secondary text-sm">
                {busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save draft
              </button>
              {step < STEPS.length - 1 ? (
                <button type="button" onClick={() => setStep(step + 1)} disabled={!recipient} className="btn-primary text-sm">
                  Next: {STEPS[step + 1]} <ArrowRight className="size-4" />
                </button>
              ) : (
                <button type="button" onClick={() => save("send")} disabled={busy !== null || missing.length > 0} className="btn-primary text-sm">
                  {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Save and send
                </button>
              )}
            </div>
          )
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
                <span className="text-xs font-medium">Type</span>
                <SelectField
                  value={type}
                  onChange={(e) => {
                    typeTouched.current = true;
                    setType(e.target.value as ProposalType);
                  }}
                  className="input-base mt-1"
                >
                  <option value="mutual_fund">Mutual Fund</option>
                  <option value="insurance">Insurance</option>
                  <option value="pms">PMS</option>
                  <option value="aif">AIF</option>
                  <option value="comprehensive">Comprehensive</option>
                  <option value="mixed">Mixed</option>
                </SelectField>
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
                <span className="text-xs font-medium">Cover letter (shown above the recommendations in the PDF)</span>
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

      {step === 2 && (
        <ReviewStep
          name={recipient?.name ?? ""}
          title={title}
          coverLetter={coverLetter}
          items={items}
          disclaimer={disclaimer}
          setDisclaimer={setDisclaimer}
          locked={locked}
        />
      )}

      {step === 3 && (
        <Card>
          <CardHeader title="Send" />
          <div className="px-5 pb-5 space-y-4">
            <label className="block max-w-xs">
              <span className="text-xs font-medium">Valid until</span>
              <DateField value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="input-base mt-1" disabled={locked} />
            </label>
            {snapshot && !snapshot.hasEmail && !snapshot.hasPhone && (
              <div className="rounded-lg border border-warning/50 bg-warning/5 text-sm p-3">
                {recipient?.name} has no email or phone on file. Add one before sending, or the proposal can't reach them.
              </div>
            )}
            <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
              <li>Sending moves {recipient?.type === "lead" ? "this lead" : "the journey"} to <b className="text-foreground">Proposal Sent</b> and sets a follow-up task for you.</li>
              <li>You'll be told when {recipient?.name?.split(" ")[0] ?? "the client"} opens it.</li>
              <li>They can accept all of it, part of it, or ask for a change. Accepting moves a lead to Won and sends them the document link.</li>
            </ul>
            {missing.length > 0 && (
              <div className="text-sm text-destructive">
                Before sending: {missing.join(" ")}
              </div>
            )}
            {!locked && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => save("draft")} disabled={busy !== null || !recipient} className="btn-secondary text-sm">
                  {busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save draft
                </button>
                <button type="button" onClick={() => save("send")} disabled={busy !== null || missing.length > 0} className="btn-primary text-sm">
                  {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Save and send
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {step > 0 && (
        <div className="flex justify-start">
          <button type="button" onClick={() => setStep(step - 1)} className="btn-ghost text-sm">
            <ArrowLeft className="size-4" /> Back to {STEPS[step - 1]}
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

  return (
    <Card>
      <CardHeader
        title="From the CRM — nothing to retype"
        subtitle={s.kind === "lead" ? "A prospect: no holdings yet." : undefined}
        action={
          <Badge tone={riskTone as any} raw dot>
            {s.risk.status === "Completed" && s.risk.signedAt
              ? `Risk profile confirmed ${formatDate(s.risk.signedAt)}`
              : `Risk profile: ${s.risk.status.toLowerCase()}`}
          </Badge>
        }
      />
      <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Tile label="Risk category" value={s.risk.category ? `${PROFILE_LABEL[s.risk.category] ?? s.risk.category}${s.risk.score != null ? ` · ${s.risk.score}` : ""}` : "—"} />
        <Tile label="Current AUM" value={s.holdings ? inr(s.holdings.aum) : "—"} />
        <Tile label="Running SIPs" value={s.holdings ? `${inr(s.holdings.sipBook)}/mo` : "—"} />
        <Tile
          label="Equity share"
          value={s.holdings?.equityPct != null ? `${Math.round(s.holdings.equityPct)}%` : "—"}
          hint={s.band ? `band ${s.band.floor}–${s.band.ceiling}%` : undefined}
          warn={s.band != null && s.holdings?.equityPct != null && s.holdings.equityPct > s.band.ceiling}
        />
        <Tile label="Goal" value={s.goals[0] ? `${s.goals[0].name}${s.goals[0].targetYear ? ` ${s.goals[0].targetYear}` : ""}` : "—"} />
      </div>
    </Card>
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

// ─── Step 3: what the client will see ──────────────────────────────────────

function ReviewStep({
  name,
  title,
  coverLetter,
  items,
  disclaimer,
  setDisclaimer,
  locked,
}: {
  name: string;
  title: string;
  coverLetter: string;
  items: Item[];
  disclaimer: string;
  setDisclaimer: (s: string) => void;
  locked: boolean;
}) {
  const first = name.split(" ")[0] || "The client";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        This is what {first} sees on their phone or laptop. They tick the recommendations they accept, sign, or ask for a change.
      </p>
      <Card className="p-5 space-y-3">
        <div>
          <h2 className="page-title">{title || "Investment Proposal"}</h2>
          <p className="text-sm text-muted-foreground">For {name}</p>
        </div>
        {coverLetter && <p className="text-sm whitespace-pre-line leading-relaxed">{coverLetter}</p>}
        <ul className="divide-y">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-3 py-3">
              <span className="mt-1 size-4 rounded border-2 border-primary bg-primary grid place-items-center text-primary-foreground shrink-0">
                <Check className="size-3" />
              </span>
              <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{itemName(it)}</div>
                  <div className="text-2xs text-muted-foreground">
                    {[itemKindLabel(it), (it as any).amcName ?? (it as any).insurer ?? (it as any).manager ?? (it as any).company, (it as any).goal ? `for ${(it as any).goal}` : null, itemRiskLabel(it) ? `${itemRiskLabel(it)} risk` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums text-right shrink-0">{itemAmountText(it)}</div>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="py-3 text-sm text-muted-foreground">No recommendations yet — add them in the previous step.</li>}
        </ul>
        <div>
          <div className="text-xs font-semibold mb-1">What {first} signs</div>
          <div className="rounded-lg border bg-secondary p-3 text-sm leading-relaxed">{PROPOSAL_ACCEPTANCE_TEXT}</div>
        </div>
      </Card>
      <Card className="p-5">
        <label className="block">
          <span className="text-xs font-medium">Disclaimer (PDF footer)</span>
          <textarea value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} rows={3} className="input-base text-xs mt-1" disabled={locked} />
        </label>
      </Card>
    </div>
  );
}

function describeError(j: any, status: number): string {
  const issue = Array.isArray(j?.issues) ? j.issues[0] : null;
  const detail = issue ? ` — ${(issue.path ?? []).join(".") || "field"}: ${issue.message}` : "";
  return (j?.error ?? `Save failed (${status})`) + detail;
}
