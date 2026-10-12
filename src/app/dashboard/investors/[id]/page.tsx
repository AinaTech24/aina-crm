import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { attendeeIs } from "@/lib/review-meetings/attendees";
import { Suspense } from "react";
import {
  Phone, Mail, MessageCircle, MapPin, AlertTriangle, User2, ShieldCheck, ArrowRight, Wallet,
  Download, FileText, Receipt, CalendarPlus, TrendingUp, PieChart, Percent, Sparkles,
} from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
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
  activities,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadViewableInvestor } from "@/lib/investors/access";
import { formatINR, formatDate, formatRelative, formatPhone, isValidIndianMobile } from "@/lib/utils";
import { formatMoney, formatPercent } from "@/lib/format";
import { fromActivities, fromCommunications, fromMeetings, fromServiceRequests, fromTasks, mergeTimeline } from "@/lib/timeline";
import { TASK_DEAD } from "@/lib/metrics/tasks";
import { SR_CLOSED } from "@/lib/metrics/service";
import { CheckInButton, LogActivityButton } from "@/components/activities/ActivityLogger";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { RowActions } from "@/components/common/RowActions";
import { RecordMenu, RecordMenuSeparator } from "@/components/common/RecordMenu";
import { RecordTimeline } from "@/components/common/RecordTimeline";
import { VerifyContact } from "@/components/investors/VerifyContact";
import { RecommendedActions } from "@/components/investors/RecommendedActions";
import { AiClientBrief } from "@/components/investors/AiClientBrief";
import { BestTimeBadge } from "@/components/investors/BestTimeBadge";
import { OnboardingWizardButton } from "@/components/investors/OnboardingWizard";
import { SendTemplateButtons } from "@/components/comms/SendTemplateButtons";
import { NomineeSection } from "@/components/investors/NomineeSection";
import { ReferralSection } from "@/components/investors/ReferralSection";
import { CustomFieldsCard } from "@/components/common/CustomFieldsCard";
import { RiskProfilePdfButtons } from "@/components/risk-profile/RiskProfileName";
import { SendRiskProfileLinkButton } from "@/components/risk-profile/SendRiskProfileLinkButton";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { InvestorBlueprintStageBar } from "@/components/investors/InvestorBlueprintStageBar";
import { ClientGifts } from "@/components/investors/ClientGifts";
import { ClientHealthCard } from "@/components/investors/ClientHealthCard";
import { PortfolioAllocation } from "@/components/investors/PortfolioAllocation";
import { FamilySnapshot } from "@/components/investors/FamilySnapshot";
import { StatementActions } from "@/components/investors/StatementActions";
import { WealthStoryButton } from "@/components/investors/WealthStoryButton";
import { valueInvestor } from "@/lib/finance/valuation";
import { ChurnRiskCard } from "@/components/investors/ChurnRiskCard";
import { churnForInvestor } from "@/lib/churn/scan";
import { TransactionLedger } from "@/components/investors/TransactionLedger";
import { SipHealthCard, type SipHealth } from "@/components/investors/SipHealthCard";
import { ExpectedInflowsCard } from "@/components/investors/ExpectedInflowsCard";
import { CrossSellCard } from "@/components/investors/CrossSellCard";
import { OpportunitiesPanel } from "@/components/opportunities/OpportunitiesPanel";
import { ClientFdPanel } from "@/components/fixed-deposits/ClientFdPanel";
import { canEditFds } from "@/lib/fixed-deposits/service";
import { InvestorDocumentsSection } from "@/components/investors/InvestorDocumentsSection";
import { RecordNotes } from "@/components/common/RecordNotes";
import { InvestorAvatarEditor } from "@/components/investors/InvestorAvatarEditor";
import { EmailRelatedList } from "@/components/comms/EmailRelatedList";
import { can } from "@/lib/auth/rbac";
import { WhatsAppRelatedList } from "@/components/comms/WhatsAppRelatedList";
import { InvestorDetailTabs } from "@/components/investors/InvestorDetailTabs";
import { EditClientDetailsLink } from "@/components/investors/EditClientDetailsLink";
import { InlineEditField, type InlineEditSpec } from "@/components/investors/InlineEditField";
import { BlueprintStatusKV } from "@/components/investors/BlueprintStatusKV";
import { ReviewCadenceEditor } from "@/components/investors/ReviewCadenceEditor";
import { PortalAccessButton } from "@/components/investors/PortalAccessButton";
import { RecordBusinessImpact } from "@/components/investors/RecordBusinessImpact";
import { ClientSummaryStrip } from "@/components/investors/ClientSummaryStrip";
import { ClientReadinessStrip } from "@/components/investors/ClientReadinessStrip";
import { PanReveal } from "@/components/investors/PanReveal";
import { HoldingsTable } from "@/components/investors/HoldingsTable";
import { SuitabilityCard } from "@/components/investors/SuitabilityCard";
import { KycDataViewer } from "@/components/investors/KycDataViewer";
import { Stat } from "@/components/dashboards/DashboardShared";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/button-class";
import { MENU_ICON, MENU_ITEM } from "@/components/ui/menu-item-class";
import { clientCompleteness } from "@/lib/investors/completeness";
import { assetClassExposure } from "@/lib/investors/asset-class";
import { withSchemeCategories } from "@/lib/investors/scheme-categories";
import { assessSuitability } from "@/lib/investors/suitability";
import { getClientHealth } from "@/lib/metrics/health";
import { CLIENT_TYPE_KEYS, clientTypeLabel } from "@/lib/investors/client-types";
import {
  RelatedListsContainer,
  RelatedListsManager,
  RelatedListSection,
  type RelatedListDef,
} from "@/components/common/RelatedLists";

/**
 * The page's sections, in default order, grouped by the tab that shows them.
 * "Customize page" (in the More menu) hides and reorders them per browser.
 */
const INVESTOR_DETAIL_SECTIONS: RelatedListDef[] = [
  // Overview
  { key: "health", label: "Client health score" },
  { key: "recommended", label: "Recommended actions" },
  { key: "opportunities", label: "Opportunities — products the client wants next" },
  { key: "summary", label: "Review schedule" },
  { key: "notes", label: "Notes" },
  // Portfolio
  { key: "valuation", label: "Portfolio summary, statements & reports" },
  { key: "holdings", label: "Holdings" },
  { key: "allocation", label: "Portfolio allocation & suitability" },
  { key: "sips_goals", label: "SIPs & goals" },
  { key: "sip_health", label: "SIP health" },
  { key: "transactions", label: "Transaction history" },
  { key: "churn", label: "Churn risk" },
  { key: "fixed_deposits", label: "Fixed deposits" },
  { key: "expected_inflows", label: "Expected inflows" },
  { key: "cross_sell", label: "Cross-sell / holdings elsewhere" },
  // KYC & Profile
  { key: "master", label: "Client details" },
  { key: "nominees", label: "Nominees" },
  { key: "risk_history", label: "Risk profile history" },
  { key: "kyc_data", label: "Details captured at onboarding" },
  { key: "custom_fields", label: "Custom fields" },
  // Engagement
  { key: "related", label: "Activity, open tasks & service requests" },
  { key: "emails", label: "Emails" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "documents", label: "Documents & attachments" },
  { key: "family", label: "Family snapshot" },
  { key: "referrals", label: "Referrals" },
  { key: "gifts", label: "Birthday gifts & budget" },
];

/**
 * Tab groups for Client 360. The Portfolio count is the holdings behind it; a
 * zero is left off because most clients on a CSV-only book have none loaded,
 * and "Portfolio 0" beside a ₹1.8 Cr AUM read as a contradiction.
 */
function investorDetailTabs(counts: { holdings: number }) {
  return [
    { key: "overview", label: "Overview", sections: ["health", "recommended", "opportunities", "summary", "notes"] },
    {
      key: "portfolio",
      label: "Portfolio",
      sections: ["valuation", "holdings", "allocation", "sips_goals", "sip_health", "transactions", "churn", "fixed_deposits", "expected_inflows", "cross_sell"],
      count: counts.holdings > 0 ? counts.holdings : undefined,
    },
    { key: "profile", label: "KYC & Profile", sections: ["master", "nominees", "risk_history", "kyc_data", "custom_fields"] },
    { key: "engagement", label: "Engagement", sections: ["related", "emails", "whatsapp", "documents", "family", "referrals", "gifts"] },
  ];
}

/** Status beside the name: colour only where the status asks for attention. */
function statusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "active": return "success";
    case "dormant":
    case "inactive": return "warning";
    case "redemption_risk": return "danger";
    default: return "neutral";
  }
}

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
  const showSegment = isFieldAllowed(license, "investor", "segment_tag") || isFieldAllowed(license, "investor", "segment");
  const showStatus = isFieldAllowed(license, "investor", "status");
  const showAum = isFieldAllowed(license, "investor", "aum");
  const showSip = isFieldAllowed(license, "investor", "active_sip_amount") || isFieldAllowed(license, "investor", "sip");
  const showInflow = isFieldAllowed(license, "investor", "lifetime_inflow");
  const showKyc = isFieldAllowed(license, "investor", "kyc_status") || isFieldAllowed(license, "investor", "kyc");
  const showRisk = isFieldAllowed(license, "investor", "risk_profile") || isFieldAllowed(license, "investor", "risk");
  const showNominee = isFieldAllowed(license, "investor", "nominee_name") || isFieldAllowed(license, "investor", "nominee");
  const showBank = isFieldAllowed(license, "investor", "bank_account_number_masked") || isFieldAllowed(license, "investor", "bank");
  const showRm = isFieldAllowed(license, "investor", "rm_id") || isFieldAllowed(license, "investor", "rm");

  const data = await withTenant(session.tenantId, async (tx) => {
    // Data scope: a client outside the viewer's book (or no client capability
    // at all) reads as not found — never confirm it exists.
    const inv = await loadViewableInvestor(tx, session, id)
      .catch((e: any) => { if (e?.status === 403) return null; throw e; });
    if (!inv) return null;
    // Soft-deleted clients live in the Trash bin, not on the detail page.
    if ((inv as any).deletedAt) return null;
    // Score live and keep the stored score equal (lib/metrics/health.ts): the
    // Clients list and the preview drawer read the same number.
    const health = await getClientHealth(tx, session.tenantId, id);

    const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows, consentsRows, rmRow, familyRow, lumpsumSum, valuation, reviewMeetingsRows, riskHistoryRows, recentTxRows, txCountRow, sipBouncesRow, activityRows] = await Promise.all([
      tx.select().from(folios).where(eq(folios.investorId, id)),
      tx.select().from(sips).where(eq(sips.investorId, id)),
      tx.select().from(goals).where(eq(goals.investorId, id)),
      tx
        .select()
        .from(communications)
        .where(eq(communications.investorId, id))
        .orderBy(desc(communications.createdAt))
        .limit(50),
      // A task reaches a client through two links (CLAUDE.md): the task form's
      // related_investor_id, or subject_type/subject_id from rejections and
      // onboarding. Read both, newest first.
      tx
        .select()
        .from(tasks)
        .where(and(
          or(eq(tasks.relatedInvestorId, id), and(eq(tasks.subjectId, id), eq(tasks.subjectType, "investor"))),
          isNull(tasks.deletedAt),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(50),
      tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).orderBy(desc(serviceRequests.createdAt)).limit(50),
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
      // Meetings about this client, and meetings they attended.
      tx.select().from(reviewMeetings).where(or(eq(reviewMeetings.investorId, id), attendeeIs("client", id, sql`${reviewMeetings.attendees}`))).orderBy(desc(reviewMeetings.meetingDate)).limit(50),
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
      // The interaction log — calls, visits and notes logged for this client
      // (from "Log call / visit", check-ins and the mobile call sync).
      tx
        .select({
          id: activities.id,
          kind: activities.kind,
          direction: activities.direction,
          status: activities.status,
          subject: activities.subject,
          notes: activities.notes,
          occurredAt: activities.occurredAt,
          durationSec: activities.durationSec,
          locationLabel: activities.locationLabel,
          nextFollowupAt: activities.nextFollowupAt,
          ownerName: users.name,
        })
        .from(activities)
        .leftJoin(users, eq(users.id, activities.ownerUserId))
        .where(and(eq(activities.subjectType, "investor"), eq(activities.subjectId, id)))
        .orderBy(desc(activities.occurredAt))
        .limit(100),
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

    // The actual leads this client referred — not just a count. The Referrals
    // card used to render ONLY the hand-typed `investors.referrals` jsonb, so a
    // client who had genuinely referred people still read "No referrals recorded
    // for this client yet". Worse, a referral that CONVERTED disappeared from the
    // referrer's page entirely, which is exactly the one you most want to see.
    // LEFT JOIN the converted client so a converted referral keeps showing, now
    // pointing at the client record it became.
    const referredLeadRows = (await tx.execute(sql`
      SELECT l.id, l.name, l.stage, l.created_at, l.converted_at,
             l.converted_investor_id,
             ci.name AS converted_name,
             ci.aum::numeric AS converted_aum
        FROM leads l
        LEFT JOIN investors ci ON ci.id = l.converted_investor_id AND ci.deleted_at IS NULL
       WHERE l.referred_by_investor_id = ${id}
       ORDER BY l.created_at DESC
       LIMIT 50
    `)).rows as Array<{
      id: string; name: string | null; stage: string | null;
      created_at: string | null; converted_at: string | null;
      converted_investor_id: string | null;
      converted_name: string | null; converted_aum: string | null;
    }>;

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
      health,
      consents: consentsRows,
      rm: rmRow,
      family: familyRow,
      totalLumpsum: lumpsumSum,
      valuation,
      // Churn risk reuses the valuation's XIRR for the performance signal.
      churn: await churnForInvestor(tx, id, valuation.xirr),
      reviewMeetings: reviewMeetingsRows,
      riskHistory: riskHistoryRows,
      referredLeads: referredLeadRows.map((r) => ({
        id: String(r.id),
        name: r.name ?? "Unnamed lead",
        stage: r.stage ?? null,
        createdAt: r.created_at ? String(r.created_at) : null,
        convertedAt: r.converted_at ? String(r.converted_at) : null,
        convertedInvestorId: r.converted_investor_id ? String(r.converted_investor_id) : null,
        convertedName: r.converted_name ?? null,
        convertedAum: r.converted_aum != null ? Number(r.converted_aum) : null,
      })),
      recentTransactions: recentTxRows,
      txCount: txCountRow,
      sipHealth,
      activityRows,
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  if (!data) notFound();

  const inv = data.investor;
  // Derived client-360 insights (all from already-loaded data).
  const completeness = clientCompleteness(inv as any);
  // Holdings stored without a category take it from the AMFI master, so this
  // equity share matches the suitability email and the proposal builder.
  const exposure = assetClassExposure(
    (await withTenant(session.tenantId, (tx) => withSchemeCategories(tx, data.folios as any))) as any
  );
  const suitability = assessSuitability((inv as any).riskProfile ?? null, exposure.equityPct, exposure.classifiedPct);
  const isRiskProfileMissing = !inv.riskProfile;
  const isRiskProfileExpired = inv.riskProfileSignedAt
    ? new Date(inv.riskProfileSignedAt).getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000
    : false;

  // Profile fields still blank, beyond the compliance items the checklist
  // already tracks as pills (KYC, risk profile, nominee, bank).
  const PILL_KEYS = new Set(["kyc", "risk_profile", "nominee", "bank"]);
  const missingFields = completeness.missing.filter((m) => !PILL_KEYS.has(m.key)).map((m) => m.label);

  // Open work, on the same definitions the summary strip counts with
  // (lib/metrics): a task is open until completed or cancelled, a service
  // request until resolved or closed.
  const openTasks = data.tasks.filter((t: any) => !(TASK_DEAD as readonly string[]).includes(String(t.status)));
  const openRequests = data.serviceRequests.filter((s: any) => !(SR_CLOSED as readonly string[]).includes(String(s.status)));

  // Everything that happened with this client, newest first.
  const timeline = mergeTimeline(
    fromActivities(data.activityRows),
    fromTasks(data.tasks, { href: (t) => `/dashboard/tasks?focus=${t.id}` }),
    fromCommunications(data.communications),
    fromServiceRequests(data.serviceRequests),
    fromMeetings(data.reviewMeetings),
  );

  // Portfolio sections need holdings or a transaction history to say
  // anything. A booked AUM alone (a CSV import) is shown in the summary strip;
  // it does not make five empty ₹0 cards worth drawing.
  const holdingsCount = data.valuation?.holdings?.length ?? 0;
  const hasPortfolio = holdingsCount > 0 || data.txCount > 0 || data.folios.length > 0;
  const v = data.valuation;

  const contactRow = (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
      {showPhone && inv.phone && (
        <a href={`tel:${inv.phone}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <Phone className="size-4" /> {formatPhone(inv.phone)}
          {!isValidIndianMobile(inv.phone) && (
            <span
              title="This doesn't look like a valid 10-digit Indian mobile number"
              className="inline-flex items-center text-warning-foreground"
            >
              <AlertTriangle className="size-3.5" />
            </span>
          )}
        </a>
      )}
      {showEmail && inv.email && (
        <a href={`mailto:${inv.email}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <Mail className="size-4" /> {inv.email}
        </a>
      )}
      {showPhone && (inv.whatsappPhone || inv.phone) && (
        <a
          href={`https://wa.me/${(inv.whatsappPhone ?? inv.phone ?? "").replace(/[^\d]/g, "")}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <MessageCircle className="size-4" /> WhatsApp
        </a>
      )}
      {showAddress && inv.address && (inv.address as any).city && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="size-4" /> {[(inv.address as any).city, (inv.address as any).state].filter(Boolean).join(", ")}
        </span>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl space-y-4">
      {/* WHO, and what to do. The name, status and how to reach them; the
          record's actions beside it — one primary, one secondary, and More.
          The header, the summary, the setup checklist and the tabs sit OUTSIDE
          the customisable section stack: "Customize page" re-orders that stack
          with CSS `order`, and a saved arrangement from before a section was
          added could push the header below the tabs. */}
      <PageHeaderCard
        breadcrumb={[{ label: "Clients", href: "/dashboard/investors" }, { label: inv.name }]}
        title={
          <>
            <InvestorAvatarEditor investorId={inv.id} name={inv.name} hasAvatar={!!inv.avatarUrl} size={44} />
            {inv.name}
            {showStatus && inv.status && (
              <Badge tone={statusTone(inv.status)} className="ml-1 align-middle text-xs font-medium">{inv.status}</Badge>
            )}
          </>
        }
        actions={
          <>
            <LogActivityButton subject={{ type: "investor", id: inv.id, name: inv.name, phone: inv.phone }} label="Log call / visit" variant="primary" />
            <SendTemplateButtons type="investor" id={inv.id} name={inv.name} email={inv.email} phone={inv.whatsappPhone || inv.phone} />
            <RecordMenu>
              <Link href={`/dashboard/review-meetings/new?investorId=${inv.id}`} className={MENU_ITEM}>
                <CalendarPlus className={MENU_ICON} /> Schedule review meeting
              </Link>
              <CheckInButton subject={{ type: "investor", id: inv.id, name: inv.name, phone: inv.phone }} triggerClassName={MENU_ITEM} />
              <RecordBusinessImpact investorId={inv.id} triggerClassName={MENU_ITEM} />
              <RecordMenuSeparator />
              <AiClientBrief investorId={inv.id} name={inv.name} phone={inv.phone} triggerClassName={MENU_ITEM} />
              <PortalAccessButton investorId={inv.id} triggerClassName={MENU_ITEM} />
              <ChangeLogButton entityType="investor" entityId={inv.id} triggerClassName={MENU_ITEM} />
              <RelatedListsManager moduleKey="investors-detail" sections={INVESTOR_DETAIL_SECTIONS} triggerClassName={MENU_ITEM} />
              <RecordMenuSeparator />
              <RowActions
                menuItem
                deleteUrl={`/api/investors/${inv.id}`}
                itemLabel="client"
                itemName={inv.name}
                verb="Delete"
                redirectTo="/dashboard/investors"
              />
            </RecordMenu>
          </>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          {showPan && inv.pan && <PanReveal pan={inv.pan} />}
          {showSegment && inv.segmentTag && <Badge raw>{inv.segmentTag}</Badge>}
          <span className="text-xs">Client since {inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"}</span>
          <BestTimeBadge session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }} investorId={inv.id} />
        </div>
        {contactRow}
      </PageHeaderCard>

      {/* The relationship at a glance (RM brief §40) — family, RM, AUM, SIP,
          last meeting, next review, risk, open work, insurance — above the
          deeper sections. Streams in on its own. */}
      <Suspense fallback={<div className="card-surface h-24 animate-pulse" aria-hidden />}>
        <ClientSummaryStrip
          session={session}
          investorId={inv.id}
          investorName={inv.name}
          show={{
            aum: showAum, sip: showSip, risk: showRisk, rm: showRm,
            // The A–D relationship category, not the investor TYPE behind showCategory.
            category: isFieldAllowed(license, "investor", "client_category"),
          }}
        />
      </Suspense>

      {/* The client journey (blueprint) — where this client is on the
          onboarding path. Above the tabs, so it is seen on every tab. */}
      <InvestorBlueprintStageBar investorId={inv.id} investorName={inv.name} />

      {/* Category tabs — group the sections so the page shows one clean group at
          a time. Renders right under the header (which stays pinned). */}
      <InvestorDetailTabs
        moduleKey="investors-detail"
        label="Client sections"
        tabs={investorDetailTabs({ holdings: holdingsCount })}
      />

      <RelatedListsContainer>

      {/* ───────────────────────────── Overview ───────────────────────────── */}

      {/* Composite health score — derived from existing fields, no extra query */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="health">
        <ClientHealthCard
          investor={inv as any}
          hasOpenSrBreach={!!data.health?.factors.some((f) => f.key === "sr")}
        />
      </RelatedListSection>

      {/* Next-Best-Action recommendations for this client (nothing when none) */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="recommended">
      <RecommendedActions
        session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }}
        investorId={inv.id}
        name={inv.name}
        phone={inv.phone}
        email={inv.email}
      />
      </RelatedListSection>

      {/* Another product this existing client wants — each with its own journey. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="opportunities">
        <OpportunitiesPanel investorId={inv.id} investorName={inv.name} />
      </RelatedListSection>

      {/* Review schedule — how often, when last, when next (drives the review-due reminder). */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="summary">
        <ReviewCadenceEditor
          investorId={inv.id}
          reviewFrequency={(inv.reviewFrequency as any) ?? null}
          reviewFrequencyDays={(inv as any).reviewFrequencyDays ?? null}
          lastReviewAt={inv.lastReviewAt ? new Date(inv.lastReviewAt).toISOString() : null}
          nextReviewAt={inv.nextReviewAt ? new Date(inv.nextReviewAt).toISOString() : null}
        />
      </RelatedListSection>

      {/* Every note on the client — added here, or on a logged call or visit —
          with the record's internal note under them. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="notes">
        <RecordNotes subject={{ type: "investor", id: inv.id }} internalNote={inv.notes} />
      </RelatedListSection>

      {/* ──────────────────────────── Portfolio ───────────────────────────── */}

      {/* No holdings or history loaded — say so once, with the way to load them,
          instead of five empty cards. */}
      {!hasPortfolio && (
        <RelatedListSection moduleKey="investors-detail" sectionKey="valuation">
          <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-10 text-center">
            <Wallet className="size-8 mx-auto text-muted-foreground/60" />
            <div className="mt-3 text-sm font-medium">No portfolio loaded yet</div>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              {showAum && Number(inv.aum ?? 0) > 0
                ? "The AUM on record came from an import without holdings. Import their folios from a CAMS / KFintech file to see holdings, live value and SIP health here."
                : "This client has no holdings or transactions loaded. Import their folios from a CAMS / KFintech file to see live valuation, XIRR and SIP health here."}
            </p>
            <Link href="/dashboard/rta-imports" className={buttonClass("primary", "sm", "mt-4")}>
              Import their portfolio <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </RelatedListSection>
      )}

      {hasPortfolio && (
        <>
          {/* Portfolio summary + every statement and report about it, together. */}
          {showAum && v && (
            <RelatedListSection moduleKey="investors-detail" sectionKey="valuation">
            <div className="space-y-4">
              {holdingsCount > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat
                    icon={Wallet}
                    label="Invested"
                    value={v.investedNet != null ? formatMoney(v.investedNet) : v.investedEstimate != null ? `≈ ${formatMoney(v.investedEstimate)}` : "—"}
                    sub={v.investedNet != null ? undefined : v.investedEstimate != null ? "Estimated — some redemptions are missing from the RTA history" : "Cost unknown for some holdings"}
                    tone="muted"
                  />
                  <Stat
                    icon={PieChart}
                    label="Current value"
                    value={formatMoney(v.currentValue)}
                    sub={v.asOf ? `As of ${formatDate(v.asOf)}` : undefined}
                    tone="muted"
                  />
                  <Stat
                    icon={TrendingUp}
                    label="Gain"
                    value={v.gain != null ? formatMoney(v.gain) : "—"}
                    sub={v.absoluteReturn != null ? formatPercent(v.absoluteReturn * 100) : v.gain == null ? "Needs every holding priced" : undefined}
                    tone={v.gain == null ? "muted" : v.gain > 0 ? "emerald" : v.gain < 0 ? "rose" : "muted"}
                  />
                  <Stat
                    icon={Percent}
                    label="XIRR"
                    value={v.xirr != null ? formatPercent(v.xirr * 100) : "—"}
                    sub={v.xirr == null ? "Needs the full transaction history" : "Annualised"}
                    tone="muted"
                  />
                </div>
              )}
              <StatementActions
                investorId={inv.id}
                statementCadence={(inv as any).statementCadence ?? "off"}
                extra={
                  <>
                    <Link href={`/dashboard/investors/${inv.id}/statement`} className="btn-secondary text-xs">
                      <Receipt className="size-3.5" /> Account statement
                    </Link>
                    <Link href={`/dashboard/investors/${inv.id}/review-report`} className="btn-secondary text-xs">
                      <FileText className="size-3.5" /> Quarterly review report
                    </Link>
                    <WealthStoryButton investorId={inv.id} clientName={inv.name} className="btn-secondary text-xs" />
                  </>
                }
              />
            </div>
            </RelatedListSection>
          )}

          {/* Per-scheme holdings — full tabular breakdown */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="holdings">
            <div id="rel-folios" className="scroll-mt-24">
              <HoldingsTable
                holdings={v.holdings as any}
                asOf={v.asOf}
                unpricedSchemes={v.unpricedSchemes}
              />
            </div>
          </RelatedListSection>

          {/* Portfolio allocation — derives from already-loaded folios */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="allocation">
            <div className="space-y-4">
              <PortfolioAllocation folios={data.folios as any} />
              {showRisk && <SuitabilityCard suitability={suitability} />}
            </div>
          </RelatedListSection>
        </>
      )}

      {/* SIPs and goals — the money that is committed and what it is for.
          Only when there is something to list. */}
      {(data.sips.length > 0 || data.goals.length > 0) && (
        <RelatedListSection moduleKey="investors-detail" sectionKey="sips_goals">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.sips.length > 0 && (
              <Section id="rel-sips" title="SIPs" count={data.sips.filter((s) => s.status === "active").length} countLabel="active">
                <ul className="divide-y">
                  {data.sips.map((s) => (
                    <li key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{s.schemeName ?? s.schemeCode}</div>
                        <div className="text-xs text-muted-foreground capitalize">{s.frequency} · day {s.sipDate}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-medium tabular-nums">{formatINR(Number(s.amount))}</div>
                        <Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {data.goals.length > 0 && (
              <Section id="rel-goals" title="Goals" count={data.goals.length}>
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
                      // Use the goal's OWN expected-return assumption (matches the
                      // goal detail page) instead of a hardcoded 10%, so the
                      // shortfall shown here reconciles with the goal calculator.
                      const annualReturn = Number((g as any).expectedReturn ?? 12) / 100;
                      const r = (annualReturn > 0 ? annualReturn : 0.12) / 12;
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
                            className="h-full bg-success"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                          <span>{pct.toFixed(0)}% · target {formatDate(g.targetDate)} · {g.category.replace(/_/g, " ")}</span>
                          {sip > 0 && <span className="tabular-nums">SIP {formatINR(sip)}/mo</span>}
                        </div>
                        {shortfall > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge raw tone="danger">Shortfall {formatINR(shortfall)}</Badge>
                            <Badge raw tone="warning">Suggested step-up +{formatINR(neededIncrease)}/mo</Badge>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}
          </div>
        </RelatedListSection>
      )}

      {hasPortfolio && (
        <>
          {/* SIP-bounce health — early churn signal from rejected SIP installments */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="sip_health">
            <SipHealthCard health={data.sipHealth} />
          </RelatedListSection>

          {/* Transaction ledger — recent purchases / redemptions / SIPs / switches */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="transactions">
            <TransactionLedger transactions={data.recentTransactions as any} total={data.txCount} />
          </RelatedListSection>

          {/* Churn-risk scorecard + AI retention play */}
          {showAum && data.churn && (
            <RelatedListSection moduleKey="investors-detail" sectionKey="churn">
            <ChurnRiskCard
              investorId={inv.id}
              result={data.churn}
              name={inv.name}
              serviceTier={inv.serviceTier}
              currentValueInr={v?.currentValue ?? Number(inv.aum ?? 0)}
            />
            </RelatedListSection>
          )}
        </>
      )}

      {/* Expected inflows and cross-sell — shown for every client (recording
          what they hold elsewhere is useful before they've invested a rupee). */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="fixed_deposits">
        <ClientFdPanel investorId={inv.id} canEdit={canEditFds(session)} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="expected_inflows">
        <ExpectedInflowsCard investorId={inv.id} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="cross_sell">
        <CrossSellCard investorId={inv.id} initial={(inv as any).crossSell ?? null} />
      </RelatedListSection>

      {/* ─────────────────────────── KYC & Profile ────────────────────────── */}

      {/* ----------------------------- Master record -----------------------------
        Every field the spec calls out under § 6 Module 4 Client Master, grouped
        logically so RM/back-office can scan it in one read. Figures that already
        sit in the summary strip (AUM, SIP, next review) and lists that have
        their own section on this tab (nominees, onboarding details) are not
        repeated here.
      */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="master">
      <div id="rel-master" className="card-surface p-5 scroll-mt-24">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title flex items-center gap-2">
            <User2 className="size-4 text-muted-foreground" /> Client details
          </h2>
          <div className="flex items-center gap-3">
            <EditClientDetailsLink investorId={inv.id} />
          </div>
        </div>

        <Group title="Identity">
          {showPan && <KV label="PAN" node={inv.pan ? <PanReveal pan={inv.pan} /> : null} />}
          <KV label="Name" value={inv.name} edit={{ id: inv.id, field: "name", value: inv.name ?? "" }} />
          <KV label="Name as per PAN" value={inv.nameAsPerPan ?? "—"} edit={{ id: inv.id, field: "nameAsPerPan", value: inv.nameAsPerPan ?? "", nullable: true }} />
          {showDob && <KV label="Date of birth" value={inv.dob ? formatDate(inv.dob) : "—"} edit={{ id: inv.id, field: "dob", type: "date", value: inv.dob ? String(inv.dob).slice(0, 10) : "", nullable: true }} />}
          <KV label="Gender" value={inv.gender === "M" ? "Male" : inv.gender === "F" ? "Female" : inv.gender === "O" ? "Other" : "—"} edit={{ id: inv.id, field: "gender", type: "select", options: GENDER_OPTS, value: inv.gender ?? "", nullable: true }} />
          <KV label="Marital status" value={inv.maritalStatus ?? "—"} cap />
          <KV label="Mother's name" value={inv.motherName ?? "—"} />
          <KV label="Place of birth" value={inv.birthPlace ?? "—"} />
          <KV label="Aadhaar (last 4)" value={inv.aadhaarLast4 ? `••••${inv.aadhaarLast4}` : "—"} mono edit={{ id: inv.id, field: "aadhaarLast4", value: inv.aadhaarLast4 ?? "", nullable: true, maxLength: 4, placeholder: "1234" }} />
          <KV label="Client since" value={inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"} edit={{ id: inv.id, field: "onboardedAt", type: "date", value: inv.onboardedAt ? String(inv.onboardedAt).slice(0, 10) : "", nullable: true }} />
          <KV label="Anniversary" value={inv.anniversaryDate ? formatDate(inv.anniversaryDate) : "—"} edit={{ id: inv.id, field: "anniversaryDate", type: "date", value: inv.anniversaryDate ? String(inv.anniversaryDate).slice(0, 10) : "", nullable: true }} />
        </Group>

        <Group title="Contact">
          {showPhone && <KV label="Mobile" value={inv.phone ?? "—"} edit={{ id: inv.id, field: "phone", type: "tel", value: inv.phone ?? "" }} />}
          <KV label="Mobile belongs to" value={inv.mobileRelation ?? "—"} cap />
          {showPhone && <KV label="Alternate mobile" value={inv.alternatePhone ?? "—"} edit={{ id: inv.id, field: "alternatePhone", type: "tel", value: inv.alternatePhone ?? "", nullable: true }} />}
          {showEmail && <KV label="Email" value={inv.email ?? "—"} edit={{ id: inv.id, field: "email", type: "email", value: inv.email ?? "" }} />}
          <KV label="Email belongs to" value={inv.emailRelation ?? "—"} cap />
          {showPhone && <KV label="WhatsApp" value={inv.whatsappPhone ?? "—"} edit={{ id: inv.id, field: "whatsappPhone", type: "tel", value: inv.whatsappPhone ?? "" }} />}
          {(inv.email || inv.phone) && (
            <KV
              label="Verified"
              node={
                <span className="inline-flex flex-wrap gap-1.5">
                  <VerifyContact
                    investorId={inv.id}
                    hasEmail={!!inv.email}
                    hasPhone={!!inv.phone}
                    emailVerified={!!inv.emailVerifiedAt}
                    phoneVerified={!!inv.phoneVerifiedAt}
                  />
                </span>
              }
            />
          )}
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
          {showCity && <KV label="City" value={(inv.address as any)?.city ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "city", address: (inv.address as any) ?? {}, value: (inv.address as any)?.city ?? "" }} />}
          {showState && <KV label="State" value={(inv.address as any)?.state ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "state", address: (inv.address as any) ?? {}, value: (inv.address as any)?.state ?? "" }} />}
          {showAddress && <KV label="Pincode" value={(inv.address as any)?.pincode ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "pincode", address: (inv.address as any) ?? {}, value: (inv.address as any)?.pincode ?? "" }} />}
          {showAddress && <KV label="Country" value={(inv.address as any)?.country ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "country", address: (inv.address as any) ?? {}, value: (inv.address as any)?.country ?? "" }} />}
        </Group>

        <Group title="Profile">
          <KV label="Occupation" value={inv.occupation ?? "—"} edit={{ id: inv.id, field: "occupation", value: inv.occupation ?? "", nullable: true }} />
          <KV label="Employer" value={inv.employerName ?? "—"} edit={{ id: inv.id, field: "employerName", value: inv.employerName ?? "", nullable: true }} />
          <KV label="Income range" value={inv.incomeRange ?? "—"} edit={{ id: inv.id, field: "incomeRange", value: inv.incomeRange ?? "", nullable: true, placeholder: "e.g. 10–25L" }} />
          <KV label="Client type" value={inv.investorCategory ? clientTypeLabel(inv.investorCategory) : "—"} edit={{ id: inv.id, field: "investorCategory", type: "select", options: ENTITY_OPTS, value: inv.investorCategory ?? "" }} />
          {showSegment && <KV label="Client type" value={inv.segmentTag ?? "—"} edit={{ id: inv.id, field: "segmentTag", type: "select", options: SEGMENT_OPTS, value: inv.segmentTag ?? "" }} />}
          <KV label="Client category" value={inv.clientCategory ?? "—"} edit={{ id: inv.id, field: "clientCategory", type: "select", options: CATEGORY_OPTS, value: inv.clientCategory ?? "", nullable: true }} />
          <KV label="Mode of holding" value={inv.modeOfHolding ?? "—"} cap />
          <KV label="Household type" value={inv.householdType ?? "—"} />
          <KV label="Family head name" value={inv.familyOwnerName ?? "—"} />
          <KV label="Referral client" value={inv.referralClientName ?? "—"} />
          {showRm && <KV label="Assigned RM" value={data.rm?.name ?? "—"} sub={data.rm?.email} />}
          <KV label="Family group" value={data.family?.familyName ?? "—"} sub={inv.familyRole ?? undefined} />
        </Group>

        <Group title="Compliance status">
          {showKyc && <Status label="KYC status" value={inv.kycStatus} good={inv.kycStatus === "verified"} />}
          <KV label="Residential status" value={inv.residencyStatus ?? "—"} cap edit={{ id: inv.id, field: "residencyStatus", type: "select", options: RESIDENCY_OPTS, value: inv.residencyStatus ?? "", nullable: true }} />
          <KV label="Tax status" value={inv.taxStatus ?? "—"} />
          <KV label="PAN–Aadhaar link" value={inv.panAadhaarLinkStatus ?? "—"} cap edit={{ id: inv.id, field: "panAadhaarLinkStatus", type: "select", options: PAN_AADHAAR_OPTS, value: inv.panAadhaarLinkStatus ?? "", nullable: true }} />
          <KV label="CKYC number" value={inv.ckycNumber ?? "—"} mono edit={{ id: inv.id, field: "ckycNumber", value: inv.ckycNumber ?? "", nullable: true }} />
          <KV label="CKYC expiry" value={inv.ckycExpiryAt ? formatDate(inv.ckycExpiryAt) : "—"} edit={{ id: inv.id, field: "ckycExpiryAt", type: "date", value: inv.ckycExpiryAt ? String(inv.ckycExpiryAt).slice(0, 10) : "", nullable: true }} />
          <KV label="KYC validated" value={inv.kycValidatedAt ? formatDate(inv.kycValidatedAt) : "—"} edit={{ id: inv.id, field: "kycValidatedAt", type: "date", value: inv.kycValidatedAt ? String(inv.kycValidatedAt).slice(0, 10) : "", nullable: true }} />
          <KV label="KRA" value={inv.kraName ?? "—"} />
          <KV label="FATCA status" value={inv.fatcaStatus ?? "—"} cap />
          <KV label="FATCA expiry" value={inv.fatcaExpiryAt ? formatDate(inv.fatcaExpiryAt) : "—"} />
          {showRisk && <Status label="Risk profile" value={inv.riskProfile ?? "not_assessed"} good={!!inv.riskProfile && !!inv.riskProfileSignedAt} />}
          {showPan && <KV label="UCC (BSE)" value={inv.bseUccCode ?? "—"} mono edit={{ id: inv.id, field: "bseUccCode", value: inv.bseUccCode ?? "", nullable: true }} />}
          {showPan && <KV label="CAN (NSE)" value={inv.nseCanCode ?? "—"} mono edit={{ id: inv.id, field: "nseCanCode", value: inv.nseCanCode ?? "", nullable: true }} />}
          {showPan && ((inv as any).uccCodes as string[] | undefined)?.length ? <KV label="Other UCCs" value={((inv as any).uccCodes as string[]).join(", ")} mono /> : null}
          <Status label="Mandate" value={inv.mandateStatus ?? "none"} good={inv.mandateStatus === "active"} />
          <KV label="Mandate ref" value={inv.mandateRefNo ?? "—"} mono edit={{ id: inv.id, field: "mandateRefNo", value: inv.mandateRefNo ?? "", nullable: true }} />
          {inv.mandateAmount != null && <KV label="Mandate amount" value={formatINR(Number(inv.mandateAmount))} />}
        </Group>

        {showBank && (
          <Group title="Bank account">
            <KV label="Bank name" value={inv.bankName ?? "—"} />
            <KV label="Account no." value={inv.bankAccountNumberMasked ?? "—"} mono />
            <KV label="IFSC" value={inv.bankIfsc ?? "—"} mono />
            {Array.isArray(inv.bankAccounts) && (inv.bankAccounts as any[]).length > 1 &&
              (inv.bankAccounts as any[]).slice(1).map((b, i) => (
                <KV key={i} label={`Bank ${i + 2}`} value={b?.bankName ?? "—"} sub={[b?.accountMasked, b?.ifsc, b?.accountType].filter(Boolean).join(" · ") || undefined} />
              ))}
          </Group>
        )}

        {(inv.secondHolderFirstName || inv.secondHolderLastName || inv.secondHolderOccupation || inv.secondHolderCompanyName || inv.secondHolderBirthPlace || inv.secondHolderMotherName || inv.secondHolderMaritalStatus) && (
          <Group title="Second / joint holder">
            <KV label="Name" value={[inv.secondHolderFirstName, inv.secondHolderLastName].filter(Boolean).join(" ") || "—"} />
            <KV label="Occupation" value={inv.secondHolderOccupation ?? "—"} />
            <KV label="Company" value={inv.secondHolderCompanyName ?? "—"} />
            <KV label="Birth place" value={inv.secondHolderBirthPlace ?? "—"} />
            <KV label="Mother's name" value={inv.secondHolderMotherName ?? "—"} />
            <KV label="Marital status" value={inv.secondHolderMaritalStatus ?? "—"} cap />
          </Group>
        )}

        <Group title="Lifetime & service">
          <KV label="Total lumpsum" value={formatINR(data.totalLumpsum)} sub="Successful purchases" />
          {showInflow && <KV label="Lifetime inflow" value={formatINR(Number(inv.lifetimeInflow ?? 0))} />}
          {showInflow && <KV label="Lifetime outflow" value={formatINR(Number(inv.lifetimeOutflow ?? 0))} />}
          <KV label="Service tier" value={inv.serviceTier ?? "—"} />
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
          <BlueprintStatusKV investorId={inv.id} />
          {showStatus && inv.status === "redemption_risk" && inv.redemptionRiskReason && (
            <KV label="Redemption-risk reason" value={inv.redemptionRiskReason} colSpan={2} />
          )}
        </Group>

        {/* Record metadata — who created and last changed it, and the id to
            quote to support. Quiet, at the foot of the record. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-2xs text-muted-foreground">
          <RecordProvenance entityType="investor" entityId={inv.id} createdAt={inv.createdAt} updatedAt={inv.updatedAt} />
          <span className="font-mono">ID {inv.id}</span>
        </div>
      </div>
      </RelatedListSection>

      {/* Nominees — dedicated, editable section (multi-nominee) */}
      {showNominee && (
        <RelatedListSection moduleKey="investors-detail" sectionKey="nominees">
          <div id="rel-nominees" className="scroll-mt-24">
            <NomineeSection
              investorId={inv.id}
              nominees={((inv.nominees as any[]) ?? []) as any}
              legacy={{
                name: inv.nomineeName,
                relation: inv.nomineeRelation,
                dob: inv.nomineeDob ? String(inv.nomineeDob) : null,
              }}
            />
          </div>
        </RelatedListSection>
      )}

      <RelatedListSection moduleKey="investors-detail" sectionKey="risk_history">
        <div id="rel-risk" className="card-surface p-5 scroll-mt-24">
          <div className="flex items-center justify-between mb-4 border-b pb-3">
            <h2 className="section-title flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" /> Risk profile history
            </h2>
            <div className="flex items-center gap-3">
              <SendRiskProfileLinkButton investorId={inv.id} />
              <Link
                href={`/dashboard/risk-profiles/new?investorId=${inv.id}`}
                className="text-xs font-semibold text-primary hover:underline"
              >
                + New assessment
              </Link>
            </div>
          </div>
          {!data.riskHistory || data.riskHistory.length === 0 ? (
            <EmptyRow text="No risk assessment on record yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b bg-secondary/50">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Profile date</th>
                    <th className="text-left px-4 py-2 font-semibold">Category</th>
                    <th className="text-center px-4 py-2 font-semibold">Score</th>
                    <th className="text-left px-4 py-2 font-semibold">Signed by</th>
                    <th className="text-left px-4 py-2 font-semibold">RM remarks</th>
                    <th className="text-right px-4 py-2 font-semibold">Document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.riskHistory.map((h) => (
                    <tr key={h.id} className="hover:bg-secondary/40">
                      <td className="px-4 py-3 text-xs font-medium tabular-nums">
                        {h.signedAt ? formatDate(h.signedAt, "dateTime") : formatDate(h.profileDate)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{h.finalCategory}</Badge>
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
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <RiskProfilePdfButtons profileId={h.id} name={inv.name} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </RelatedListSection>

      {/* Extra KYC captured from the onboarding link (renders nothing when empty) */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="kyc_data">
      <KycDataViewer kycData={(inv as any).kycData ?? null} />
      </RelatedListSection>

      {/* MFD-defined custom fields (renders only if the firm has defined any). */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="custom_fields">
        <CustomFieldsCard entity="investor" recordId={inv.id} initialValues={(inv as any).customFields ?? null} />
      </RelatedListSection>

      {/* ──────────────────────────── Engagement ──────────────────────────── */}

      {/* What happened, and what is open: the timeline with the open tasks,
          service requests and messaging consent beside it. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="related">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div id="rel-activity" className="lg:col-span-2 scroll-mt-24">
          <RecordTimeline
            items={timeline}
            emptyMessage="Nothing logged yet. Log a call or visit, add a task or send a message and it shows up here."
          />
        </div>

        <aside className="space-y-4">
          <Section id="rel-tasks" title="Open tasks" count={openTasks.length}>
            {openTasks.length === 0 ? (
              <EmptyRow text="No open tasks." />
            ) : (
              <ul className="space-y-1">
                {openTasks.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/dashboard/tasks?focus=${t.id}`}
                      className="block rounded-md -mx-2 px-2 py-1.5 text-sm hover:bg-accent/40 transition-colors"
                    >
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 capitalize">
                        {t.priority} · {t.dueAt ? formatRelative(t.dueAt) : "no due date"}
                      </div>
                    </Link>
                  </li>
                ))}
                {openTasks.length > 5 && (
                  <li className="pt-1 text-xs text-muted-foreground">+ {openTasks.length - 5} more</li>
                )}
              </ul>
            )}
          </Section>

          <Section
            id="rel-srs"
            title="Service requests"
            count={openRequests.length}
            countLabel="open"
            action={
              <span className="flex items-center gap-3">
                <ClientNpsChip requests={data.serviceRequests as any[]} />
                {/* Only offered once they have actually given feedback — an
                    empty report is a worse answer than no button. */}
                {(data.serviceRequests as any[]).some(
                  (s) => s?.type === "feedback" && s?.csatRating != null
                ) && (
                  <DownloadButton
                    url={`/api/investors/${inv.id}/feedback/pdf?download=1`}
                    filename="Client_Feedback.pdf"
                    className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                    title="Download this client's feedback report"
                  >
                    <Download className="size-3.5" /> Feedback PDF
                  </DownloadButton>
                )}
                <SendRiskProfileLinkButton investorId={inv.id} kind="feedback" />
              </span>
            }
          >
            {data.serviceRequests.length === 0 ? (
              <EmptyRow text="No service requests." />
            ) : (
              <ul className="space-y-2">
                {data.serviceRequests.slice(0, 5).map((s) => (
                  <li key={s.id} className="text-sm">
                    <div className="font-medium">{s.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      #{s.ticketNo} · {String(s.status).replace(/_/g, " ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Messaging consent">
            <ul className="space-y-1 text-sm">
              {["whatsapp", "email", "sms"].map((channel) => {
                const tx = data.consents.find((c) => c.channel === channel && c.scope === "transactional");
                const mk = data.consents.find((c) => c.channel === channel && c.scope === "marketing");
                return (
                  <li key={channel} className="flex items-center justify-between py-1 border-b last:border-0">
                    <span>{channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : "Email"}</span>
                    <div className="flex gap-2 text-xs">
                      <ConsentChip label="Service" granted={tx?.status === "granted"} />
                      <ConsentChip label="Marketing" granted={mk?.status === "granted"} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </aside>
      </div>
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="emails">
        <EmailRelatedList entityType="investor" entityId={inv.id} entityName={inv.name} entityEmail={inv.email} canSend={can(session.roles, "communication.send", session.permissions)} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="whatsapp">
        <WhatsAppRelatedList entityType="investor" entityId={inv.id} entityName={inv.name} entityPhone={inv.whatsappPhone ?? inv.phone} />
      </RelatedListSection>

      {/* Documents & attachments — RM-uploaded files + auto-ingested client
          uploads from the required-documents form (same compliance_documents
          rows, linked to this investor). Self-fetching island. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="documents">
        <InvestorDocumentsSection investorId={inv.id} investorName={inv.name} investorPhone={inv.phone} investorEmail={inv.email} />
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

      {/* Referrals — dedicated, editable section (multi-referral) */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="referrals">
        <ReferralSection
          investorId={inv.id}
          referrals={((inv.referrals as any[]) ?? []) as any}
          referredLeads={data.referredLeads}
        />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="gifts">
        <ClientGifts investorId={inv.id} clientName={inv.name} />
      </RelatedListSection>


      </RelatedListsContainer>

      {/* What is still missing to make this client transaction-ready, and the
          button that completes it. At the foot of every tab; renders nothing
          once everything is in. */}
      <ClientReadinessStrip
        investorId={inv.id}
        kyc={showKyc ? inv.kycStatus === "verified" : null}
        risk={showRisk ? (isRiskProfileMissing ? "missing" : isRiskProfileExpired ? "expired" : "ok") : null}
        nominee={showNominee ? !!inv.nomineeName || ((inv.nominees as any[] | null)?.length ?? 0) > 0 : null}
        bank={showBank ? !!(inv.bankAccountNumberMasked || inv.bankName) : null}
        emailVerified={inv.email ? !!inv.emailVerifiedAt : null}
        phoneVerified={inv.phone ? !!inv.phoneVerifiedAt : null}
        missingFields={missingFields}
        action={
          <OnboardingWizardButton
            investorId={inv.id}
            label="Complete setup"
            className={buttonClass("secondary", "sm")}
            investor={{
              email: inv.email, phone: inv.phone, whatsappPhone: inv.whatsappPhone,
              kycStatus: inv.kycStatus, panAadhaarLinkStatus: inv.panAadhaarLinkStatus, nameAsPerPan: inv.nameAsPerPan,
              riskProfile: inv.riskProfile, nomineeName: inv.nomineeName, nomineeRelation: inv.nomineeRelation,
              bankName: inv.bankName, bankAccountNumberMasked: inv.bankAccountNumberMasked, bankIfsc: inv.bankIfsc,
            }}
          />
        }
        verify={
          <VerifyContact
            investorId={inv.id}
            hasEmail={!!inv.email}
            hasPhone={!!inv.phone}
            emailVerified={!!inv.emailVerifiedAt}
            phoneVerified={!!inv.phoneVerifiedAt}
          />
        }
      />
    </div>
  );
}

/**
 * The client's own satisfaction score, on their record.
 *
 * A submitted rating is filed as a closed `feedback` service request, so the
 * number was only readable inside a ticket subject ("Client Feedback (NPS: 8)")
 * — present in the list, but not something you could see at a glance on the
 * client. Shows the latest rating in the standard NPS bands, with the full
 * history and comment on hover.
 */
function ClientNpsChip({ requests }: { requests: any[] }) {
  const scored = (requests ?? [])
    .filter((r) => r?.type === "feedback" && r?.csatRating != null)
    .sort((a, b) => new Date(b.csatAt ?? 0).getTime() - new Date(a.csatAt ?? 0).getTime());
  if (!scored.length) return null;

  const latest = scored[0];
  const score = Number(latest.csatRating);
  // 0-6 detractor, 7-8 passive, 9-10 promoter.
  const tone: BadgeTone = score <= 6 ? "danger" : score <= 8 ? "warning" : "success";
  const when = latest.csatAt
    ? formatDate(new Date(latest.csatAt))
    : "";

  return (
    <Link
      href="/dashboard/support/feedback"
      title={[
        `Latest feedback: ${score}/10${when ? ` on ${when}` : ""}`,
        latest.csatComment ? `"${latest.csatComment}"` : null,
        scored.length > 1 ? `${scored.length} responses in total` : null,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <Badge raw tone={tone}>
        Feedback {score}/10
        {scored.length > 1 && <span className="font-normal opacity-70"> · {scored.length}</span>}
      </Badge>
    </Link>
  );
}

function Section({
  id,
  title,
  count,
  countLabel,
  action,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  /** What the count counts when it is not simply "of these" — "active", "open". */
  countLabel?: string;
  /** Optional control rendered in the header, right of the count. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="card-surface p-5 scroll-mt-24">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="section-title">{title}</h3>
        <span className="flex items-center gap-3">
          {count !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {count}{countLabel ? ` ${countLabel}` : ""}
            </span>
          )}
          {action}
        </span>
      </div>
      {children}
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
        granted ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
      }`}
      title={granted ? `${label} messages: consent recorded` : `${label} messages: no consent recorded`}
    >
      {label} {granted ? "✓" : "—"}
    </span>
  );
}

/** Master-record group header + 3-col grid for KV rows. */
// Option sets for the inline-editable selects — mirror the PATCH zod enums.
const GENDER_OPTS = [{ value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" }];
// The client types and their labels: lib/investors/client-types.ts.
const ENTITY_OPTS = CLIENT_TYPE_KEYS.map((value) => ({ value, label: clientTypeLabel(value) }));
const SEGMENT_OPTS = ["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((v) => ({ value: v, label: v }));
const CATEGORY_OPTS = ["A", "B", "C", "D"].map((v) => ({ value: v, label: `Category ${v}` }));
const RESIDENCY_OPTS = ([["indian_resident", "Indian resident"], ["nri", "NRI"], ["oci", "OCI"], ["pio", "PIO"], ["foreign_national", "Foreign national"]] as const).map(([value, label]) => ({ value, label }));
const PAN_AADHAAR_OPTS = ([["linked", "Linked"], ["not_linked", "Not linked"], ["pending", "Pending"], ["not_applicable", "Not applicable"]] as const).map(([value, label]) => ({ value, label }));

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t first:border-t-0 first:pt-0 pt-4 mt-4 first:mt-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function KV({
  label,
  value,
  node,
  sub,
  mono,
  cap,
  highlight,
  colSpan,
  edit,
}: {
  label: string;
  value?: string;
  /** A rendered value (a masked PAN, verification pills) instead of text. */
  node?: React.ReactNode;
  sub?: string;
  mono?: boolean;
  cap?: boolean;
  highlight?: boolean;
  colSpan?: number;
  edit?: InlineEditSpec;
}) {
  return (
    <div className={colSpan === 2 ? "col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${cap ? "capitalize" : ""} ${
          highlight ? "font-semibold tabular-nums" : ""
        }`}
      >
        {node !== undefined ? (
          node ?? <span className="text-muted-foreground">—</span>
        ) : edit ? (
          <InlineEditField spec={edit} display={value ?? ""} />
        ) : value && value.trim() && value.trim() !== "—" ? (
          value
        ) : (
          " "
        )}
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
  const tone: BadgeTone = good ? "success" : bad ? "danger" : warn ? "warning" : "neutral";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <Badge tone={tone} className="mt-1">{value}</Badge>
    </div>
  );
}
