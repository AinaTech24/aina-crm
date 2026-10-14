import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  ChevronLeft,
  Download,
  Send,
  CheckCircle2,
  XCircle,
  FileSignature,
  Calendar,
  IndianRupee,
  TrendingUp,
  Phone,
  Mail,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { proposals } from "@/db/schema";
import { suitabilityProfile } from "@/lib/risk-profile/own-assessment";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dataWallAppliesFor } from "@/lib/investors/access";
import { loadViewableProposal } from "@/lib/proposals/access";
import { formatDate, formatINR, formatPhone, isValidIndianMobile } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { ProposalStatusActions } from "@/components/proposals/ProposalStatusActions";
import { ProposalSendActions } from "@/components/proposals/ProposalSendActions";
import { ProposalSuitabilityPanel } from "@/components/proposals/ProposalSuitabilityPanel";
import { draftSuitabilityNote } from "@/lib/proposals/suitability-note";
import { loadProposalSnapshot } from "@/lib/proposals/snapshot";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { ProposalTimeline } from "@/components/proposals/ProposalTimeline";
import { itemAmountText, itemKindLabel } from "@/lib/proposals/items";

const TYPE_LABEL: Record<string, string> = {
  comprehensive: "Comprehensive",
  mutual_fund: "Mutual Fund",
  insurance: "Insurance",
  pms: "PMS",
  aif: "AIF",
  mixed: "Mixed",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-secondary text-foreground",
  ready: "bg-blue-50 text-blue-700",
  sent: "bg-amber-50 text-amber-700",
  viewed: "bg-cyan-50 text-cyan-700",
  accepted: "bg-emerald-50 text-emerald-700",
  partially_approved: "bg-emerald-50 text-emerald-700",
  executed: "bg-emerald-100 text-emerald-800",
  changes_requested: "bg-amber-50 text-amber-800",
  rejected: "bg-rose-50 text-rose-700",
  expired: "bg-secondary text-foreground",
  superseded: "bg-secondary text-muted-foreground",
};

/** Statuses the send route refuses (api/proposals/[id]/send). */
const CLOSED_FOR_SENDING = ["superseded", "accepted", "partially_approved", "executed", "rejected"];

const KIND_LABEL: Record<string, string> = {
  mf: "Mutual Fund",
  insurance: "Insurance",
  pms: "PMS",
  aif: "AIF",
  other: "Other Product",
};

export const dynamic = "force-dynamic";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  // Under the data wall, the same gate and scope as GET /api/proposals/[id]:
  // own proposals unless the viewer sees all, and the client / lead / family
  // in scope — 404 otherwise, never a thrown 403.
  if (!can(session.roles, "proposal.view", session.permissions) && (await dataWallAppliesFor(session))) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const p = await loadViewableProposal(tx, session, id);
    if (!p) return null;
    // A minor's risk is their own assessment, never the guardian's copy (G-1) —
    // the same profile the send gate checks.
    const inv = p.investorId
      ? { riskProfile: (await suitabilityProfile(tx, p.tenantId, p.investorId)).category }
      : null;
    // Every version of this proposal, oldest first.
    const versions = await tx
      .select({ id: proposals.id, version: proposals.version, status: proposals.status, sentAt: proposals.sentAt })
      .from(proposals)
      .where(and(eq(proposals.tenantId, p.tenantId), eq(proposals.proposalNumber, p.proposalNumber)))
      .orderBy(asc(proposals.version));
    // The suitability note, drafted from this proposal and the client's CONFIRMED risk profile.
    const snap = await loadProposalSnapshot(tx, p.tenantId, {
      investorId: p.investorId, familyId: (p as any).familyId ?? null, leadId: p.leadId,
    });
    const suggestedNote = draftSuitabilityNote({
      clientName: String(p.recipientName ?? ""),
      riskProfile: snap?.risk.status === "Completed" ? snap.risk.category : null,
      goals: snap?.goals ?? [],
      items: (p.products ?? []) as any[],
    });
    return { p, inv, versions, suggestedNote };
  });
  if (!data) notFound();
  const { p, inv, versions, suggestedNote } = data;
  const products = (p.products ?? []) as any[];
  const accepted = Array.isArray(p.acceptedItems) ? new Set(p.acceptedItems as number[]) : null;
  const latest = versions[versions.length - 1];
  const firstName = String(p.recipientName ?? "").split(" ")[0] || "The client";
  const sendable = !CLOSED_FOR_SENDING.includes(p.status as string);
  // A draft's next step is sending it; after that, the client's answer is.
  const isDraft = p.status === "draft" || p.status === "ready";
  const phone = String(p.recipientPhone ?? "").trim();
  // WhatsApp can use an Indian mobile, or a foreign number written with its +code.
  const phoneOk = !phone || isValidIndianMobile(phone) || /^\+\d[\d\s()-]{6,18}$/.test(phone);

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/dashboard/proposals"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronLeft className="size-4" /> Back to proposals
      </Link>

      <RecordProvenance
        entityType="proposal"
        entityId={p.id}
        createdAt={p.createdAt}
        updatedAt={p.updatedAt}
        className="mt-1"
      />

      {/* Hero card */}
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-2xs uppercase tracking-[0.18em] text-white/70 font-semibold font-mono">
                {p.proposalNumber}
                {(p.version ?? 1) > 1 || versions.length > 1 ? ` · v${p.version ?? 1}` : ""}
              </div>
              {/* Not .page-title: it sets the body text colour, which vanished on
                  the dark header for a firm with a dark brand colour. */}
              <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-white">{p.title}</h1>
              <div className="text-white/85 text-sm mt-1 flex items-center gap-3 flex-wrap">
                <span>{TYPE_LABEL[p.type]}</span>
                <span className="text-white/40">·</span>
                <span>For {p.recipientName}</span>
                {p.validUntil && (
                  <>
                    <span className="text-white/40">·</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5" /> Valid till{" "}
                      {formatDate(p.validUntil)}
                    </span>
                  </>
                )}
              </div>
            </div>
            <span
              className={`chip ${STATUS_TONE[p.status] ?? ""} font-semibold capitalize`}
            >
              {p.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </div>

      {p.status === "superseded" && latest && latest.id !== p.id && (
        <div className="rounded-lg border border-border bg-secondary/60 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>This is version {p.version ?? 1}. It was replaced by version {latest.version}, and its client link was withdrawn.</span>
          <Link href={`/dashboard/proposals/${latest.id}`} className="btn-secondary text-xs">Open version {latest.version}</Link>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
              Total investment
            </span>
            <IndianRupee className="size-4 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold mt-2 tabular-nums">
            {p.totalInvestment ? formatINR(Number(p.totalInvestment)) : "—"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
              Projected corpus
            </span>
            <TrendingUp className="size-4 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold mt-2 tabular-nums text-emerald-700">
            {p.expectedCorpus ? formatINR(Number(p.expectedCorpus)) : "—"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
            Risk rating
          </div>
          <div className="text-xl font-bold mt-2 capitalize">
            {p.riskRating ?? "—"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
            Recommendations
          </div>
          <div className="text-xl font-bold mt-2 tabular-nums">{products.length}</div>
        </div>
      </div>

      {/* One card: who it goes to and how to reach them, the record (PDF,
          edit / revise), then the next step — send while it is a draft, record
          the client's answer once it has gone. */}
      <div className="card-surface p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold">To {p.recipientName}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" aria-hidden />
                {phone ? (
                  <>
                    <span className="tabular-nums text-foreground">{formatPhone(phone)}</span>
                    {!phoneOk && (
                      <span title="Not a valid mobile number, so WhatsApp may open the wrong chat. Correct it on the client's or lead's record.">
                        <Badge tone="warning">Check number</Badge>
                      </span>
                    )}
                  </>
                ) : (
                  "No mobile on file"
                )}
              </span>
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Mail className="size-3.5" aria-hidden />
                {p.recipientEmail ? <span className="text-foreground break-all">{p.recipientEmail}</span> : "No email on file"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Real PDF (Content-Disposition: attachment) — saves directly, no new tab. */}
            <DownloadButton
              url={`/api/proposals/${p.id}/pdf?download=1`}
              filename={`Proposal_${String(p.proposalNumber ?? p.id).replace(/[^a-z0-9]+/gi, "_")}.pdf`}
              className="btn-secondary text-xs"
            >
              <Download className="size-3.5" /> Download PDF
            </DownloadButton>
            <ProposalStatusActions id={p.id} status={p.status} version={p.version ?? 1} group="manage" />
          </div>
        </div>
        {/* Not once the client has answered or a newer version replaced it: the
            send route refuses those, so the buttons would only lead to an error. */}
        {sendable && (
          <div className="border-t border-border pt-3 flex items-center gap-2 flex-wrap">
            <ProposalSendActions
              id={p.id}
              hasEmail={!!p.recipientEmail}
              hasPhone={!!phone}
              status={p.status}
              primary={isDraft}
              suggestedNote={suggestedNote}
            />
            <ProposalStatusActions id={p.id} status={p.status} version={p.version ?? 1} group="decide" />
          </div>
        )}
      </div>

      {/* What the client did */}
      <div className={`grid grid-cols-1 gap-4 ${versions.length > 1 ? "md:grid-cols-3" : ""}`}>
        <div className={`card-surface p-5 ${versions.length > 1 ? "md:col-span-2" : ""}`}>
          <h2 className="section-title mb-3">What {firstName} did</h2>
          <ProposalTimeline proposal={p as any} />
        </div>
        {versions.length > 1 && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-3">Versions</h2>
          <ol className="space-y-1.5 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                {v.id === p.id ? (
                  <span className="font-semibold">Version {v.version} (this one)</span>
                ) : (
                  <Link href={`/dashboard/proposals/${v.id}`} className="hover:underline">Version {v.version}</Link>
                )}
                <span className="chip text-2xs capitalize">{String(v.status).replace(/_/g, " ")}</span>
              </li>
            ))}
          </ol>
        </div>
        )}
      </div>

      {/* Cover letter */}
      {p.coverLetter && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-2">Cover letter</h2>
          <p className="text-sm whitespace-pre-line leading-relaxed">{p.coverLetter}</p>
        </div>
      )}

      {/* Suitability & Compliance Panel */}
      <ProposalSuitabilityPanel
        proposalId={p.id}
        initialSuitabilityNote={(p as any).suitabilityNote}
        initialOverrideReason={(p as any).suitabilityOverrideReason}
        suggestedNote={suggestedNote}
        clientRiskProfile={inv?.riskProfile as any}
        schemes={products
          .filter((it: any) => it.kind === "mf")
          .map((it: any) => ({
            name: it.schemeName,
            riskRating: it.riskRating,
          }))}
      />

      {/* Products */}
      <div className="card-surface p-5">
        <h2 className="section-title mb-3">Products ({products.length})</h2>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No line items.</p>
        ) : (
          <ul className="space-y-3">
            {products.map((it: any, i: number) => (
              <li
                key={i}
                className="rounded-xl border border-border/70 bg-background p-4"
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {accepted && (
                    <span className={`chip text-2xs font-semibold ${accepted.has(i) ? "bg-emerald-50 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                      {accepted.has(i) ? "Accepted" : "Not taken"}
                    </span>
                  )}
                  <span
                    className={`chip text-2xs ${
                      it.kind === "mf"
                        ? "bg-emerald-50 text-emerald-700"
                        : it.kind === "insurance"
                        ? "bg-blue-50 text-blue-700"
                        : it.kind === "pms"
                        ? "bg-amber-50 text-amber-700"
                        : it.kind === "other"
                        ? "bg-secondary text-foreground"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {it.kind === "mf" ? `Mutual Fund · ${itemKindLabel(it)}` : KIND_LABEL[it.kind] ?? it.kind}
                  </span>
                  <span className="font-semibold text-sm">
                    {it.schemeName ?? it.policyName ?? it.strategyName ?? it.fundName ?? it.productName}
                  </span>
                </div>
                <ProductDetails it={it} />
                {it.notes && (
                  <p className="mt-2 text-xs text-muted-foreground italic">{it.notes}</p>
                )}
                {it.suitabilityReason && (
                  <p className="mt-1 text-xs text-warning">Kept above the risk band: {it.suitabilityReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.disclaimer && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-2">Disclaimer</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">{p.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function ProductDetails({ it }: { it: any }) {
  const kv: [string, string][] = [];
  if (it.kind === "mf") {
    if (it.amcName) kv.push(["AMC", it.amcName]);
    if (it.category) kv.push(["Category", it.category]);
    if (it.recommendationType === "swp" || it.recommendationType === "stp") kv.push([it.recommendationType.toUpperCase(), itemAmountText(it)]);
    if (it.corpusRequired) kv.push(["Corpus", formatINR(Number(it.corpusRequired))]);
    if (it.lumpsum) kv.push(["Lumpsum", formatINR(Number(it.lumpsum))]);
    if (it.monthlyAmount) kv.push(["SIP", `${formatINR(Number(it.monthlyAmount))}/mo`]);
    if (it.stepUpPct) kv.push(["Step-up", `${it.stepUpPct}% a year`]);
    if (it.goal) kv.push(["Goal", it.goal]);
    if (it.planType) kv.push(["Plan", it.planType === "direct" ? "Direct" : "Regular"]);
    if (it.sipTermYears) kv.push(["Term", `${it.sipTermYears} yrs`]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.riskRating) kv.push(["Risk", String(it.riskRating).replace(/_/g, " ")]);
    if (it.projectedCorpus) kv.push(["Projected", formatINR(Number(it.projectedCorpus))]);
  } else if (it.kind === "insurance") {
    if (it.insurer) kv.push(["Insurer", it.insurer]);
    if (it.policyType) kv.push(["Type", it.policyType]);
    if (it.sumAssured) kv.push(["Sum assured", formatINR(Number(it.sumAssured))]);
    if (it.annualPremium) kv.push(["Annual premium", formatINR(Number(it.annualPremium))]);
    if (it.termYears) kv.push(["Term", `${it.termYears} yrs`]);
  } else if (it.kind === "pms") {
    if (it.manager) kv.push(["Manager", it.manager]);
    if (it.minInvestment) kv.push(["Min", formatINR(Number(it.minInvestment))]);
    if (it.proposedAmount) kv.push(["Proposed", formatINR(Number(it.proposedAmount))]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.termYears) kv.push(["Horizon", `${it.termYears} yrs`]);
    const pmsProj = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.expectedReturn ?? 0) / 100, Number(it.termYears ?? 0));
    if (pmsProj) kv.push(["Projected", formatINR(Math.round(pmsProj))]);
  } else if (it.kind === "aif") {
    if (it.manager) kv.push(["Manager", it.manager]);
    if (it.category) kv.push(["Category", String(it.category).toUpperCase()]);
    if (it.minInvestment) kv.push(["Min", formatINR(Number(it.minInvestment))]);
    if (it.proposedAmount) kv.push(["Proposed", formatINR(Number(it.proposedAmount))]);
    if (it.lockInYears) kv.push(["Lock-in", `${it.lockInYears} yrs`]);
    if (it.targetIrr) kv.push(["Target IRR", `${it.targetIrr}% p.a.`]);
    const aifProj = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.targetIrr ?? 0) / 100, Number(it.lockInYears ?? 0));
    if (aifProj) kv.push(["Projected", formatINR(Math.round(aifProj))]);
  } else if (it.kind === "other") {
    if (it.company) kv.push(["Company", it.company]);
    if (it.amount) kv.push(["Amount", formatINR(Number(it.amount))]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.termYears) kv.push(["Term", `${it.termYears} yrs`]);
    const otherProj =
      Number(it.amount ?? 0) > 0 && Number(it.expectedReturn ?? 0) > 0 && Number(it.termYears ?? 0) > 0
        ? Number(it.amount) * Math.pow(1 + Number(it.expectedReturn) / 100, Number(it.termYears))
        : 0;
    if (otherProj) kv.push(["Expected FV", formatINR(Math.round(otherProj))]);
    if (it.remarks) kv.push(["Remarks", it.remarks]);
  }
  if (kv.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      {kv.map(([k, v]) => (
        <div key={k} className="bg-secondary/40 rounded px-2 py-1.5">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground">
            {k}
          </div>
          <div className="font-semibold mt-0.5">{v}</div>
        </div>
      ))}
    </div>
  );
}
