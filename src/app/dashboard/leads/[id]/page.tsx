import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { attendeeIs } from "@/lib/review-meetings/attendees";
import {
  Phone,
  Mail,
  MessageCircle,
  CalendarCheck,
  CalendarClock,
  ListChecks,
  CheckCircle2,
  Flame,
  IndianRupee,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { users, tasks, communications, riskProfileResponses, proposals, activities, reviewMeetings } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadViewableLead } from "@/lib/leads/access";
import { formatDate, formatRelative, formatPhone } from "@/lib/utils";
import { formatDueIn, formatMoney } from "@/lib/format";
import { fromActivities, fromCommunications, fromLeadNotes, fromMeetings, fromTasks, mergeTimeline } from "@/lib/timeline";
import { Stat } from "@/components/dashboards/DashboardShared";
import { LeadActions } from "@/components/leads/LeadActions";
import { SendTemplateButtons } from "@/components/comms/SendTemplateButtons";
import { EmailRelatedList } from "@/components/comms/EmailRelatedList";
import { can } from "@/lib/auth/rbac";
import { WhatsAppRelatedList } from "@/components/comms/WhatsAppRelatedList";
import { InvestorDetailTabs } from "@/components/investors/InvestorDetailTabs";
import { CheckInButton } from "@/components/activities/ActivityLogger";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { RowActions } from "@/components/common/RowActions";
import { RecordMenu, RecordMenuSeparator } from "@/components/common/RecordMenu";
import { RecordTimeline } from "@/components/common/RecordTimeline";
import { SignalScoreCard } from "@/components/leads/SignalScoreCard";
import { LeadEditPanel } from "@/components/leads/LeadEditPanel";
import { LeadAttachments } from "@/components/leads/LeadAttachments";
import { CustomFieldsCard } from "@/components/common/CustomFieldsCard";
import { LeadScoreButton } from "@/components/leads/LeadScoreButton";
import { stageBadgeClass, stageLabel } from "@/lib/leads/stages";
import { leadSourceLabel } from "@/lib/leads/sources";
import { bandBadgeClass, bandLabel } from "@/lib/leads/score";
import { OnboardingActions } from "@/components/leads/OnboardingActions";
import { BlueprintStageBar } from "@/components/leads/BlueprintStageBar";
import { ProposalJourneyCard } from "@/components/proposals/ProposalJourneyCard";
import { MENU_ITEM } from "@/components/ui/menu-item-class";
import {
  RelatedListsContainer,
  RelatedListsManager,
  RelatedListSection,
  type RelatedListDef,
} from "@/components/common/RelatedLists";

/**
 * Related-list sections on the Lead detail page. Order = default page
 * order; users can hide / reorder via "Customize page" in the More menu.
 */
const LEAD_DETAIL_SECTIONS: RelatedListDef[] = [
  { key: "converted_banner", label: "Converted-to-client banner" },
  { key: "blueprint", label: "Lead journey" },
  { key: "onboarding", label: "Client links (risk profile / proposal / tracker)" },
  { key: "signals", label: "Engagement signals" },
  { key: "edit_panel", label: "Lead record" },
  { key: "attachments", label: "Attachments" },
  { key: "custom_fields", label: "Custom fields" },
  { key: "activity", label: "Activity" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "emails", label: "Emails" },
];

/** Tab groups for the lead-detail page — the header stays pinned above. */
function leadDetailTabs({ activityCount }: { activityCount: number }) {
  return [
    { key: "overview", label: "Overview", sections: ["converted_banner", "blueprint", "onboarding", "signals"] },
    { key: "details", label: "Details", sections: ["edit_panel", "attachments", "custom_fields"] },
    { key: "activity", label: "Activity", sections: ["activity", "whatsapp", "emails"], count: activityCount },
  ];
}
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    // Scope to the viewer's access: requires a lead-view capability and, for
    // RMs/branch heads, that the lead is theirs. Returns null otherwise (→
    // notFound), so an RM can't open another RM's lead by URL. The API
    // (GET /api/leads/[id]) already does this; the page used to bypass it.
    const lead = await loadViewableLead(tx, session, id);
    if (!lead) return null;
    // The secondary queries are independent of each other and only depend on
    // `lead.id`, so they run in parallel.
    const [owner, relatedTasks, relatedComms, latestRiskList, latestProposalList, activityRows, meetingRows] = await Promise.all([
      lead.ownerId
        ? tx.select().from(users).where(eq(users.id, lead.ownerId)).limit(1).then((r) => r[0])
        : Promise.resolve(null),
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.subjectType, "lead"), eq(tasks.subjectId, id), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.createdAt))
        .limit(50),
      tx
        .select()
        .from(communications)
        .where(eq(communications.leadId, id))
        .orderBy(desc(communications.createdAt))
        .limit(50),
      tx
        .select()
        .from(riskProfileResponses)
        .where(eq(riskProfileResponses.investorId, id))
        .orderBy(desc(riskProfileResponses.signedAt))
        .limit(1),
      tx
        .select()
        .from(proposals)
        .where(and(eq(proposals.leadId, id)))
        .orderBy(desc(proposals.createdAt))
        .limit(1),
      // The interaction log — calls, visits and notes logged against this
      // lead, including from the mobile app's call sync.
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
        .where(and(eq(activities.subjectType, "lead"), eq(activities.subjectId, id)))
        .orderBy(desc(activities.occurredAt))
        .limit(100),
      tx
        .select()
        .from(reviewMeetings)
        // Meetings about this lead, and meetings they attended.
        .where(or(eq(reviewMeetings.leadId, id), attendeeIs("lead", id, sql`${reviewMeetings.attendees}`)))
        .orderBy(desc(reviewMeetings.meetingDate))
        .limit(50),
    ]);
    return {
      lead,
      owner,
      relatedTasks,
      relatedComms,
      latestRisk: latestRiskList[0],
      latestProposal: latestProposalList[0],
      activityRows,
      meetingRows,
    };
  });
  if (!data) notFound();

  const l = data.lead;

  // ── Header facts (deterministic — no AI call on page load) ──
  const scoreBand = (l.scoreBand as any) ?? "cold";
  const daysAsLead = l.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(l.createdAt as any).getTime()) / DAY)) : 0;
  const openTasks = data.relatedTasks.filter((t: any) => !["done", "completed", "cancelled"].includes(String(t.status))).length;
  const nextFollowUp = l.nextFollowUpAt ? new Date(l.nextFollowUpAt as any) : null;
  const followUpLate = nextFollowUp != null && nextFollowUp.getTime() < Date.now() && !l.convertedInvestorId;
  const expected = Number((l as any).expectedBusinessAmount ?? l.intendedAmount ?? 0);
  const lastTouchDaysAgo = l.lastContactAt
    ? Math.max(0, Math.floor((Date.now() - new Date(l.lastContactAt as any).getTime()) / DAY))
    : null;

  const timeline = mergeTimeline(
    fromActivities(data.activityRows),
    fromLeadNotes(l.followUpNotes ?? ""),
    fromTasks(data.relatedTasks, { href: (t) => `/dashboard/tasks?focus=${t.id}` }),
    fromCommunications(data.relatedComms),
    fromMeetings(data.meetingRows),
  );

  return (
    <div className="max-w-5xl space-y-5">
      {/* The header, the figures and the tabs sit OUTSIDE the customisable
          section stack, so a saved "Customize page" order can never move them. */}
      <div className="space-y-5">
        {/* WHO, and what to do. The heading carries the record's actions the
            way every other screen does; everything secondary sits in More. */}
        <PageHeaderCard
          breadcrumb={[{ label: "Leads", href: "/dashboard/leads" }, { label: l.name }]}
          title={<>{l.name}</>}
          actions={
            <>
              <LeadActions
                leadId={l.id}
                leadName={l.name}
                leadEmail={l.email}
                leadPhone={l.phone}
                currentStage={l.stage}
                alreadyConvertedInvestorId={l.convertedInvestorId ?? null}
              />
              <SendTemplateButtons type="lead" id={l.id} name={l.name} email={l.email} phone={l.phone} />
              <RecordMenu>
                <CheckInButton subject={{ type: "lead", id: l.id, name: l.name, phone: l.phone }} triggerClassName={MENU_ITEM} />
                <LeadScoreButton
                  name={l.name}
                  source={l.source}
                  stage={l.stage}
                  ageInStageDays={daysAsLead}
                  lastTouchDaysAgo={lastTouchDaysAgo}
                  triggerClassName={MENU_ITEM}
                />
                <ChangeLogButton entityType="lead" entityId={l.id} triggerClassName={MENU_ITEM} />
                <RecordMenuSeparator />
                <RelatedListsManager moduleKey="leads-detail" sections={LEAD_DETAIL_SECTIONS} triggerClassName={MENU_ITEM} />
                <RecordMenuSeparator />
                <RowActions
                  menuItem
                  deleteUrl={`/api/leads/${l.id}`}
                  itemLabel="lead"
                  itemName={l.name}
                  redirectTo="/dashboard/leads"
                />
              </RecordMenu>
            </>
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <span className={`chip ${stageBadgeClass(l.stage)}`}>{stageLabel(l.stage)}</span>
            <span className={`chip ${bandBadgeClass(scoreBand)}`} title="Lead score, 0–100, from the lead's own details and activity">
              <Flame className="size-3" /> {bandLabel(scoreBand)} · {l.leadScore ?? 0}
            </span>
            <span className="text-muted-foreground">{leadSourceLabel(l.source)}</span>
            {data.owner && <span className="text-muted-foreground">· {data.owner.name}</span>}
            <span className="text-muted-foreground">
              · last contact {l.lastContactAt ? formatRelative(l.lastContactAt) : "never"}
            </span>
          </div>
          {(l.phone || l.email) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              {l.phone && (
                <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Phone className="size-4" /> {formatPhone(l.phone)}
                </a>
              )}
              {l.email && (
                <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Mail className="size-4" /> {l.email}
                </a>
              )}
              {l.phone && (
                <a
                  href={`https://wa.me/${l.phone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              )}
            </div>
          )}
        </PageHeaderCard>

        {/* HOW IT IS GOING. Four facts a salesperson scans: when to act, how
            big it is, how old it is, what is pending. The score is the chip
            beside the name and is not repeated here. */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={CalendarClock}
            label="Next follow-up"
            value={nextFollowUp ? formatDate(nextFollowUp) : "—"}
            sub={nextFollowUp ? formatDueIn(nextFollowUp) : "Not set"}
            tone={followUpLate ? "rose" : "muted"}
          />
          <Stat
            icon={IndianRupee}
            label="Expected business"
            value={expected > 0 ? formatMoney(expected) : "—"}
            sub={expected > 0 ? undefined : "Not captured"}
            tone="muted"
          />
          <Stat
            icon={CalendarCheck}
            label="Days as lead"
            value={String(daysAsLead)}
            tone={daysAsLead > 30 && !l.convertedInvestorId ? "amber" : "muted"}
          />
          <Stat
            icon={ListChecks}
            label="Open tasks"
            value={String(openTasks)}
            tone={openTasks > 0 ? "amber" : "muted"}
          />
        </div>
      </div>

      {/* Category tabs — group the sections; the header stays pinned above. */}
      <InvestorDetailTabs
        moduleKey="leads-detail"
        label="Lead sections"
        tabs={leadDetailTabs({ activityCount: timeline.length })}
      />

      <RelatedListsContainer>

      {/* Converted banner */}
      {l.convertedInvestorId && (
        <RelatedListSection moduleKey="leads-detail" sectionKey="converted_banner">
          <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle2 className="size-4 text-success" />
            <span>
              Converted to a client{l.convertedAt && <> on {formatDate(l.convertedAt)}</>}.{" "}
              <Link href={`/dashboard/investors/${l.convertedInvestorId}`} className="font-medium underline">
                Open client record →
              </Link>
            </span>
          </div>
        </RelatedListSection>
      )}

      {/* The lead journey — the stage tracker with the guided next actions.
          Lead-phase only (stages 1–12, up to Documents Received). When the
          lead reaches docs_received the bar swaps in a "Convert to Client"
          CTA. The remaining stages render on the investor page. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="blueprint">
        <div data-blueprint-section>
        <BlueprintStageBar
          leadId={l.id}
          phase="lead"
          convertedInvestorId={l.convertedInvestorId ?? null}
        />
        <ProposalJourneyCard leadId={l.id} />
        </div>
      </RelatedListSection>

      {/* Client links — pinned scroll target for the journey's "Send risk
          profile / Capture approval" buttons (they dispatch a custom event
          that scrolls here). */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="onboarding">
        <div data-onboarding-actions>
          <OnboardingActions
            leadId={l.id}
            leadPhone={l.phone}
            leadEmail={l.email}
            leadName={l.name}
            hasRiskProfile={!!data.latestRisk}
            pendingProposalId={data.latestProposal?.id ?? null}
            alreadyConvertedInvestorId={l.convertedInvestorId ?? null}
          />
        </div>
      </RelatedListSection>

      {/* Behavioural engagement signals — renders nothing until there are some. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="signals">
      <SignalScoreCard session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }} leadId={l.id} />
      </RelatedListSection>

      {/* Editable record — every spec field, inline edit — and who created /
          last changed it. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="edit_panel">
        <div className="space-y-3">
          <LeadEditPanel lead={JSON.parse(JSON.stringify(l))} />
          <RecordProvenance
            entityType="lead"
            entityId={l.id}
            createdAt={l.createdAt}
            updatedAt={l.updatedAt}
            className="px-1"
          />
        </div>
      </RelatedListSection>

      {/* Files and proposals for this lead (files move to the client on conversion). */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="attachments">
        <LeadAttachments leadId={l.id} leadName={l.name} />
      </RelatedListSection>

      {/* MFD-defined custom fields (renders only if the firm has defined any). */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="custom_fields">
        <CustomFieldsCard entity="lead" recordId={l.id} initialValues={(l as any).customFields ?? null} />
      </RelatedListSection>

      {/* Everything that happened with this lead, newest first: calls, visits
          and notes, tasks, meetings, messages. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="activity">
        <RecordTimeline
          items={timeline}
          emptyMessage="Nothing logged yet. Log a call, add a task or schedule a meeting and it shows up here."
        />
      </RelatedListSection>

      <RelatedListSection moduleKey="leads-detail" sectionKey="whatsapp">
        <WhatsAppRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityPhone={l.phone} />
      </RelatedListSection>

      <RelatedListSection moduleKey="leads-detail" sectionKey="emails">
        <EmailRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityEmail={l.email} canSend={can(session.roles, "communication.send", session.permissions)} />
      </RelatedListSection>

      </RelatedListsContainer>

    </div>
  );
}
