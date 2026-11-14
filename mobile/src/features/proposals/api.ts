/**
 * Proposals data layer — the live CRM's proposals API (src/app/api/proposals).
 *
 *   GET    /api/proposals                     list (includes superseded versions — hide them)
 *   POST   /api/proposals                     create a DRAFT { recipientType, investorId|leadId|familyId,
 *                                              title, products, riskRating?, validUntil?, coverLetter?, type?,
 *                                              opportunityId? } → { id, proposalNumber }
 *   GET    /api/proposals/[id]                one (the row)
 *   PATCH  /api/proposals/[id]                draft/ready: content; any time: status, validUntil,
 *                                              rejectionReason, suitabilityNote(+OverrideReason)
 *   DELETE /api/proposals/[id]                cancel (status rejected, reason "deleted")
 *   POST   /api/proposals/[id]/send           { channel: email|whatsapp|link, preview? }
 *   POST   /api/proposals/[id]/revise         a sent one → a new draft version { id, version }
 *   GET    /api/proposals/snapshot            what the CRM knows about the recipient: risk profile
 *                                              (the send gate), holdings, equity vs the band, goals
 *   GET    /api/proposals/[id]/pdf?download=1 the PDF the client receives (pdf.ts)
 *   POST   /api/proposals/preview-pdf         the PDF rendered from the builder, nothing saved (pdf.ts)
 *   GET    /api/mf/schemes?plan=regular       the firm's Scheme Master, Regular plans only
 *   GET    /api/mf/amcs                       the Scheme Master's AMCs
 *   GET    /api/families?q= · /[id]/full      the builder's family recipient + its members
 *
 * The firm's rules: a proposal is sent only when the RM taps Send; once sent
 * its content is frozen (a change is a new version); every MF scheme and AMC
 * comes from the Scheme Master; a mutual fund proposal needs the client's
 * confirmed risk profile signed in the last 12 months (a minor needs none).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/** The AMFI riskometer's six levels (a scheme pick fills it). */
export type Riskometer = "low" | "low_to_moderate" | "moderate" | "moderately_high" | "high" | "very_high";
export const RISKOMETER_LABEL: Record<Riskometer, string> = {
  low: "Low", low_to_moderate: "Low to moderate", moderate: "Moderate", moderately_high: "Moderately high", high: "High", very_high: "Very high",
};
const BAND_LEVEL: Record<number, Riskometer> = { 1: "low", 2: "low_to_moderate", 3: "moderate", 4: "moderately_high", 5: "high", 6: "very_high" };
export const riskometerLevel = (band?: number | null): Riskometer | undefined => (band ? BAND_LEVEL[band] : undefined);

export type RecommendationType = "sip" | "lumpsum" | "swp" | "stp";

// ── Line items (discriminated by `kind`) — exact shape of proposals.products ──
export type MfLine = {
  kind: "mf"; schemeName: string; amcName?: string; schemeCode?: string; category?: string;
  recommendationType?: RecommendationType; planType?: "regular" | "direct";
  monthlyAmount?: number; lumpsum?: number; sipTermYears?: number; stepUpPct?: number; expectedReturn?: number;
  riskRating?: Riskometer; projectedCorpus?: number; goal?: string;
  corpusRequired?: number; monthlyWithdrawal?: number; swpPeriodMonths?: number;
  toSchemeName?: string; toSchemeCode?: string; monthlyTransfer?: number; numInstallments?: number;
  suitabilityReason?: string; notes?: string;
};
export type InsuranceLine = { kind: "insurance"; policyName: string; insurer?: string; policyType?: "term" | "ulip" | "endowment" | "health" | "money_back" | "other"; sumAssured?: number; annualPremium?: number; termYears?: number; riderNotes?: string; notes?: string };
export type PmsLine = { kind: "pms"; strategyName: string; manager?: string; minInvestment?: number; proposedAmount?: number; expectedReturn?: number; termYears?: number; exitLoad?: string; notes?: string };
export type AifLine = { kind: "aif"; fundName: string; manager?: string; category?: "cat1" | "cat2" | "cat3"; minInvestment?: number; proposedAmount?: number; lockInYears?: number; targetIrr?: number; notes?: string };
export type OtherLine = { kind: "other"; productName: string; company?: string; amount?: number; expectedReturn?: number; termYears?: number; remarks?: string; notes?: string };
export type ProposalLine = MfLine | InsuranceLine | PmsLine | AifLine | OtherLine;
export type LineKind = ProposalLine["kind"];

export type ProposalStatus =
  | "draft" | "ready" | "sent" | "viewed" | "changes_requested" | "accepted" | "partially_approved"
  | "executed" | "rejected" | "expired" | "superseded";
export type RecipientType = "investor" | "lead" | "family";
export type ProposalType = "comprehensive" | "mutual_fund" | "insurance" | "pms" | "aif" | "mixed";
export type RiskRating = "conservative" | "moderate" | "aggressive" | "mixed";

export interface Proposal {
  id: string;
  proposalNumber: string;
  recipientType: RecipientType;
  investorId: string | null;
  leadId: string | null;
  familyId: string | null;
  opportunityId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  type: ProposalType;
  title: string;
  summary: string | null;
  coverLetter: string | null;
  disclaimer: string | null;
  products: ProposalLine[];
  totalInvestment: string | number | null;
  expectedCorpus: string | number | null;
  riskRating: RiskRating | null;
  status: ProposalStatus;
  validUntil: string | null;
  sentAt: string | null;
  suitabilityNote: string | null;
  suitabilityOverrideReason: string | null;
  rejectionReason: string | null;
  changeRequestNote: string | null;
  /** Indexes of the lines the client accepted (a partial approval). */
  acceptedItems: number[] | null;
  version: number | null;
  parentProposalId: string | null;
  supersededById: string | null;
  viewCount: number | null;
  lastViewedAt: string | null;
  preparedByUserId: string | null;
  createdAt: string;
  // The life of it — the timeline reads these (web ProposalTimeline).
  preparedAt?: string | null;
  viewedAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  changeRequestedAt?: string | null;
  executedAt?: string | null;
  executedAmount?: string | number | null;
  updatedAt?: string | null;
}

export interface CreateProposalBody {
  /** The opportunity this proposal answers (proposals.opportunity_id). */
  opportunityId?: string;
  recipientType: RecipientType;
  investorId?: string;
  leadId?: string;
  familyId?: string;
  type?: ProposalType;
  title: string;
  coverLetter?: string;
  disclaimer?: string;
  suitabilityNote?: string;
  products: ProposalLine[];
  riskRating?: RiskRating;
  validUntil?: string;
}

/** Statuses after which the proposal can no longer be sent (the send route answers 409). */
export const CLOSED_FOR_SEND = new Set<ProposalStatus>(["superseded", "accepted", "partially_approved", "executed", "rejected"]);
/** The client can still answer: accept / decline / ask for changes. */
export const AWAITING_CLIENT = new Set<ProposalStatus>(["sent", "viewed", "changes_requested"]);
/** A sent proposal that can be revised into a new version. */
export const REVISABLE = new Set<ProposalStatus>(["sent", "viewed", "changes_requested", "rejected", "expired"]);
export const isDraft = (s: ProposalStatus) => s === "draft" || s === "ready";
/** Cancelled from the list is a soft reject with this reason. */
export const isCancelled = (p: Pick<Proposal, "status" | "rejectionReason">) => p.status === "rejected" && p.rejectionReason === "deleted";
export const pastValidity = (p: Pick<Proposal, "validUntil">) => !!p.validUntil && new Date(p.validUntil).getTime() < Date.now();

export function useProposals() {
  return useQuery({
    queryKey: ["proposals"],
    queryFn: () => api.get<{ proposals: Proposal[] }>("/api/proposals").then((r) => r.proposals),
    staleTime: 30_000,
  });
}

export function useProposal(id: string) {
  return useQuery({
    queryKey: ["proposal", id],
    queryFn: () => api.get<Proposal>(`/api/proposals/${id}`),
    enabled: !!id,
  });
}

/** Refresh everything a proposal change shows up in (lists, the page, a lead's journey, opportunities). */
export function useRefreshProposals(id?: string) {
  return useRefresh(id);
}

/** An email preview's HTML as readable text (the phone has no sandboxed iframe for it). */
export const stripHtml = (h?: string) =>
  (h ?? "").replace(/<head[\s\S]*?<\/head>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "’").replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function useRefresh(id?: string) {
  const qc = useQueryClient();
  return () => {
    if (id) qc.invalidateQueries({ queryKey: ["proposal", id] });
    qc.invalidateQueries({ queryKey: ["proposals"] });
    qc.invalidateQueries({ queryKey: ["lead-proposal"] });
    qc.invalidateQueries({ queryKey: ["client-opportunities"] });
  };
}

export function useCreateProposal() {
  const done = useRefresh();
  return useMutation({
    mutationFn: (body: CreateProposalBody) => api.post<{ id: string; proposalNumber: string }>("/api/proposals", body),
    onSuccess: done,
    meta: { silent: true },
  });
}

export function useUpdateProposal(id: string) {
  const done = useRefresh(id);
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<Proposal>(`/api/proposals/${id}`, patch),
    onSuccess: done,
  });
}

export function useCancelProposal() {
  const done = useRefresh();
  return useMutation({ mutationFn: (id: string) => api.del(`/api/proposals/${id}`), onSuccess: done });
}

export function useReviseProposal(id: string) {
  const done = useRefresh(id);
  return useMutation({
    mutationFn: () => api.post<{ id: string; version: number }>(`/api/proposals/${id}/revise`, {}),
    onSuccess: done,
  });
}

export type SendChannel = "email" | "whatsapp" | "link";
export interface SendPreview { ok: boolean; channel: SendChannel; to?: string; subject?: string; html?: string; text?: string; attachment?: string }
export interface SendResult { ok: boolean; channel: SendChannel; externalId?: string | null; waUrl?: string | null; url?: string | null }

/** Preview first (nothing is sent or changed — the gates still run), then send.
 *  Both are silent: the screen reads the gate a 412 names and says what to do. */
export function useSendProposal(id: string) {
  const done = useRefresh(id);
  return {
    preview: useMutation({
      mutationFn: (channel: SendChannel) => api.post<SendPreview>(`/api/proposals/${id}/send`, { channel, preview: true }),
      meta: { silent: true },
    }),
    send: useMutation({
      mutationFn: (channel: SendChannel) => api.post<SendResult>(`/api/proposals/${id}/send`, { channel }),
      onSuccess: done,
      meta: { silent: true },
    }),
  };
}

/**
 * What the CRM knows about the recipient (web lib/proposals/snapshot
 * ProposalSnapshot) — the risk profile decides the send gate; holdings, the
 * profile's equity band and goals feed the builder's fit checks.
 */
export interface ProposalSnapshot {
  kind: "investor" | "lead";
  /** The record the numbers are about (for a family: the member or the head). */
  subjectId: string;
  name: string;
  family: string | null;
  rm: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** A minor needs no risk profile (the firm's rule of 2026-10-30). */
  riskExempt: boolean;
  /** status: Completed / Provisional / Due for review / Not completed. */
  risk: { category: string | null; score: number | null; signedAt: string | null; status: string };
  /** Null for a lead — no holdings is not ₹0 of holdings. */
  holdings: null | { aum: number; sipBook: number; equityPct: number | null; equityValue: number };
  band: { floor: number; ceiling: number } | null;
  goals: Array<{ name: string; targetYear: number | null }>;
  stage: string | null;
}
export type RecipientSnapshot = ProposalSnapshot;
export function useRecipientSnapshot(who: { investorId?: string | null; leadId?: string | null; familyId?: string | null } | null) {
  const params = who ? { investorId: who.investorId || undefined, leadId: who.leadId || undefined, familyId: who.familyId || undefined } : null;
  return useQuery({
    queryKey: ["proposal-snapshot", params],
    enabled: !!params && !!(params.investorId || params.leadId || params.familyId),
    queryFn: () => api.get<ProposalSnapshot>("/api/proposals/snapshot", params!),
    staleTime: 60_000,
  });
}

// ── A family recipient (web RecipientPicker) ──
export interface FamilyHit { id: string; name: string; head: string | null }
/** Families in the viewer's scope, searched by family / head / member name. */
export function useFamilySearch(q: string, enabled: boolean) {
  const term = q.trim();
  return useQuery({
    queryKey: ["proposal-families", term],
    enabled,
    queryFn: () =>
      api.get<{ families: any[] }>("/api/families", { q: term || undefined, limit: 30 }).then((r) =>
        (r.families ?? []).map((f): FamilyHit => {
          const head = f.head_name ?? f.headName ?? null;
          return { id: f.id, name: f.family_name ?? f.familyName ?? (head ? `${head} Family` : "Family"), head };
        })
      ),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
export interface FamilyMember { id: string; name: string; familyRole: string | null }
/** A picked family's members, for the optional "address proposal to". */
export function useFamilyMembers(familyId: string | null) {
  return useQuery({
    queryKey: ["proposal-family-members", familyId],
    enabled: !!familyId,
    queryFn: () =>
      api.get<any>(`/api/families/${familyId}/full`).then((j) => {
        const f = j?.family ?? {};
        const head = f.headName ?? f.head_name ?? null;
        return {
          name: (f.familyName ?? f.family_name ?? (head ? `${head} Family` : "Family")) as string,
          primaryId: (j?.primary?.id ?? null) as string | null,
          members: (j?.members ?? []) as FamilyMember[],
        };
      }),
    staleTime: 60_000,
  });
}
/** The risk profile is good enough to send a mutual fund proposal. */
export const riskReady = (s?: RecipientSnapshot) => !!s && (s.riskExempt || s.risk.status === "Completed");

// ── The firm's Scheme Master (every MF scheme / AMC picks from it) ──
export interface SchemeHit { schemeCode: string; schemeName: string; amc: string | null; category: string | null; nav: number | null; navDate: string | null; risk: { band: number; label: string; tone: string } | null; plan?: string | null }
/** A proposal recommends Regular plans only; a task's scheme row may be any plan in the master. */
export function useSchemeSearch(q: string, amc?: string | null, opts: { regularOnly?: boolean } = {}) {
  const term = q.trim();
  const regular = opts.regularOnly !== false;
  return useQuery({
    queryKey: ["mf-schemes", term, amc ?? "", regular],
    queryFn: () => api.get<{ schemes: SchemeHit[]; masterEmpty?: boolean }>("/api/mf/schemes", { q: term, limit: "20", plan: regular ? "regular" : undefined, amc: amc || undefined }),
    enabled: term.length >= 2 || !!amc,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useAmcs() {
  return useQuery({
    queryKey: ["mf-amcs"],
    queryFn: () => api.get<{ amcs: Array<{ code: string; name: string; schemes?: number }>; masterEmpty?: boolean }>("/api/mf/amcs"),
    staleTime: 10 * 60_000,
  });
}

// ── helpers ──
export const num = (v: unknown): number => { const n = Number(v ?? 0); return isFinite(n) ? n : 0; };

/** Investment a line contributes — the server's lineItemInvestment (lib/proposals/projections). */
export function lineAmount(l: ProposalLine): number {
  switch (l.kind) {
    case "mf": return num(l.lumpsum) + (l.monthlyAmount && l.sipTermYears ? num(l.monthlyAmount) * 12 * num(l.sipTermYears) : 0);
    case "insurance": return num(l.annualPremium);
    case "pms": return num(l.proposedAmount);
    case "aif": return num(l.proposedAmount);
    case "other": return num(l.amount);
  }
}

export function lineTitle(l: ProposalLine): string {
  switch (l.kind) {
    case "mf": return l.schemeName;
    case "insurance": return l.policyName;
    case "pms": return l.strategyName;
    case "aif": return l.fundName;
    case "other": return l.productName;
  }
}

/** The proposal type follows its products (web ProposalBuilder typeFor): one kind → its type, several or Other → mixed. */
export function proposalTypeFor(lines: ProposalLine[]): ProposalType {
  const kinds = new Set(lines.map((l) => l.kind));
  if (kinds.size === 0 || kinds.size > 1) return kinds.size > 1 ? "mixed" : "mutual_fund";
  const only = [...kinds][0];
  return only === "mf" ? "mutual_fund" : only === "other" ? "mixed" : only;
}

export const TYPE_LABEL: Record<ProposalType, string> = {
  comprehensive: "Comprehensive", mutual_fund: "Mutual Fund", insurance: "Insurance", pms: "PMS", aif: "AIF", mixed: "Mixed",
};
export const RECIPIENT_LABEL: Record<RecipientType, string> = { investor: "Client", lead: "Lead", family: "Family" };
/** Risk profile words (web PROFILE_LABEL). */
export const PROFILE_LABEL: Record<string, string> = {
  conservative: "Conservative", moderate: "Moderate", aggressive: "Aggressive", very_aggressive: "Very aggressive",
};

/** WhatsApp can use an Indian mobile, or a foreign number written with its +code (web proposal page). */
export function indianMobile10(raw?: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
export const phoneOk = (raw?: string | null) => {
  const p = String(raw ?? "").trim();
  return !p || !!indianMobile10(p) || /^\+\d[\d\s()-]{6,18}$/.test(p);
};
export const formatPhone = (raw?: string | null) => {
  const m = indianMobile10(raw);
  return m ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : String(raw ?? "").trim();
};

/** The overall risk rating starts at the client's profile (very aggressive reads as aggressive). */
export function ratingFromProfile(category?: string | null): RiskRating | null {
  if (!category) return null;
  if (category === "very_aggressive") return "aggressive";
  return (["conservative", "moderate", "aggressive"] as const).find((c) => c === category) ?? null;
}

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  mf: "Mutual Fund", insurance: "Insurance", pms: "PMS", aif: "AIF", other: "Other",
};

/** The web list's words and tones (ProposalsBulkTable STATUS). */
export const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft", ready: "Ready", sent: "Sent", viewed: "Viewed", changes_requested: "Changes requested",
  accepted: "Accepted", partially_approved: "Partially approved", executed: "Executed", rejected: "Rejected",
  expired: "Expired", superseded: "Superseded",
};
export const STATUS_TONE: Record<ProposalStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral", ready: "info", sent: "warning", viewed: "info", changes_requested: "warning", accepted: "success",
  partially_approved: "warning", executed: "success", rejected: "danger", expired: "danger", superseded: "neutral",
};

/** The insurers the web builder lists (lib/insurance/insurers); anything else is typed as "Other". */
export const INSURERS = [
  "Life Insurance Corporation of India", "HDFC Life", "HDFC ERGO", "ICICI Prudential", "ICICI Lombard",
  "SBI Life", "SBI General", "Max Life", "Bajaj Allianz", "Tata AIA", "Tata AIG", "Kotak Mahindra",
  "Aditya Birla Sun Life", "Aditya Birla Health", "Star Health", "Care Health", "Niva Bupa", "PNB MetLife",
  "Canara HSBC", "IndiaFirst", "Pramerica", "Exide Life", "Aegon", "Edelweiss", "Bharti AXA", "Future Generali",
  "IFFCO Tokio", "Cholamandalam", "Royal Sundaram", "New India Assurance", "Oriental Insurance", "United India",
  "National Insurance", "ManipalCigna", "Reliance", "Shriram", "Digit", "Acko", "Aviva", "LIC",
];

/** A 400's first issue as the web shows it (describeError): "products › 0 › schemeName: Required". */
export function describeError(e: any, fallback: string): string {
  const issue = e?.body?.issues?.[0];
  if (issue) return `${(issue.path ?? []).join(" › ")}${issue.path?.length ? ": " : ""}${issue.message}`;
  return e?.body?.error ?? e?.message ?? fallback;
}
