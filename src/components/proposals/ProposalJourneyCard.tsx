"use client";

/**
 * The proposal, on the lead's or client's own journey.
 *
 * Shows the current proposal's timeline — sent, opened, decided, executed —
 * and the next step, so the RM can see what the client did and act without
 * opening the Proposals module. Renders nothing until there is a proposal:
 * the journey's own stage actions already offer "Create proposal".
 *
 * Self-contained (fetches its own data), so a page adds it with one line.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSignature, GitBranch, Loader2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ProposalTimeline } from "./ProposalTimeline";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  draft: "neutral",
  ready: "neutral",
  sent: "info",
  viewed: "info",
  changes_requested: "warning",
  accepted: "success",
  partially_approved: "success",
  executed: "success",
  rejected: "danger",
  expired: "neutral",
};

const REVISABLE = ["sent", "viewed", "changes_requested", "rejected", "expired"];

export function ProposalJourneyCard({ leadId, investorId }: { leadId?: string | null; investorId?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [p, setP] = useState<any | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const qs = leadId ? `leadId=${leadId}` : investorId ? `investorId=${investorId}` : null;
    if (!qs) return setP(null);
    let dead = false;
    fetch(`/api/proposals/current?${qs}`)
      .then((r) => (r.ok ? r.json() : { proposal: null }))
      .then((j) => !dead && setP(j.proposal ?? null))
      .catch(() => !dead && setP(null));
    return () => {
      dead = true;
    };
  }, [leadId, investorId]);

  if (!p) return null;

  const first = String(p.recipientName ?? "").split(" ")[0] || "the client";
  const label = String(p.status).replace(/_/g, " ");

  async function revise() {
    setBusy(true);
    try {
      const r = await fetch(`/api/proposals/${p.id}/revise`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      toast.success(`Version ${j.version} created — the old link is withdrawn.`);
      router.push(`/dashboard/proposals/${j.id}/edit`);
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't revise");
    } finally {
      setBusy(false);
    }
  }

  const next =
    p.status === "draft" || p.status === "ready"
      ? { text: "Finish and send it", href: `/dashboard/proposals/${p.id}/edit` }
      : p.status === "changes_requested"
        ? { text: `${first} asked for changes — revise it`, revise: true }
        : p.status === "sent" || p.status === "viewed"
          ? { text: p.viewedAt ? `${first} has opened it — a good moment to call` : `Waiting for ${first} to open it`, href: `/dashboard/proposals/${p.id}` }
          : p.status === "accepted" || p.status === "partially_approved"
            ? { text: p.executedAt ? "Executed" : "Accepted — waiting for the investment to land", href: `/dashboard/proposals/${p.id}` }
            : { text: "Open the proposal", href: `/dashboard/proposals/${p.id}` };

  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileSignature className="size-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {p.proposalNumber}
              {(p.version ?? 1) > 1 ? ` · v${p.version}` : ""} · {p.title}
            </div>
            <div className="text-2xs text-muted-foreground">Proposal on this journey</div>
          </div>
        </div>
        <Badge tone={STATUS_TONE[p.status] ?? "neutral"} raw dot>
          <span className="capitalize">{label}</span>
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-3">
          <ProposalTimeline proposal={p} />
        </div>
        <div className="md:col-span-2 space-y-2">
          <div className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">Next step</div>
          <p className="text-sm">{next.text}</p>
          <div className="flex flex-wrap gap-2">
            {"revise" in next && next.revise ? (
              <button type="button" onClick={revise} disabled={busy} className="btn-primary text-xs">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />} Revise (creates v{(p.version ?? 1) + 1})
              </button>
            ) : (
              <Link href={(next as any).href} className="btn-primary text-xs">
                Open <ExternalLink className="size-3.5" />
              </Link>
            )}
            {REVISABLE.includes(p.status) && !("revise" in next) && (
              <button type="button" onClick={revise} disabled={busy} className="btn-secondary text-xs">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />} Revise
              </button>
            )}
          </div>
          {leadId && (p.status === "sent" || p.status === "viewed") && (
            <p className="text-2xs text-muted-foreground">Accepting moves this journey to Won and sends the document link automatically.</p>
          )}
        </div>
      </div>
    </div>
  );
}
