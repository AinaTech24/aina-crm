"use client";

/**
 * The client's side of a proposal (/p/<token>).
 *
 * Each recommendation has its own tick, so a client can take two funds of
 * three and say so honestly — the untaken ones stay with the RM for later. If
 * nothing fits, "Ask for a change" sends their own words to the RM rather than
 * leaving the proposal to die quietly.
 *
 * Reports the open to the CRM from the browser (not the server render), so a
 * WhatsApp or email link preview — a crawler, which runs no scripts — does not
 * count as the client reading it.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileSignature, Loader2, MessageSquareText, Clock } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";

type Item = {
  name: string;
  kind: string;
  amount: string;
  risk: string | null;
  goal: string | null;
  amc: string | null;
};

type ProposalView = {
  number: string;
  version: number;
  title: string;
  summary: string | null;
  recipientName: string;
  status: string;
  validUntil: string | null;
  expired: boolean;
  acceptedAt: string | null;
  acceptedItems: number[] | null;
  changeRequestNote: string | null;
  pdfUrl: string;
  items: Item[];
};

type Outcome =
  | { kind: "accepted"; taken: number[]; onboarding?: string }
  | { kind: "change" };

export function PublicProposalApproval({
  tokenId,
  answered,
  proposal,
  acceptanceText,
}: {
  tokenId: string;
  /** The link has already been used — show what happened, no form. */
  answered: boolean;
  proposal: ProposalView;
  acceptanceText: string;
}) {
  const all = useMemo(() => proposal.items.map((_, i) => i), [proposal.items]);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(all));
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState<null | "accept" | "change">(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const first = proposal.recipientName.split(" ")[0] || "there";

  // Tell the CRM the client opened it — once per browser session.
  useEffect(() => {
    const key = `proposal-viewed:${tokenId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked: still report, the server just counts it again */
    }
    fetch("/api/public/proposals/viewed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenId }),
      keepalive: true,
    }).catch(() => {});
  }, [tokenId]);

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function accept() {
    if (!signature.trim()) return setError("Please type your full name to sign.");
    if (proposal.items.length > 0 && picked.size === 0) {
      return setError("Tick at least one recommendation, or use “Ask for a change”.");
    }
    setBusy("accept");
    setError(null);
    try {
      const acceptedItems = [...picked].sort((a, b) => a - b);
      const r = await fetch("/api/public/proposals/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, signatureName: signature.trim(), acceptedItems }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `Something went wrong (${r.status})`);
      setOutcome({ kind: "accepted", taken: acceptedItems, onboarding: data?.onboarding });
    } catch (e: any) {
      setError(e?.message ?? "Could not record your acceptance. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function requestChange() {
    if (note.trim().length < 3) return setError("Tell us what you'd like changed.");
    setBusy("change");
    setError(null);
    try {
      const r = await fetch("/api/public/proposals/request-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, note: note.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `Something went wrong (${r.status})`);
      setOutcome({ kind: "change" });
    } catch (e: any) {
      setError(e?.message ?? "Could not send your request. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  // ── What to show ────────────────────────────────────────────────────────
  const settled = outcome ?? settledFromServer(proposal);

  return (
    <div className="space-y-4">
      <Summary proposal={proposal} />

      {settled ? (
        <Settled proposal={proposal} outcome={settled} first={first} />
      ) : answered ? (
        <Notice tone="blue" title="You've already responded to this proposal">
          Your relationship manager has your answer. You can still read the proposal above.
        </Notice>
      ) : proposal.status === "superseded" ? (
        <Notice tone="amber" title="There's a newer version of this proposal">
          Your relationship manager has updated it. Please use the latest link they sent you.
        </Notice>
      ) : proposal.expired ? (
        <Notice tone="amber" title="This proposal is no longer valid">
          It was valid until {proposal.validUntil}. Markets move, so please ask your relationship manager for an
          updated proposal.
        </Notice>
      ) : (
        <>
          <section className="bg-white rounded-xl shadow p-5 sm:p-6 space-y-1">
            <h2 className="text-base font-semibold">
              {proposal.items.length > 1 ? "Choose what you'd like to go ahead with" : "The recommendation"}
            </h2>
            {proposal.items.length > 1 && (
              <p className="text-sm text-muted-foreground">
                Untick anything you'd rather not take now — your relationship manager keeps it for a later conversation.
              </p>
            )}
            <ul className="divide-y mt-3">
              {proposal.items.map((it, i) => (
                <li key={i}>
                  <label className="flex items-start gap-3 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      onChange={() => toggle(i)}
                      disabled={proposal.items.length === 1}
                      className="mt-1"
                      aria-label={`Accept ${it.name}`}
                    />
                    <ItemLine item={it} />
                  </label>
                </li>
              ))}
              {proposal.items.length === 0 && (
                <li className="py-3 text-sm text-muted-foreground">The details are in the proposal document above.</li>
              )}
            </ul>
          </section>

          <section className="bg-white rounded-xl shadow p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <FileSignature className="size-4 text-brand-cyan" /> Your acceptance
            </h2>
            <div className="rounded-lg border bg-secondary p-3 text-sm leading-relaxed">{acceptanceText}</div>

            <label className="block">
              <div className="text-xs font-semibold mb-1">Sign by typing your full name</div>
              <input
                id="proposal-signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={proposal.recipientName || "Your full name"}
                autoComplete="name"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-2xs text-muted-foreground mt-1">
                Your typed name, with the time, IP address and browser, is kept as your electronic signature.
              </div>
            </label>

            {error && <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2">{error}</div>}

            <div className="grid gap-2">
              <button
                onClick={accept}
                disabled={busy !== null || !signature.trim() || (proposal.items.length > 0 && picked.size === 0)}
                className={buttonClass("primary", "lg", "w-full gap-2")}
              >
                {busy === "accept" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {busy === "accept" ? "Recording your acceptance…" : acceptLabel(picked.size, proposal.items.length)}
              </button>

              {!asking ? (
                <button onClick={() => { setAsking(true); setError(null); }} className={buttonClass("secondary", "lg", "w-full gap-2")}>
                  <MessageSquareText className="size-4" /> Ask for a change
                </button>
              ) : (
                <div className="rounded-lg border p-3 space-y-2">
                  <label htmlFor="proposal-change-note" className="text-xs font-semibold block">
                    What would you like changed?
                  </label>
                  <textarea
                    id="proposal-change-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="e.g. I'd prefer a lower monthly amount, or fewer small-cap funds."
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button onClick={() => setAsking(false)} className={buttonClass("ghost", "md")}>Cancel</button>
                    <button onClick={requestChange} disabled={busy !== null || note.trim().length < 3} className={buttonClass("primary", "md", "gap-2")}>
                      {busy === "change" && <Loader2 className="size-4 animate-spin" />}
                      Send to my relationship manager
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ─── pieces ────────────────────────────────────────────────────────────────

function Summary({ proposal }: { proposal: ProposalView }) {
  return (
    <section className="bg-white rounded-xl shadow p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="page-title">{proposal.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            For <span className="font-medium text-foreground">{proposal.recipientName}</span>
            {proposal.number ? (
              <>
                {" · "}
                <span className="font-mono">{proposal.number}</span>
                {proposal.version > 1 ? ` · version ${proposal.version}` : ""}
              </>
            ) : null}
          </p>
        </div>
        {proposal.validUntil && (
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Valid until</div>
            <div className="font-semibold tabular-nums">{proposal.validUntil}</div>
          </div>
        )}
      </div>
      {proposal.summary && <p className="text-sm mt-3 leading-relaxed">{proposal.summary}</p>}
      <a href={proposal.pdfUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm text-brand-cyan hover:underline">
        Read the full proposal (PDF) <ExternalLink className="size-3.5" />
      </a>
    </section>
  );
}

function ItemLine({ item, muted }: { item: Item; muted?: boolean }) {
  return (
    <div className={`flex-1 min-w-0 ${muted ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{item.name}</div>
          <div className="text-2xs text-muted-foreground mt-0.5">
            {[item.kind, item.amc, item.goal ? `for ${item.goal}` : null, item.risk ? `${item.risk} risk` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="text-sm font-semibold tabular-nums text-right shrink-0">{item.amount}</div>
      </div>
    </div>
  );
}

function Settled({ proposal, outcome, first }: { proposal: ProposalView; outcome: Outcome; first: string }) {
  if (outcome.kind === "change") {
    return (
      <Notice tone="blue" title={`Thank you, ${first} — we've let your relationship manager know`}>
        {proposal.changeRequestNote ? <>You asked: “{proposal.changeRequestNote}”. </> : null}
        They'll get back to you with an updated proposal, which will come with a new link.
      </Notice>
    );
  }
  const taken = new Set(outcome.taken);
  const partial = proposal.items.length > 0 && taken.size < proposal.items.length;
  return (
    <section className="bg-white rounded-xl shadow p-5 sm:p-6 space-y-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="size-8 text-emerald-600 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold">
            {partial ? `You accepted ${taken.size} of ${proposal.items.length} recommendations` : "You accepted this proposal"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {proposal.acceptedAt ? `Recorded on ${proposal.acceptedAt}. ` : null}
            {outcome.onboarding === "sent"
              ? "We've sent you a secure link to upload your KYC documents — please check your email and WhatsApp."
              : "Your relationship manager will be in touch with the next steps."}
          </p>
        </div>
      </div>
      {proposal.items.length > 0 && (
        <ul className="divide-y border-t">
          {proposal.items.map((it, i) => (
            <li key={i} className="flex items-start gap-3 py-3">
              {taken.has(i) ? (
                <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 shrink-0" />
              ) : (
                <Clock className="size-4 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <ItemLine item={it} muted={!taken.has(i)} />
            </li>
          ))}
        </ul>
      )}
      {partial && <p className="text-2xs text-muted-foreground">Items marked with a clock stay open with your relationship manager.</p>}
      <a href={`${proposal.pdfUrl}&download=1`} className={buttonClass("secondary", "md", "gap-2")}>
        Download your copy <ExternalLink className="size-3.5" />
      </a>
    </section>
  );
}

function Notice({ tone, title, children }: { tone: "amber" | "blue"; title: string; children: React.ReactNode }) {
  const cls = tone === "amber" ? "bg-amber-50 border-amber-200" : "bg-sky-50 border-sky-200";
  return (
    <section className={`rounded-xl border p-5 sm:p-6 ${cls}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm mt-1 leading-relaxed">{children}</p>
    </section>
  );
}

/** A link opened after the client already answered: show that answer. */
function settledFromServer(p: ProposalView): Outcome | null {
  if (["accepted", "partially_approved", "executed"].includes(p.status)) {
    return { kind: "accepted", taken: p.acceptedItems ?? p.items.map((_, i) => i) };
  }
  if (p.status === "changes_requested") return { kind: "change" };
  return null;
}

function acceptLabel(picked: number, total: number): string {
  if (total <= 1) return "Accept this proposal";
  if (picked === total) return `Accept all ${total} recommendations`;
  if (picked === 0) return "Tick at least one to accept";
  return `Accept ${picked} of ${total} recommendations`;
}
