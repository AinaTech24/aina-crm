/**
 * Risk Profiles — the CRM's module (src/app/dashboard/risk-profiles), same
 * endpoints as the web:
 *
 *   GET  /api/risk-profiles/register            the page's tab counts + one page of clients
 *   GET  /api/investors ?status=active,redemption_risk   (older servers) the active book
 *   GET  /api/risk-profiles                     (older servers) latest profile per client
 *   GET  /api/risk-profile-template             the firm's questionnaire (seed default if none)
 *   POST /api/risk-profiles                     save a questionnaire (client OTP or signed form)
 *   POST /api/risk-profiles/otp/send|verify     the client's email code before saving
 *   GET  /api/risk-profiles/upload?investorId   what the client holds now (+ minor → guardian)
 *   POST /api/risk-profiles/upload              record a profile the client already holds (PDF)
 *   POST /api/risk-profiles/send-link           email the questionnaire link (dryRun → batches)
 *   POST /api/risk-profiles/bulk-assign         suggest a PROVISIONAL category from age
 *   POST /api/risk-profiles/bulk-notify         email the clients just suggested
 *   GET  /api/risk-profiles/[id]/pdf            the branded statement
 *   GET  /api/risk-profiles/[id]/document       presigned URL of the signed / uploaded form
 *
 * The register endpoint buckets clients in SQL with the web page's own pieces,
 * a page at a time. A server that predates it (404) gets the old path: the
 * app loads the whole active book and buckets it with the TS twin in rules.ts
 * — same rows, same tabs, but slow on a large book.
 */

import { useState } from "react";
import { Linking } from "react-native";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, absUrl, ApiError } from "../../api/client";
import { useMe, hasCap } from "../../api/me";
import { downloadAndShare } from "../../lib/download";
import { displayPan, isMinorKey } from "./pan-display";
import { RISK_BUCKETS, riskBucketOf, riskExpiresOn, type AgeBand, type RiskBucket, type RiskTemplate } from "./rules";

// ── The book ────────────────────────────────────────────────────────────────

/** The investors API's page ceiling. */
const BOOK_PAGE = 200;
const PARALLEL = 4;

interface InvestorRaw {
  id: string;
  name: string | null;
  pan: string | null;
  avatarUrl?: string | null;
  riskProfile?: string | null;
  riskProfileScore?: number | null;
  riskProfileSignedAt?: string | null;
  riskProfileProvisional?: boolean | null;
  riskProfileExpiresOn?: string | null;
  riskProfileExpiryFor?: string | null;
  isMinor?: boolean | null;
  investorCategory?: string | null;
  guardianInvestorId?: string | null;
}

interface LatestRaw {
  id: string;
  investor_id: string;
  total_score: number | null;
  next_review_at: string | null;
  document_url: string | null;
}

export interface RiskRow {
  id: string;
  name: string;
  /** Raw column, upper-cased — matched by search only, never shown (it can hold an import key). */
  panKey: string;
  /** Masked own PAN, or null. */
  pan: string | null;
  avatarUrl: string | null;
  category: string | null;
  provisional: boolean;
  signedAt: string | null;
  expiresOn: string | null;
  score: number | null;
  nextReviewAt: string | null;
  isMinor: boolean;
  /** A minor linked to a guardian: the profile is the guardian's (read-only here). */
  guardianId: string | null;
  bucket: RiskBucket;
  profileId: string | null;
  hasDocument: boolean;
}

function toRow(i: InvestorRaw, latest: LatestRaw | undefined, now: Date): RiskRow {
  const exp = riskExpiresOn(i);
  return {
    id: i.id,
    name: i.name ?? "",
    panKey: (i.pan ?? "").toUpperCase(),
    pan: displayPan(i.pan),
    avatarUrl: i.avatarUrl ?? null,
    category: i.riskProfile ?? null,
    provisional: i.riskProfileProvisional === true,
    signedAt: i.riskProfileSignedAt ?? null,
    expiresOn: exp && !Number.isNaN(exp.getTime()) ? exp.toISOString().slice(0, 10) : null,
    score: latest?.total_score ?? i.riskProfileScore ?? null,
    nextReviewAt: latest?.next_review_at ?? null,
    isMinor: i.isMinor === true || isMinorKey(i.pan),
    guardianId: i.investorCategory === "minor" && i.guardianInvestorId ? i.guardianInvestorId : null,
    bucket: riskBucketOf(i, now),
    profileId: latest?.id ?? null,
    hasDocument: !!latest?.document_url,
  };
}

export function useRiskCaps() {
  const { data: me } = useMe();
  const caps = me?.capabilities;
  const seesAll = hasCap(caps, "investor.view.all");
  return {
    me,
    seesAll,
    canView: seesAll || hasCap(caps, "investor.view.assigned"),
    /** Save / upload / suggest / bulk email (the server's gate on every write). */
    canManage: hasCap(caps, "risk_profile.manage"),
    /** POST /api/client-forms/send. */
    canSendForm: hasCap(caps, "communication.send") || hasCap(caps, "investor.edit.assigned"),
  };
}

/**
 * The whole active book, bucketed on the phone — only for a server without
 * GET /api/risk-profiles/register. An RM without firm-wide view sees only
 * their own book, as on the web.
 */
function useRiskBook(enabled: boolean) {
  const { me, seesAll, canView } = useRiskCaps();
  const rm = seesAll ? undefined : me?.user.id;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const q = useQuery({
    queryKey: ["risk-book", "whole", rm ?? "all"],
    enabled: enabled && !!me && canView,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const params = { status: "active,redemption_risk", sort: "name", dir: "asc", limit: BOOK_PAGE, rm };
      const [first, latest] = await Promise.all([
        api.get<{ rows: InvestorRaw[]; total: number }>("/api/investors", { ...params, page: 0 }),
        api.get<{ profiles: LatestRaw[] }>("/api/risk-profiles"),
      ]);
      const all: InvestorRaw[] = [...first.rows];
      const pages = Math.ceil((first.total ?? 0) / BOOK_PAGE);
      setProgress({ done: all.length, total: first.total ?? all.length });
      let next = 1;
      const worker = async () => {
        while (next < pages) {
          const page = next++;
          const r = await api.get<{ rows: InvestorRaw[] }>("/api/investors", { ...params, page });
          all.push(...r.rows);
          setProgress({ done: all.length, total: first.total });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, Math.max(0, pages - 1)) }, worker));
      const byInvestor = new Map((latest.profiles ?? []).map((p) => [String(p.investor_id), p]));
      const now = new Date();
      const seen = new Set<string>();
      const rows: RiskRow[] = [];
      for (const i of all) {
        if (seen.has(i.id)) continue;
        seen.add(i.id);
        rows.push(toRow(i, byInvestor.get(i.id), now));
      }
      setProgress(null);
      return rows;
    },
  });
  return {
    rows: q.data,
    loading: !me || (canView && q.isPending),
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
    isRefetching: q.isRefetching,
    progress,
    canView: !!me && canView,
  };
}

interface RegisterPage {
  counts: Record<RiskBucket, number>;
  notProfiledAll: number;
  total: number;
  page: number;
  pageSize: number;
  rows: Omit<RiskRow, "panKey">[];
}

const missingRoute = (e: unknown) => e instanceof ApiError && e.status === 404;

/** The new-profile picker's order: never profiled first, then the longest since signing. */
function pickerOrder(rows: RiskRow[]): RiskRow[] {
  const t = (s: string | null) => (s ? new Date(s).getTime() : -Infinity);
  return [...rows].sort((a, b) => {
    const an = a.signedAt ? 1 : 0, bn = b.signedAt ? 1 : 0;
    if (an !== bn) return an - bn;
    const d = t(a.signedAt) - t(b.signedAt);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

/**
 * The Risk Profiles list: tab counts and the clients in `filter` (one bucket,
 * several — a dashboard's `due,expired` — or "all" for the picker), searched
 * by name or PAN on the server, a page of 50 at a time.
 */
export function useRiskRegister(filter: RiskBucket[] | "all", q: string) {
  const { me, canView } = useRiskCaps();
  const key = filter === "all" ? "all" : filter.join(",");
  const reg = useInfiniteQuery({
    queryKey: ["risk-book", "register", key, q],
    enabled: !!me && canView,
    initialPageParam: 1,
    staleTime: 60_000,
    retry: (n, e) => !missingRoute(e) && n < 2,
    queryFn: ({ pageParam }) => api.get<RegisterPage>("/api/risk-profiles/register", { filter: key, q: q || undefined, page: pageParam }),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const legacy = missingRoute(reg.error);
  const book = useRiskBook(legacy);

  if (legacy) {
    const searched = (book.rows ?? []).filter((r) => matchesSearch(r, q));
    const counts = Object.fromEntries(RISK_BUCKETS.map((b) => [b.key, 0])) as Record<RiskBucket, number>;
    for (const r of searched) counts[r.bucket]++;
    const rows = filter === "all" ? pickerOrder(searched) : sortForBucket(searched.filter((r) => filter.includes(r.bucket)), filter[0]);
    return {
      rows: book.rows ? rows : undefined,
      counts,
      notProfiledAll: (book.rows ?? []).filter((r) => r.bucket === "not_profiled").length,
      total: rows.length,
      loading: book.loading,
      isError: book.isError,
      error: book.error,
      refetch: book.refetch,
      isRefetching: book.isRefetching,
      hasMore: false,
      loadMore: () => {},
      progress: book.progress,
      canView: book.canView,
    };
  }

  const first = reg.data?.pages[0];
  return {
    rows: reg.data ? reg.data.pages.flatMap((p) => p.rows.map((r) => ({ ...r, panKey: "" }))) : undefined,
    counts: first?.counts ?? (Object.fromEntries(RISK_BUCKETS.map((b) => [b.key, 0])) as Record<RiskBucket, number>),
    notProfiledAll: first?.notProfiledAll ?? 0,
    total: first?.total ?? 0,
    loading: !me || (canView && reg.isPending),
    isError: reg.isError,
    error: reg.error,
    refetch: reg.refetch,
    isRefetching: reg.isRefetching && !reg.isFetchingNextPage,
    hasMore: !!reg.hasNextPage,
    loadMore: () => { if (reg.hasNextPage && !reg.isFetchingNextPage) reg.fetchNextPage(); },
    progress: null as { done: number; total: number } | null,
    canView: !!me && canView,
  };
}

/** Each tab's order, most actionable first (the web's orderClause). */
export function sortForBucket(rows: RiskRow[], bucket: RiskBucket): RiskRow[] {
  const t = (s: string | null) => (s ? new Date(s).getTime() : NaN);
  const byName = (a: RiskRow, b: RiskRow) => a.name.localeCompare(b.name);
  if (bucket === "current") {
    return [...rows].sort((a, b) => {
      const x = t(a.signedAt), y = t(b.signedAt);
      if (Number.isNaN(x) && Number.isNaN(y)) return byName(a, b);
      if (Number.isNaN(x)) return 1;
      if (Number.isNaN(y)) return -1;
      return y - x;
    });
  }
  if (bucket === "due" || bucket === "expired") return [...rows].sort((a, b) => t(a.signedAt) - t(b.signedAt));
  return [...rows].sort(byName);
}

/** The web's search: client name, or the PAN column (upper-cased). */
export function matchesSearch(r: RiskRow, q: string): boolean {
  const s = q.trim();
  if (!s) return true;
  return r.name.toLowerCase().includes(s.toLowerCase()) || r.panKey.includes(s.toUpperCase());
}

function useInvalidateRisk() {
  const qc = useQueryClient();
  return (investorId?: string) => {
    qc.invalidateQueries({ queryKey: ["risk-book"] });
    qc.invalidateQueries({ queryKey: ["risk-current"] });
    qc.invalidateQueries({ queryKey: ["investors"] });
    if (investorId) {
      qc.invalidateQueries({ queryKey: ["investor-full", investorId] });
      qc.invalidateQueries({ queryKey: ["investor", investorId] });
    } else {
      qc.invalidateQueries({ queryKey: ["investor-full"] });
      qc.invalidateQueries({ queryKey: ["investor"] });
    }
  };
}

// ── One client ──────────────────────────────────────────────────────────────

export interface RiskCurrent {
  id: string;
  name: string;
  /** The guardian's name when this is a minor whose profile is the guardian's. */
  minorOf: string | null;
  current: { category: string | null; score: number | null; signedAt: string | null; expiresOn: string | null; provisional: boolean } | null;
}

/** What the client holds now (GET /api/risk-profiles/upload). */
export function useRiskCurrent(investorId?: string) {
  return useQuery({
    queryKey: ["risk-current", investorId],
    enabled: !!investorId,
    queryFn: () => api.get<RiskCurrent>("/api/risk-profiles/upload", { investorId }),
  });
}

/** The firm's active questionnaire. Settings → Risk questionnaire invalidates this key on save. */
export function useRiskTemplate() {
  return useQuery({
    queryKey: ["risk-template"],
    queryFn: () => api.get<{ template: RiskTemplate }>("/api/risk-profile-template").then((r) => r.template),
    staleTime: 5 * 60_000,
  });
}

/** The branded statement, through the phone's share sheet (view / save / WhatsApp). */
export function shareRiskPdf(profileId: string, clientName: string) {
  const safe = clientName.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "client";
  return downloadAndShare(`/api/risk-profiles/${profileId}/pdf?download=1`, `RiskProfile_${safe}.pdf`);
}

/** The signed / uploaded form: a short-lived presigned URL, opened in the browser. */
export async function openSignedForm(profileId: string) {
  const r = await api.get<{ url: string }>(`/api/risk-profiles/${profileId}/document`);
  const url = absUrl(r.url);
  if (!url) throw new Error("No signed form attached");
  await Linking.openURL(url);
}

// ── Capture (the RM's questionnaire) ────────────────────────────────────────

export function useSendRiskOtp() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (b: { investorId: string; email?: string }) =>
      api.post<{ ok: true; maskedEmail: string; resendInSeconds: number }>("/api/risk-profiles/otp/send", b),
  });
}

export function useVerifyRiskOtp() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (b: { investorId: string; code: string }) =>
      api.post<{ ok: true; maskedEmail: string }>("/api/risk-profiles/otp/verify", b),
  });
}

export interface PickedFile { uri: string; name: string; mime: string; size?: number | null }

/** The signed paper form, stored the way the web wizard stores it. Returns the storage key. */
export function useUploadSignedForm() {
  return useMutation({
    meta: { silent: true },
    mutationFn: async (input: PickedFile & { clientName?: string }) => {
      const form = new FormData();
      form.append("file", { uri: input.uri, name: input.name, type: input.mime } as any);
      form.append("kind", "kyc");
      form.append("docType", "risk-profile-signed");
      if (input.clientName) form.append("clientName", input.clientName);
      const r = await api.upload<{ key: string }>("/api/compliance/upload", form);
      if (!r?.key) throw new Error("Upload failed");
      return r.key;
    },
  });
}

export interface SaveRiskBody {
  investorId: string;
  age?: number;
  answers: Record<string, string>;
  rmRemarks?: string;
  signedByName?: string;
  signOffMethod: "otp" | "signature";
  documentUrl?: string;
}

export function useSaveRiskProfile() {
  const invalidate = useInvalidateRisk();
  return useMutation({
    meta: { silent: true },
    mutationFn: (b: SaveRiskBody) =>
      api.post<{ id: string; category: string; bandLabel: string; totalScore: number; nextReviewAt: string }>("/api/risk-profiles", b),
    onSuccess: (_r, b) => invalidate(b.investorId),
  });
}

// ── Upload a profile the client already holds ──────────────────────────────

export interface UploadRiskBody {
  investorId: string;
  category: string;
  score: string;
  assessedOn: string;
  expiresOn: string;
  assessedBy?: string;
  remarks?: string;
  file: PickedFile;
}

export function useUploadRiskProfile() {
  const invalidate = useInvalidateRisk();
  return useMutation({
    meta: { silent: true },
    mutationFn: (b: UploadRiskBody) => {
      const form = new FormData();
      form.append("file", { uri: b.file.uri, name: b.file.name, type: b.file.mime || "application/pdf" } as any);
      form.append("investorId", b.investorId);
      form.append("category", b.category);
      form.append("score", b.score);
      form.append("assessedOn", b.assessedOn);
      form.append("expiresOn", b.expiresOn);
      if (b.assessedBy) form.append("assessedBy", b.assessedBy);
      if (b.remarks) form.append("remarks", b.remarks);
      return api.upload<{ id: string; becameCurrent: boolean; alreadyExpired: boolean }>("/api/risk-profiles/upload", form);
    },
    onSuccess: (_r, b) => invalidate(b.investorId),
  });
}

// ── Email the questionnaire link (bulk) ─────────────────────────────────────

export interface SendLinkPreview {
  total: number;
  sendable: number;
  noEmail: number;
  noEmailSample: string[];
  recent: number;
  recentDays: number;
  blocked: number;
  templates: Array<{ key: string; name: string; subject: string | null; problem: string | null; audience: number; sending: number; blocked: number }>;
  ids: string[];
  batchSize: number;
}

export function previewSendLink(target: { investorIds: string[] } | { audience: "not_profiled" }) {
  return api.post<SendLinkPreview>("/api/risk-profiles/send-link", { ...target, dryRun: true });
}

export function sendLinkBatch(investorIds: string[]) {
  return api.post<{ attempted: number; sent: number; skipped: number; failed: unknown[]; notSent: number }>(
    "/api/risk-profiles/send-link",
    { investorIds },
  );
}

// ── Suggest from age (provisional) ──────────────────────────────────────────

export interface AgePreview {
  dryRun: true;
  bands: AgeBand[];
  counts: { active: number; assign: number; no_dob: number; already_profiled: number; unchanged: number };
  byCategory: Record<string, number>;
  capped: boolean;
  limit: number;
  sample: Array<{ name: string; age: number | null; next: string | null }>;
  noDobSample: string[];
}

export function previewAgeAssign(refreshProvisional: boolean) {
  return api.post<AgePreview>("/api/risk-profiles/bulk-assign", { dryRun: true, refreshProvisional });
}

export function applyAgeAssign(bands: AgeBand[], refreshProvisional: boolean) {
  return api.post<{ assigned: string[]; assignedCount: number; remaining: number }>(
    "/api/risk-profiles/bulk-assign",
    { bands, refreshProvisional },
  );
}

export function notifyProvisional(investorIds: string[]) {
  return api.post<{ sent: number; skipped: number; noEmail: number; failed: unknown[] }>(
    "/api/risk-profiles/bulk-notify",
    { investorIds },
  );
}

/** For the bulk sheets, which call the API directly (they loop in batches). */
export function useRiskRefresh() {
  return useInvalidateRisk();
}
