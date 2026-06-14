import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { ChevronLeft, Phone, Mail, MessageCircle, MapPin, AlertTriangle, User2, ShieldCheck } from "lucide-react";
import { withTenant } from "@/db/client";
import {
  investors,
  folios,
  sips,
  goals,
  transactions,
  communications,
  tasks,
  serviceRequests,
  consents,
  auditLog,
  users,
  families,
  reviewMeetings,
  riskProfileResponses,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";
import { InvestorEditPanel } from "@/components/investors/InvestorEditPanel";
import { CheckInButton, LogActivityButton } from "@/components/activities/ActivityLogger";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { RowActions } from "@/components/common/RowActions";
import { VerifyContact } from "@/components/investors/VerifyContact";
import { RecommendedActions } from "@/components/investors/RecommendedActions";
import { AiClientBrief } from "@/components/investors/AiClientBrief";
import { BestTimeBadge } from "@/components/investors/BestTimeBadge";
import { OnboardingWizardButton } from "@/components/investors/OnboardingWizard";
import { QuickCommsPanel } from "@/components/investors/QuickCommsPanel";
import { ActivityTimeline } from "@/components/investors/ActivityTimeline";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { InvestorBlueprintStageBar } from "@/components/investors/InvestorBlueprintStageBar";
import { ClientHealthCard } from "@/components/investors/ClientHealthCard";
import { PortfolioAllocation } from "@/components/investors/PortfolioAllocation";
import { FamilySnapshot } from "@/components/investors/FamilySnapshot";
import { PortfolioValuationCard } from "@/components/investors/PortfolioValuationCard";
import { StatementActions } from "@/components/investors/StatementActions";
import { valueInvestor } from "@/lib/finance/valuation";
import { ChurnRiskCard } from "@/components/investors/ChurnRiskCard";
import { churnForInvestor } from "@/lib/churn/scan";
import { TransactionLedger } from "@/components/investors/TransactionLedger";
import { SipHealthCard, type SipHealth } from "@/components/investors/SipHealthCard";
import { CrossSellCard } from "@/components/investors/CrossSellCard";
import { RelatedModulesRail } from "@/components/investors/RelatedModulesRail";
import { InvestorDocumentsSection } from "@/components/investors/InvestorDocumentsSection";
import { InvestorAvatarEditor } from "@/components/investors/InvestorAvatarEditor";
import { EmailRelatedList } from "@/components/comms/EmailRelatedList";
import { WhatsAppRelatedList } from "@/components/comms/WhatsAppRelatedList";
import { SectionNav } from "@/components/common/SectionNav";
import { MasterRecordEditor } from "@/components/investors/MasterRecordEditor";
import { crossSellOpportunities } from "@/lib/investors/cross-sell";
import {
  RelatedListsContainer,
  RelatedListsManager,
  RelatedListSection,
  type RelatedListDef,
} from "@/components/common/RelatedLists";

const INVESTOR_DETAIL_SECTIONS: RelatedListDef[] = [
  { key: "header", label: "Client header & contact", required: true },
  { key: "health", label: "Client health score" },
  { key: "summary", label: "Risk / nominee / KYC / review summary" },
  { key: "family", label: "Family snapshot" },
  { key: "allocation", label: "Portfolio allocation" },
  { key: "cross_sell", label: "Cross-sell / holdings" },
  { key: "sip_health", label: "SIP health" },
  { key: "transactions", label: "Transaction history" },
  { key: "documents", label: "Documents & attachments" },
  { key: "emails", label: "Emails" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "blueprint", label: "Onboarding blueprint" },
  { key: "edit_panel", label: "Inline-editable details" },
  { key: "master", label: "Master record (full read-only view)" },
  { key: "risk_history", label: "Risk profile history" },
  { key: "related", label: "Folios · SIPs · Goals · Tasks · SRs · Consent" },
];

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Guard against malformed links (e.g. /dashboard/investors/undefined produced
  // by an empty-state dashboard widget): bounce to the clients list instead of a
  // dead-end 404 (and avoid the "invalid uuid" DB error a non-uuid id would throw).
  if (!id || !UUID_RE.test(id)) {
    redirect("/dashboard/investors");
  }
  const session = await requireSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);

  const showPan = isFieldAllowed(license, "investor", "pan");
  const showDob = isFieldAllowed(license, "investor", "dob");
  const showPhone = isFieldAllowed(license, "investor", "phone");
  const showEmail = isFieldAllowed(license, "investor", "email");
  const showCity = isFieldAllowed(license, "investor", "city");
  const showState = isFieldAllowed(license, "investor", "state");
  const showPincode = isFieldAllowed(license, "investor", "pincode");
  const showAddress = isFieldAllowed(license, "investor", "address") || showCity || showState || showPincode;
  const showCategory = isFieldAllowed(license, "investor", "investor_category");
  const showSegment = isFieldAllowed(license, "investor", "segment_tag") || isFieldAllowed(license, "investor", "segment");
  const showStatus = isFieldAllowed(license, "investor", "status");
  const showAum = isFieldAllowed(license, "investor", "aum");
  const showSip = isFieldAllowed(license, "investor", "active_sip_amount") || isFieldAllowed(license, "investor", "sip");
  const showInflow = isFieldAllowed(license, "investor", "lifetime_inflow");
  const showKyc = isFieldAllowed(license, "investor", "kyc_status") || isFieldAllowed(license, "investor", "kyc");
  const showCkycExpiry = isFieldAllowed(license, "investor", "ckyc_expiry_at") || isFieldAllowed(license, "investor", "ckyc");
  const showRisk = isFieldAllowed(license, "investor", "risk_profile") || isFieldAllowed(license, "investor", "risk");
  const showNominee = isFieldAllowed(license, "investor", "nominee_name") || isFieldAllowed(license, "investor", "nominee");
  const showBank = isFieldAllowed(license, "investor", "bank_account_number_masked") || isFieldAllowed(license, "investor", "bank");
  const showRm = isFieldAllowed(license, "investor", "rm_id") || isFieldAllowed(license, "investor", "rm");

  // A malformed link (e.g. /dashboard/investors/undefined) must 404 cleanly,
  // not crash with a uuid cast error. Guard before any DB lookup by id.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    const inv = (await tx.select().from(investors).where(eq(investors.id, id)).limit(1))[0];
    if (!inv) return null;

    const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows, consentsRows, rmRow, familyRow, lumpsumSum, valuation, reviewMeetingsRows, riskHistoryRows, recentTxRows, txCountRow, sipBouncesRow] = await Promise.all([
      tx.select().from(folios).where(eq(folios.investorId, id)),
      tx.select().from(sips).where(eq(sips.investorId, id)),
      tx.select().from(goals).where(eq(goals.investorId, id)),
      tx
        .select()
        .from(communications)
        .where(eq(communications.investorId, id))
        .orderBy(desc(communications.createdAt))
        .limit(20),
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.subjectId, id), eq(tasks.subjectType, "investor")))
        .limit(20),
      tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).limit(20),
      tx.select().from(consents).where(eq(consents.investorId, id)),
      inv.rmId
        ? tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, inv.rmId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      inv.familyId
        ? tx.select().from(families).where(eq(families.id, inv.familyId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      tx.execute(sql`
        SELECT COALESCE(SUM(amount::numeric), 0)::numeric AS total
        FROM transactions
        WHERE investor_id = ${id} AND type = 'lumpsum' AND status IN ('processed', 'successful')
      `).then((r) => Number((r.rows[0] as any)?.total ?? 0)),
      // Live portfolio valuation (units × latest AMFI NAV + XIRR).
      valueInvestor(tx, id),
      tx.select().from(reviewMeetings).where(eq(reviewMeetings.investorId, id)),
      tx
        .select()
        .from(riskProfileResponses)
        .where(eq(riskProfileResponses.investorId, id))
        .orderBy(desc(riskProfileResponses.signedAt)),
      // Recent transaction ledger — most-recent first (order_date, then booked).
      tx
        .select()
        .from(transactions)
        .where(eq(transactions.investorId, id))
        .orderBy(sql`${transactions.orderDate} desc nulls last`, desc(transactions.createdAt))
        .limit(30),
      // Total transaction count (for the "latest N of M" label).
      tx
        .execute(sql`SELECT count(*)::int AS c FROM transactions WHERE investor_id = ${id}`)
        .then((r) => Number((r.rows[0] as any)?.c ?? 0)),
      // SIP bounces in the last 6 months (rejected/failed SIP installments).
      tx
        .execute(sql`
          SELECT count(*)::int AS c FROM transactions
          WHERE investor_id = ${id} AND type = 'sip'
            AND status IN ('rejected','failed')
            AND created_at >= now() - interval '180 days'
        `)
        .then((r) => Number((r.rows[0] as any)?.c ?? 0)),
    ]);

    // SIP health — combine recent bounces with the worst consecutive-failure
    // streak across the client's live SIPs (consecutiveFailures is text "0".."n").
    const activeSips = sipsRows.filter((s) => s.status === "active").length;
    const maxConsecutiveFailures = sipsRows.reduce(
      (m, s) => Math.max(m, parseInt((s.consecutiveFailures as any) ?? "0", 10) || 0),
      0
    );
    const monthlyCommitted = sipsRows
      .filter((s) => s.status === "active")
      .reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
    const sipHealth: SipHealth = {
      activeSips,
      bounces6mo: sipBouncesRow,
      maxConsecutiveFailures,
      monthlyCommitted,
    };

    // Related-modules counts (rail): insurance policies held + referrals this
    // client has made (leads referred_by this investor).
    const insuranceCount = Number(
      ((await tx.execute(sql`SELECT count(*)::int AS c FROM insurance_policies WHERE investor_id = ${id}`)).rows[0] as any)?.c ?? 0
    );
    const referralCount = Number(
      ((await tx.execute(sql`SELECT count(*)::int AS c FROM leads WHERE referred_by_investor_id = ${id}`)).rows[0] as any)?.c ?? 0
    );

    // PII access log (DPDP)
    await tx.insert(auditLog).values({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      actorType: "user",
      action: "investor.view",
      entityType: "investor",
      entityId: id,
      piiAccessed: { pan: true, dob: !!inv.dob, address: !!inv.address } as any,
      reason: "Investor 360 view",
    } as any);

    return {
      investor: inv,
      folios: foliosRows,
      sips: sipsRows,
      goals: goalsRows,
      communications: commsRows,
      tasks: tasksRows,
      serviceRequests: srRows,
      consents: consentsRows,
      rm: rmRow,
      family: familyRow,
      totalLumpsum: lumpsumSum,
      valuation,
      // Churn risk reuses the valuation's XIRR for the performance signal.
      churn: await churnForInvestor(tx, id, valuation.xirr),
      reviewMeetings: reviewMeetingsRows,
      riskHistory: riskHistoryRows,
      insuranceCount,
      referralCount,
      recentTransactions: recentTxRows,
      txCount: txCountRow,
      sipHealth,
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  if (!data) notFound();

  const inv = data.investor;
  const isRiskProfileMissing = !inv.riskProfile;
  const isRiskProfileExpired = inv.riskProfileSignedAt
    ? new Date(inv.riskProfileSignedAt).getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000
    : false;

  // Related Modules rail — collections with live counts + jump-to-section.
  const relatedItems = [
    { label: "Folios", selector: "#rel-folios", count: data.folios.length },
    { label: "Active SIPs", selector: "#rel-sips", count: data.sips.filter((s: any) => s.status === "active").length },
    { label: "Goals", selector: "#rel-goals", count: data.goals.length },
    { label: "Transactions", selector: '[data-rl-section="transactions"]', count: data.txCount },
    { label: "Cross-sell opportunities", selector: '[data-rl-section="cross_sell"]', count: crossSellOpportunities((inv as any).crossSell).length },
    { label: "Open tasks", selector: "#rel-tasks", count: data.tasks.filter((t: any) => t.status === "open").length, createHref: "/dashboard/tasks/new" },
    { label: "Service requests", selector: "#rel-srs", count: data.serviceRequests.filter((s: any) => s.status !== "closed" && s.status !== "resolved").length },
    { label: "Risk-profile history", selector: '[data-rl-section="risk_history"]', count: (data as any).riskHistory?.length ?? 0 },
    { label: "Family", selector: '[data-rl-section="family"]' },
    { label: "Portfolio allocation", selector: '[data-rl-section="allocation"]' },
    { label: "Master record", selector: '[data-rl-section="master"]' },
    // Off-page modules — navigate to the relevant module (scoped where possible).
    { label: "Insurance Tracker", href: `/dashboard/insurance?q=${encodeURIComponent(inv.name)}`, count: (data as any).insuranceCount ?? 0 },
    { label: "Referrals (by client)", href: "/dashboard/leads", count: (data as any).referralCount ?? 0 },
    { label: "Documents", href: "/dashboard/documents" },
  ];

  return (
    <div className="max-w-7xl space-y-4">
      <RelatedModulesRail items={relatedItems} />
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/investors"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to investors
        </Link>
        <div className="flex items-center gap-2">
          <RelatedListsManager
            moduleKey="investors-detail"
            sections={INVESTOR_DETAIL_SECTIONS}
          />
          <QuickCommsPanel
            investorId={inv.id}
            investorName={inv.name}
          />
          <Link
            href={`/dashboard/investors/${inv.id}/review-report`}
            className="text-xs rounded-md border px-2.5 py-1 hover:bg-accent"
          >
            📄 Quarterly Review Report
          </Link>
        </div>
      </div>

      {showRisk && (isRiskProfileMissing || isRiskProfileExpired) && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="size-4 text-amber-600" />
            </div>
            <div>
              <div className="font-semibold text-xs text-amber-800">
                {isRiskProfileMissing ? "Risk Profile Missing" : "Risk Profile Expired"}
              </div>
              <p className="text-[11px] text-amber-600 mt-0.5">
                {isRiskProfileMissing
                  ? "SEBI guidelines require completing a risk profile assessment for every active client before executing transactions."
                  : `This client's annual risk profile assessment was completed on ${formatDate(inv.riskProfileSignedAt!)} and has expired.`}
              </p>
            </div>
          </div>
          <Link
            href={`/dashboard/risk-profiles/new?investorId=${inv.id}`}
            className="flex-shrink-0 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded px-3 py-1.5 transition-colors shadow-sm"
          >
            Start Assessment
          </Link>
        </div>
      )}

      <SectionNav moduleKey="investors-detail" sections={INVESTOR_DETAIL_SECTIONS} />

      <RelatedListsContainer>
      {/* Header */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="header">
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <InvestorAvatarEditor investorId={inv.id} name={inv.name} hasAvatar={!!inv.avatarUrl} size={64} />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{inv.name}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              {showPan && <span className="font-mono">{inv.pan}</span>}
              {showSegment && inv.segmentTag && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                  {inv.segmentTag}
                </span>
              )}
              {showKyc && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    inv.kycStatus === "verified"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  KYC: {inv.kycStatus}
                </span>
              )}
              <span className="text-xs">Onboarded {inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"}</span>
              <BestTimeBadge session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }} investorId={inv.id} />
            </div>
            <div className="flex gap-3 mt-3 text-sm">
              {showPhone && inv.phone && (
                <a href={`tel:${inv.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Phone className="size-4" /> {inv.phone}
                </a>
              )}
              {showEmail && inv.email && (
                <a href={`mailto:${inv.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Mail className="size-4" /> {inv.email}
                </a>
              )}
              {showPhone && inv.whatsappPhone && (
                <a
                  href={`https://wa.me/${inv.whatsappPhone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              )}
              {showAddress && inv.address && (inv.address as any).city && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="size-4" /> {(inv.address as any).city}, {(inv.address as any).state}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <OnboardingWizardButton
                investorId={inv.id}
                investor={{
                  email: inv.email, phone: inv.phone, whatsappPhone: inv.whatsappPhone,
                  kycStatus: inv.kycStatus, panAadhaarLinkStatus: inv.panAadhaarLinkStatus, nameAsPerPan: inv.nameAsPerPan,
                  riskProfile: inv.riskProfile, nomineeName: inv.nomineeName, nomineeRelation: inv.nomineeRelation,
                  bankName: inv.bankName, bankAccountNumberMasked: inv.bankAccountNumberMasked, bankIfsc: inv.bankIfsc,
                }}
              />
              <AiClientBrief investorId={inv.id} name={inv.name} phone={inv.phone} />
              <CheckInButton subject={{ type: "investor", id: inv.id, name: inv.name, phone: inv.phone }} />
              <LogActivityButton subject={{ type: "investor", id: inv.id, name: inv.name, phone: inv.phone }} label="Log call / visit" variant="secondary" />
              <ChangeLogButton entityType="investor" entityId={inv.id} />
              <RowActions
                deleteUrl={`/api/investors/${inv.id}`}
                itemLabel="client"
                itemName={inv.name}
                verb="Delete"
                redirectTo="/dashboard/investors"
              />
              <RecordProvenance
                entityType="investor"
                entityId={inv.id}
                createdAt={inv.createdAt}
                updatedAt={inv.updatedAt}
                className="basis-full mt-1"
              />
              <VerifyContact
                investorId={inv.id}
                hasEmail={!!inv.email}
                hasPhone={!!inv.phone}
                emailVerified={!!inv.emailVerifiedAt}
                phoneVerified={!!inv.phoneVerifiedAt}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right">
            <div>
              <div className="text-xs text-muted-foreground">AUM</div>
              <div className="text-xl font-bold">{showAum ? formatINR(Number(inv.aum ?? 0)) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Active SIP</div>
              <div className="text-xl font-bold">{showSip ? formatINR(Number(inv.activeSipAmount ?? 0)) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Lifetime inflow</div>
              <div className="text-xl font-bold">{showInflow ? formatINR(Number(inv.lifetimeInflow ?? 0)) : "—"}</div>
            </div>
          </div>
        </div>
      </div>
      </RelatedListSection>

      {/* Composite health score — derived from existing fields, no extra query */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="health">
        <ClientHealthCard
          investor={inv as any}
          hasOpenSrBreach={data.serviceRequests.some(
            (sr) =>
              (sr.status === "open" || sr.status === "in_progress") &&
              sr.slaResolutionAt != null &&
              new Date(sr.slaResolutionAt as any).getTime() < Date.now()
          )}
        />
      </RelatedListSection>

      {/* Next-Best-Action recommendations for this client */}
      <RecommendedActions
        session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }}
        investorId={inv.id}
        name={inv.name}
        phone={inv.phone}
        email={inv.email}
      />

      {/* Risk + meta — at-a-glance status */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="summary">
        <div className="grid grid-cols-4 gap-4">
          {showRisk && <InfoCard label="Risk profile" value={inv.riskProfile ?? "Not assessed"} sub={inv.riskProfileSignedAt ? `Signed ${formatDate(inv.riskProfileSignedAt)}` : "Pending"} tone={!inv.riskProfile ? "warn" : undefined} />}
          {showNominee && <InfoCard label="Nominee" value={inv.nomineeName ?? "Not set"} sub={inv.nomineeRelation ?? undefined} tone={!inv.nomineeName ? "warn" : undefined} />}
          {showCkycExpiry && <InfoCard label="CKYC expiry" value={inv.ckycExpiryAt ? formatDate(inv.ckycExpiryAt) : "—"} sub={inv.ckycNumber ?? undefined} />}
          <InfoCard label="Last review" value={inv.lastReviewAt ? formatRelative(inv.lastReviewAt) : "Never"} sub={inv.nextReviewAt ? `Next: ${formatDate(inv.nextReviewAt)}` : undefined} tone={!inv.lastReviewAt ? "warn" : undefined} />
        </div>
      </RelatedListSection>

      {/* Family snapshot — only renders when familyId is set */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="family">
        <FamilySnapshot
          session={session}
          familyId={inv.familyId ?? null}
          familyName={data.family?.familyName ?? null}
          currentInvestorId={inv.id}
        />
      </RelatedListSection>

      {/* Live portfolio valuation — units × latest AMFI NAV + XIRR */}
      {showAum && data.valuation && (
        <div className="space-y-2">
          <PortfolioValuationCard valuation={data.valuation} />
          <StatementActions investorId={inv.id} statementCadence={(inv as any).statementCadence ?? "off"} />
        </div>
      )}

      {/* Churn-risk scorecard + AI retention play */}
      {showAum && data.churn && (
        <ChurnRiskCard
          result={data.churn}
          name={inv.name}
          serviceTier={inv.serviceTier}
          currentValueInr={data.valuation?.currentValue ?? Number(inv.aum ?? 0)}
        />
      )}

      {/* Portfolio allocation — derives from already-loaded folios */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="allocation">
        <PortfolioAllocation folios={data.folios as any} />
      </RelatedListSection>

      {/* Cross-sell / product-holdings matrix — wallet-share opportunities */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="cross_sell">
        <CrossSellCard investorId={inv.id} initial={(inv as any).crossSell ?? null} />
      </RelatedListSection>

      {/* SIP-bounce health — early churn signal from rejected SIP installments */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="sip_health">
        <SipHealthCard health={data.sipHealth} />
      </RelatedListSection>

      {/* Transaction ledger — recent purchases / redemptions / SIPs / switches */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="transactions">
        <TransactionLedger transactions={data.recentTransactions as any} total={data.txCount} />
      </RelatedListSection>

      {/* Documents & attachments — RM-uploaded files + auto-ingested client
          uploads from the required-documents form (same compliance_documents
          rows, linked to this investor). Self-fetching island. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="documents">
        <InvestorDocumentsSection investorId={inv.id} investorName={inv.name} investorPhone={inv.phone} investorEmail={inv.email} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="emails">
        <EmailRelatedList entityType="investor" entityId={inv.id} entityName={inv.name} entityEmail={inv.email} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="whatsapp">
        <WhatsAppRelatedList entityType="investor" entityId={inv.id} entityName={inv.name} entityPhone={inv.whatsappPhone ?? inv.phone} />
      </RelatedListSection>

      {/* Client-phase onboarding bar — stages 13-15: Operations → Portal
          Welcome → Active Client. Auto-hides for investors that weren't
          created from a lead (no source blueprint). */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="blueprint">
        <InvestorBlueprintStageBar investorId={inv.id} />
      </RelatedListSection>

      {/* Inline-editable form — falls through to read-only Master record below */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="edit_panel">
        <InvestorEditPanel
          investor={JSON.parse(JSON.stringify(inv))}
          showPan={showPan}
          showDob={showDob}
          showPhone={showPhone}
          showEmail={showEmail}
          showWhatsApp={showPhone}
          showNominee={showNominee}
          showBank={showBank}
          showRiskProfile={showRisk}
        />
      </RelatedListSection>

      {/* ----------------------------- Master record -----------------------------
        Every field the spec calls out under § 6 Module 4 Client Master, grouped
        logically so RM/back-office can scan it in one read.
      */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="master">
      <div className="border rounded-lg bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <User2 className="size-4" /> Master record
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Client ID <code className="font-mono">{inv.id.slice(0, 8)}…</code>
            </span>
            <MasterRecordEditor
              investor={JSON.parse(JSON.stringify(inv))}
              flags={{
                showDob,
                showPhone,
                showEmail,
                showAddress,
                showSegment,
                showKyc,
                showRisk,
                showNominee,
                showBank,
                showStatus,
                showRm,
              }}
            />
          </div>
        </div>

        <Group title="Identity">
          <KV label="Client ID" value={inv.id} mono />
          {showPan && <KV label="PAN" value={inv.pan} mono />}
          <KV label="Name" value={inv.name} />
          {showDob && <KV label="DOB" value={inv.dob ? formatDate(inv.dob) : "—"} />}
          <KV label="Gender" value={inv.gender === "M" ? "Male" : inv.gender === "F" ? "Female" : inv.gender === "O" ? "Other" : "—"} />
          <KV label="Client since" value={inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"} />
        </Group>

        <Group title="Contact">
          {showPhone && <KV label="Mobile" value={inv.phone ?? "—"} />}
          {showPhone && <KV label="Alternate mobile" value={inv.alternatePhone ?? "—"} />}
          {showEmail && <KV label="Email" value={inv.email ?? "—"} />}
          {showPhone && <KV label="WhatsApp" value={inv.whatsappPhone ?? "—"} />}
          {showAddress && (
            <KV
              label="Address"
              value={
                inv.address
                  ? [
                      (inv.address as any).line1,
                      (inv.address as any).city,
                      (inv.address as any).state,
                      (inv.address as any).pincode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"
                  : "—"
              }
              colSpan={2}
            />
          )}
          {showCity && <KV label="City" value={(inv.address as any)?.city ?? "—"} />}
          {showState && <KV label="State" value={(inv.address as any)?.state ?? "—"} />}
        </Group>

        <Group title="Profile">
          <KV label="Occupation" value={inv.occupation ?? "—"} />
          <KV label="Income range" value={inv.incomeRange ?? "—"} />
          <KV label="Client category" value={(inv.investorCategory ?? "—").replace("corporate", "Company")} cap />
          {showSegment && <KV label="Client type" value={inv.segmentTag ?? "—"} />}
          {showRm && <KV label="Assigned RM" value={data.rm?.name ?? "—"} sub={data.rm?.email} />}
          <KV label="Family group" value={data.family?.familyName ?? "—"} sub={inv.familyRole ?? undefined} />
        </Group>

        <Group title="Compliance status">
          {showKyc && <Status label="KYC status" value={inv.kycStatus} good={inv.kycStatus === "verified"} />}
          {showRisk && <Status label="Risk profile" value={inv.riskProfile ?? "not_assessed"} good={!!inv.riskProfile && !!inv.riskProfileSignedAt} />}
          {showNominee && <Status label="Nominee" value={inv.nomineeName ? "set" : "missing"} good={!!inv.nomineeName} />}
          {showBank && <Status label="Bank details" value={inv.bankAccountNumberMasked ? "captured" : "missing"} good={!!inv.bankAccountNumberMasked} />}
          {showPan && <KV label="UCC (BSE)" value={inv.bseUccCode ?? "—"} mono />}
          {showPan && <KV label="CAN (NSE)" value={inv.nseCanCode ?? "—"} mono />}
          <Status label="Mandate" value={inv.mandateStatus ?? "none"} good={inv.mandateStatus === "active"} />
          <KV label="Mandate ref" value={inv.mandateRefNo ?? "—"} mono />
        </Group>

        <Group title="Financials">
          {showAum && <KV label="Current AUM" value={formatINR(Number(inv.aum ?? 0))} highlight />}
          {showSip && <KV label="Monthly SIP" value={formatINR(Number(inv.activeSipAmount ?? 0))} highlight />}
          <KV label="Total lumpsum" value={formatINR(data.totalLumpsum)} sub="Successful purchases" />
          {showInflow && <KV label="Lifetime inflow" value={formatINR(Number(inv.lifetimeInflow ?? 0))} />}
          {showInflow && <KV label="Lifetime outflow" value={formatINR(Number(inv.lifetimeOutflow ?? 0))} />}
          <KV label="Service tier" value={inv.serviceTier ?? "—"} />
        </Group>

        <Group title="Review & lifecycle">
          <KV label="Last review" value={inv.lastReviewAt ? formatDate(inv.lastReviewAt) : "Never"} sub={inv.lastReviewAt ? formatRelative(inv.lastReviewAt) : undefined} />
          <KV label="Next review" value={inv.nextReviewAt ? formatDate(inv.nextReviewAt) : "—"} sub={inv.nextReviewAt ? formatRelative(inv.nextReviewAt) : undefined} />
          <KV label="Last transaction" value={inv.lastTransactionAt ? formatRelative(inv.lastTransactionAt) : "Never"} />
          {showStatus && (
            <Status
              label="Client status"
              value={inv.status}
              good={inv.status === "active"}
              warn={inv.status === "dormant" || inv.status === "inactive"}
              bad={inv.status === "redemption_risk" || inv.status === "closed" || inv.status === "exited"}
            />
          )}
          {showStatus && inv.status === "redemption_risk" && inv.redemptionRiskReason && (
            <KV label="Redemption-risk reason" value={inv.redemptionRiskReason} colSpan={2} />
          )}
        </Group>

        {inv.notes && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-xs text-muted-foreground mb-1">Notes</div>
            <p className="text-sm whitespace-pre-wrap">{inv.notes}</p>
          </div>
        )}
      </div>
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="risk_history">
        <div className="border rounded-lg bg-card p-5">
          <div className="flex items-center justify-between mb-4 border-b pb-3">
            <h2 className="font-semibold flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-brand-cyan" /> Risk profile history
            </h2>
            <Link
              href={`/dashboard/risk-profiles/new?investorId=${inv.id}`}
              className="text-xs font-semibold text-brand-cyan hover:underline"
            >
              + New Assessment
            </Link>
          </div>
          {!data.riskHistory || data.riskHistory.length === 0 ? (
            <EmptyRow text="No risk profile history found." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b bg-slate-50/50">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Profile Date</th>
                    <th className="text-left px-4 py-2 font-semibold">Category</th>
                    <th className="text-center px-4 py-2 font-semibold">Score</th>
                    <th className="text-left px-4 py-2 font-semibold">Signed By</th>
                    <th className="text-left px-4 py-2 font-semibold">RM Remarks</th>
                    <th className="text-right px-4 py-2 font-semibold">Document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.riskHistory.map((h) => {
                    const CATEGORY_TONE: Record<string, string> = {
                      conservative: "bg-blue-50 text-blue-700 border-blue-200",
                      moderate: "bg-emerald-50 text-emerald-700 border-emerald-200",
                      aggressive: "bg-amber-50 text-amber-700 border-amber-200",
                      very_aggressive: "bg-rose-50 text-rose-700 border-rose-200",
                    };
                    return (
                      <tr key={h.id} className="hover:bg-slate-50/40">
                        <td className="px-4 py-3 text-xs font-medium tabular-nums">
                          {h.signedAt ? formatDate(h.signedAt) : formatDate(h.profileDate)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`chip border text-xs px-2 py-0.5 rounded capitalize ${CATEGORY_TONE[h.finalCategory] ?? ""}`}>
                            {h.finalCategory.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-medium tabular-nums">
                          {h.totalScore}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {h.signedByName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate" title={h.rmRemarks ?? undefined}>
                          {h.rmRemarks ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {h.documentUrl ? (
                            <a
                              href={h.documentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-semibold text-brand-cyan hover:underline inline-flex items-center gap-1"
                            >
                              View PDF
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="related">
      <div className="grid grid-cols-3 gap-6">
        {/* Folios + SIPs */}
        <div className="col-span-2 space-y-6">
          <Section id="rel-folios" title="Folios" count={data.folios.length}>
            {data.folios.length === 0 ? (
              <EmptyRow text="No folios yet." />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 font-medium">AMC</th>
                    <th className="text-left py-2 font-medium">Folio #</th>
                    <th className="text-left py-2 font-medium">RTA</th>
                    <th className="text-right py-2 font-medium">AUM</th>
                  </tr>
                </thead>
                <tbody>
                  {data.folios.map((f) => (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="py-2">{f.amcName}</td>
                      <td className="py-2 font-mono text-xs">{f.folioNumber}</td>
                      <td className="py-2 text-xs uppercase text-muted-foreground">{f.rta}</td>
                      <td className="py-2 text-right tabular-nums">{formatINR(Number(f.aum ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section id="rel-sips" title="Active SIPs" count={data.sips.filter((s) => s.status === "active").length}>
            {data.sips.length === 0 ? (
              <EmptyRow text="No SIPs yet." />
            ) : (
              <ul className="divide-y">
                {data.sips.map((s) => (
                  <li key={s.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{s.schemeName ?? s.schemeCode}</div>
                      <div className="text-xs text-muted-foreground">{s.frequency} · day {s.sipDate}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium tabular-nums">{formatINR(Number(s.amount))}</div>
                      <div
                        className={`text-xs ${
                          s.status === "active" ? "text-emerald-600" : "text-muted-foreground"
                        }`}
                      >
                        {s.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="rel-goals" title="Goals" count={data.goals.length}>
            {data.goals.length === 0 ? (
              <EmptyRow text="No goals set." />
            ) : (
              <ul className="space-y-4">
                {data.goals.map((g) => {
                  const pct = Number(g.progressPct ?? 0);
                  
                  // Trajectory calculations
                  const targetDate = new Date(g.targetDate);
                  const now = new Date();
                  const diffYears = targetDate.getFullYear() - now.getFullYear();
                  const diffMonths = targetDate.getMonth() - now.getMonth();
                  const N = diffYears * 12 + diffMonths;

                  const currentVal = Number(g.currentValue ?? 0);
                  const sip = Number(g.monthlyContribution ?? 0);
                  const targetAmount = Number(g.targetAmount);

                  let projectedValue = currentVal;
                  let shortfall = 0;
                  let neededIncrease = 0;

                  if (N > 0) {
                    const r = 0.10 / 12; // 10% expected return rate per annum
                    projectedValue = currentVal * Math.pow(1 + r, N) + sip * ((Math.pow(1 + r, N) - 1) / r);
                    if (projectedValue < targetAmount) {
                      shortfall = targetAmount - projectedValue;
                      neededIncrease = (shortfall * r) / (Math.pow(1 + r, N) - 1);
                    }
                  }

                  return (
                    <li key={g.id} className="border-b last:border-0 pb-3 last:pb-0">
                      <div className="flex items-center justify-between text-sm">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-muted-foreground tabular-nums">
                          {formatINR(Number(g.currentValue ?? 0))} / {formatINR(Number(g.targetAmount))}
                        </div>
                      </div>
                      <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                        <span>{pct.toFixed(0)}% · target {formatDate(g.targetDate)} · {g.category.replace(/_/g, " ")}</span>
                        {sip > 0 && <span className="tabular-nums font-mono text-[10px]">SIP: {formatINR(sip)}/mo</span>}
                      </div>
                      {shortfall > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                            ⚠️ Shortfall Projected: {formatINR(shortfall)}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Suggested step-up: +{formatINR(neededIncrease)}/mo
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <ActivityTimeline
            communications={data.communications}
            tasks={data.tasks}
            serviceRequests={data.serviceRequests}
            reviewMeetings={data.reviewMeetings}
          />
        </div>

        {/* Side panel */}
        <aside className="space-y-6">
          <Section id="rel-tasks" title="Open tasks" count={data.tasks.filter((t) => t.status === "open").length}>
            {data.tasks.filter((t) => t.status === "open").length === 0 ? (
              <EmptyRow text="No open tasks." />
            ) : (
              <ul className="space-y-1">
                {data.tasks
                  .filter((t) => t.status === "open")
                  .slice(0, 5)
                  .map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/dashboard/tasks?focus=${t.id}`}
                        className="block rounded-md -mx-2 px-2 py-1.5 text-sm hover:bg-accent/40 transition-colors"
                      >
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {t.priority} · {t.dueAt ? formatRelative(t.dueAt) : "no due"}
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Section>

          <Section id="rel-srs" title="Service requests" count={data.serviceRequests.filter((s) => s.status !== "closed" && s.status !== "resolved").length}>
            {data.serviceRequests.length === 0 ? (
              <EmptyRow text="No tickets." />
            ) : (
              <ul className="space-y-2">
                {data.serviceRequests.slice(0, 5).map((s) => (
                  <li key={s.id} className="text-sm">
                    <div className="font-medium">{s.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      #{s.ticketNo} · {s.status}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Consent matrix">
            <ul className="space-y-1 text-sm">
              {["whatsapp", "email", "sms"].map((channel) => {
                const tx = data.consents.find((c) => c.channel === channel && c.scope === "transactional");
                const mk = data.consents.find((c) => c.channel === channel && c.scope === "marketing");
                return (
                  <li key={channel} className="flex items-center justify-between py-1 border-b last:border-0">
                    <span className="capitalize">{channel}</span>
                    <div className="flex gap-2 text-xs">
                      <ConsentChip label="Tx" granted={tx?.status === "granted"} />
                      <ConsentChip label="Mkt" granted={mk?.status === "granted"} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </aside>
      </div>
      </RelatedListSection>
      </RelatedListsContainer>
    </div>
  );
}

function Section({ id, title, count, children }: { id?: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <div id={id} className="border rounded-lg bg-card p-5 scroll-mt-24">
      <div className="font-semibold mb-3 flex items-center justify-between">
        <span>{title}</span>
        {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function InfoCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className={`border rounded-lg bg-card p-4 ${tone === "warn" ? "border-amber-300" : ""}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {tone === "warn" && <AlertTriangle className="size-3 text-amber-600" />}
        {label}
      </div>
      <div className="font-medium mt-1 capitalize">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground text-center py-6">{text}</div>;
}

function ConsentChip({ label, granted }: { label: string; granted: boolean }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded ${
        granted ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
      }`}
    >
      {label} {granted ? "✓" : "—"}
    </span>
  );
}

/** Master-record group header + 3-col grid for KV rows. */
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

function KV({
  label,
  value,
  sub,
  mono,
  cap,
  highlight,
  colSpan,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  cap?: boolean;
  highlight?: boolean;
  colSpan?: number;
}) {
  return (
    <div className={colSpan === 2 ? "col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${cap ? "capitalize" : ""} ${
          highlight ? "font-semibold tabular-nums" : ""
        }`}
      >
        {value || "—"}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Status({
  label,
  value,
  good,
  warn,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  warn?: boolean;
  bad?: boolean;
}) {
  const cls = good
    ? "bg-emerald-50 text-emerald-700"
    : bad
    ? "bg-rose-50 text-rose-700"
    : warn
    ? "bg-amber-50 text-amber-700"
    : "bg-muted text-muted-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block capitalize ${cls}`}>
        {value.replace(/_/g, " ")}
      </span>
    </div>
  );
}
