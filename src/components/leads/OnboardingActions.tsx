"use client";

/**
 * Client links — the panel on the lead detail page for what the client fills
 * in or reads themselves:
 *   - Send Risk Profile (via WA + email — generates a /r/<token> link)
 *   - Send Proposal for Approval (→ /p/<token> after creating proposal)
 *   - Share the onboarding tracker (a live read-only progress page)
 *
 * Each action calls `/api/share-tokens` to mint a fresh token, returns the
 * URL, and copies it to the clipboard with a one-tap Open WhatsApp helper.
 *
 * It used to also hold a "Convert lead to client" tile and a call-outcome
 * form. Both were second copies of controls the page already has — the
 * header's Convert button (a superset: it also takes PAN and segment) and the
 * journey card's guided actions (which capture the same outcomes with a
 * follow-up date or a lost reason).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  FileSignature,
  Loader2,
  Copy,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  ClipboardList,
} from "lucide-react";
import { InfoTip } from "@/components/dashboards/my/Shared";

type Action = "risk_profile" | "document_collection" | "proposal_approval" | "onboarding_progress";

export function OnboardingActions({
  leadId,
  leadPhone,
  leadEmail,
  leadName,
  hasRiskProfile,
  pendingProposalId,
  alreadyConvertedInvestorId,
}: {
  leadId: string;
  leadPhone: string | null;
  leadEmail: string | null;
  leadName: string;
  hasRiskProfile: boolean;
  pendingProposalId: string | null;
  alreadyConvertedInvestorId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ kind: Action; url: string; expiresAt: string } | null>(null);

  async function makeLink(kind: Action, subjectId?: string, payload?: Record<string, unknown>) {
    setBusy(kind);
    setError(null);
    setLink(null);
    try {
      const r = await fetch("/api/share-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          subjectType: kind === "proposal_approval" ? "proposal" : "lead",
          subjectId: kind === "proposal_approval" ? subjectId : leadId,
          expiresInDays: kind === "onboarding_progress" ? 30 : (kind === "proposal_approval" ? 14 : 7),
          payload,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setLink({ kind, url: data.url, expiresAt: new Date(data.expiresAt).toLocaleString("en-IN") });
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create link");
    } finally {
      setBusy(null);
    }
  }

  const isConverted = !!alreadyConvertedInvestorId;

  return (
    <div className="card-surface p-5 space-y-3">
      <div className="flex items-center gap-1">
        <h3 className="section-title flex items-center gap-2">
          <LinkIcon className="size-4 text-muted-foreground" /> Client links
        </h3>
        <InfoTip>
          Each link is private to this lead, signed, and expires on its own — the risk profile and
          proposal links work once; the tracker stays live for 30 days.
        </InfoTip>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <ActionTile
          icon={ShieldCheck}
          title="Send risk profile"
          subtitle="A link the client fills in from WhatsApp or email."
          status={hasRiskProfile ? "Already on file — sending again records a fresh score" : "Recommended next step"}
          onClick={() => makeLink("risk_profile")}
          disabled={isConverted}
          busy={busy === "risk_profile"}
        />
        <ActionTile
          icon={FileSignature}
          title="Send proposal for approval"
          subtitle={
            pendingProposalId
              ? "An acceptance link for the latest draft proposal."
              : "Create a draft proposal first, then come back."
          }
          status={pendingProposalId ? "Records a typed signature, time and device" : "No draft proposal yet"}
          onClick={() => pendingProposalId && makeLink("proposal_approval", pendingProposalId)}
          disabled={!pendingProposalId || isConverted}
          busy={busy === "proposal_approval"}
        />
        <ActionTile
          icon={ClipboardList}
          title="Share onboarding tracker"
          subtitle="A live, view-only page where the client can see how their account setup is going."
          status="Stays active for 30 days"
          onClick={() => makeLink("onboarding_progress")}
          busy={busy === "onboarding_progress"}
        />
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50/40 rounded-md p-2 flex items-start gap-1.5">
          <AlertCircle className="size-3.5 mt-0.5" /> {error}
        </div>
      )}

      {link && <LinkPanel link={link} leadName={leadName} leadPhone={leadPhone} leadEmail={leadEmail} />}
    </div>
  );
}

function ActionTile({
  icon: Icon,
  title,
  subtitle,
  status,
  onClick,
  disabled,
  busy,
  variant,
}: {
  icon: any;
  title: string;
  subtitle: string;
  status: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-40 ${
        variant === "primary" ? "border-primary/40 bg-accent hover:bg-accent/70" : "border-border hover:bg-secondary/40"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="size-4 text-muted-foreground" />
        <span className="font-semibold text-sm">{title}</span>
        {busy && <Loader2 className="size-3 animate-spin ml-auto" />}
      </div>
      <p className="text-2xs text-muted-foreground">{subtitle}</p>
      <p className="text-2xs text-muted-foreground italic mt-1">{status}</p>
    </button>
  );
}

function LinkPanel({
  link,
  leadName,
  leadPhone,
  leadEmail,
}: {
  link: { kind: Action; url: string; expiresAt: string };
  leadName: string;
  leadPhone: string | null;
  leadEmail: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const messages: Record<Action, { subject: string; wa: string; email: string }> = {
    risk_profile: {
      subject: "Your risk profile questionnaire",
      wa: `Hi ${leadName}, here's the risk profile questionnaire — it takes 5 minutes:\n\n${link.url}\n\nThis helps us recommend investments that match your goals + comfort with risk.`,
      email: `Hi ${leadName},\n\nThank you for our recent conversation. As discussed, please complete this short risk profile questionnaire — it takes about 5 minutes:\n\n${link.url}\n\nBased on your responses, I'll prepare an investment proposal tailored to your goals.\n\nRegards`,
    },
    document_collection: {
      subject: "Documents needed to open your investment account",
      wa: `Hi ${leadName}, please upload these KYC documents to open your account — secure, single-use link:\n\n${link.url}\n\nYou'll need: PAN, Aadhar, photo, recent bank statement, cancelled cheque.`,
      email: `Hi ${leadName},\n\nThank you for approving the investment proposal. To open your mutual fund account, please upload the following documents using this secure link:\n\n${link.url}\n\nRequired: PAN card, Aadhar card, passport-size photo, recent bank statement, cancelled cheque.\n\nThe link is single-use and expires soon. Reach out if you face any issue.\n\nRegards`,
    },
    proposal_approval: {
      subject: "Please review and approve your investment proposal",
      wa: `Hi ${leadName}, please review your investment proposal and approve here (signed link, expires soon):\n\n${link.url}`,
      email: `Hi ${leadName},\n\nPlease find your investment proposal attached. Review it carefully, then approve here:\n\n${link.url}\n\nThe link captures your typed signature + timestamp as your formal acceptance — required by SEBI for our records.\n\nReach out with any questions before approving.\n\nRegards`,
    },
    onboarding_progress: {
      subject: "Track your account setup progress live",
      wa: `Hi ${leadName}, you can track the status of your account opening and onboarding here:\n\n${link.url}\n\nWe will update this page as we complete each step!`,
      email: `Hi ${leadName},\n\nWe are currently setting up your investment account. You can track our progress live using this secure tracker page:\n\n${link.url}\n\nWe'll update this page in real-time as we complete each step (KYC validation, UCC activation, mandate setup, etc.).\n\nRegards`,
    },
  };

  const m = messages[link.kind];
  const waUrl = leadPhone
    ? `https://wa.me/${leadPhone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(m.wa)}`
    : null;
  const mailUrl = leadEmail ? `mailto:${leadEmail}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.email)}` : null;

  async function copy() {
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 p-3 space-y-2">
      <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
        <CheckCircle2 className="size-4" /> Link ready · expires {link.expiresAt}
      </div>

      <div className="flex gap-2">
        <input
          readOnly
          value={link.url}
          className="flex-1 border rounded-md px-2 py-1.5 text-xs font-mono bg-white"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <button onClick={copy} className="rounded-md border bg-white px-2 text-xs flex items-center gap-1 hover:bg-secondary">
          <Copy className="size-3" /> {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {waUrl && (
          <a href={waUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
            Send via WhatsApp <ExternalLink className="size-3" />
          </a>
        )}
        {mailUrl && (
          <a href={mailUrl} className="btn-secondary text-xs">
            Send via Email <ExternalLink className="size-3" />
          </a>
        )}
        <a href={link.url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
          Preview <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
