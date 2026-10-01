import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  Phone,
  Mail,
  MessageCircle,
  CalendarCheck,
  ListChecks,
  ClipboardList,
  CheckCircle2,
  Flame,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { users, tasks, communications, riskProfileResponses, proposals } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadViewableLead } from "@/lib/leads/access";
import { formatDate, formatRelative } from "@/lib/utils";
import { Stat } from "@/components/dashboards/DashboardShared";
import { LeadActions } from "@/components/leads/LeadActions";
import { EmailRelatedList } from "@/components/comms/EmailRelatedList";
import { WhatsAppRelatedList } from "@/components/comms/WhatsAppRelatedList";
import { InvestorDetailTabs } from "@/components/investors/InvestorDetailTabs";
import { CheckInButton, LogActivityButton } from "@/components/activities/ActivityLogger";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { RowActions } from "@/components/common/RowActions";
import { RecordAutomations } from "@/components/sales-ops/RecordAutomations";
import { SignalScoreCard } from "@/components/leads/SignalScoreCard";
import { LeadEditPanel } from "@/components/leads/LeadEditPanel";
import { CustomFieldsCard } from "@/components/common/CustomFieldsCard";
import { LeadScoreButton } from "@/components/leads/LeadScoreButton";
import { stageBadgeClass, stageLabel } from "@/lib/leads/stages";
import { bandBadgeClass, bandLabel } from "@/lib/leads/score";
import { OnboardingActions } from "@/components/leads/OnboardingActions";
import { BlueprintStageBar } from "@/components/leads/BlueprintStageBar";
import { ProposalJourneyCard } from "@/components/proposals/ProposalJourneyCard";
import { STAGE_ACTIONS } from "@/lib/blueprints/stage-actions";
import { OverflowMenu, NextStepBanner } from "@/components/leads/LeadHeaderTools";
import {
  RelatedListsContainer,
  RelatedListsManager,
  RelatedListSection,
  type RelatedListDef,
} from "@/components/common/RelatedLists";

/**
 * Related-list sections on the Lead detail page. Order = default page
 * order; users can hide / reorder via the "Customize page" button.
 */
const LEAD_DETAIL_SECTIONS: RelatedListDef[] = [
  { key: "header", label: "Lead header & actions", required: true },
  // Priority order. Status the RM must not miss comes first, then the work to
  // do, then the context behind it. Engagement signals used to lead this list
  // and the converted banner used to close it — exactly inverted: the banner
  // says "this is already a client, stop selling", and signals reads
  // "none yet" on most leads.
  { key: "converted_banner", label: "Converted-to-client banner" },
  { key: "blueprint", label: "Blueprint stage tracker" },
  { key: "onboarding", label: "Onboarding actions (risk profile / docs / approval)" },
  { key: "signals", label: "Engagement signals" },
  { key: "edit_panel", label: "Editable details" },
  { key: "custom_fields", label: "Custom fields" },
  { key: "activity", label: "Activity timeline" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "emails", label: "Emails" },
];
/** Tab groups for the lead-detail page — the header stays pinned above. */
function leadDetailTabs({ activityCount }: { activityCount: number }) {
  return [
    { key: "overview", label: "Overview", sections: ["converted_banner", "blueprint", "onboarding", "signals"] },
    { key: "details", label: "Details", sections: ["edit_panel", "custom_fields"] },
    { key: "activity", label: "Activity", sections: ["activity", "whatsapp", "emails"], count: activityCount },
  ];
}
export const dynamic = "force-dynamic";

/** Format an Indian mobile as "+91 XXXXX XXXXX" (falls back to raw if not 10 digits). */
function formatPhoneIN(raw?: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return ten.length === 10 ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : raw;
}

/** The blueprint's recommended next action for a stage — the "what to do now". */
function nextBestStep(stage: string): { label: string; hint?: string | null } | null {
  const actions = STAGE_ACTIONS[stage];
  if (!actions || !actions.length) return null;
  const primary = actions.find((a) => a.tone === "primary") ?? actions[0];
  return { label: primary.label, hint: primary.hint ?? null };
}

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
    // Run the 5 secondary queries in parallel — they're all independent of
    // each other and only depend on `lead.id`. This cuts the page's TTFB
    // from ~5x query-latency to ~1x query-latency on slow links.
    const [owner, relatedTasks, relatedComms, latestRiskList, latestProposalList] = await Promise.all([
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
    ]);
    return {
      lead,
      owner,
      relatedTasks,
      relatedComms,
      latestRisk: latestRiskList[0],
      latestProposal: latestProposalList[0],
    };
  });
  if (!data) notFound();

  const l = data.lead;

  // ── Header intelligence (deterministic — no AI call on page load) ──
  const scoreBand = (l.scoreBand as any) ?? "cold";
  const daysAsLead = l.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(l.createdAt as any).getTime()) / 86_400_000)) : 0;
  const messageCount = data.relatedComms.length;
  const openTasks = data.relatedTasks.filter((t: any) => !["done", "completed", "cancelled"].includes(String(t.status))).length;
  const next = nextBestStep(l.stage);
  // NOTE: there used to be a `snapshot` sentence rendered under the badges.
  // Every clause in it duplicated something already on screen — source, band,
  // score and stage are the badges beside the name; message count is a stat
  // cell; last contact sits top-right; the next step is the banner. It read as
  // the page explaining itself twice, in the most valuable strip of the screen.

  return (
    <div className="max-w-5xl space-y-5">
      <RelatedListsContainer>
      <RelatedListSection moduleKey="leads-detail" sectionKey="header">
      <div className="space-y-5">
        {/* WHO. The heading sits on the page ground like every other screen —
            it used to be nested inside a card, so this one page framed its
            breadcrumb and title in a box nothing else had. The trail names the
            lead instead of saying "Details", which is what the RM needs when
            three leads are open in three tabs. */}
        <PageHeaderCard
          breadcrumb={[{ label: "Leads", href: "/dashboard/leads" }, { label: l.name }]}
          title={<>{l.name}</>}
          actions={
            <>
              <RelatedListsManager moduleKey="leads-detail" sections={LEAD_DETAIL_SECTIONS} />
              <RowActions
                deleteUrl={`/api/leads/${l.id}`}
                itemLabel="lead"
                itemName={l.name}
                redirectTo="/dashboard/leads"
              />
            </>
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <span className={`chip ${stageBadgeClass(l.stage)}`}>{stageLabel(l.stage)}</span>
            <span className={`chip ${bandBadgeClass(scoreBand)}`} title="Deterministic lead score (0–100)">
              <Flame className="size-3" /> {bandLabel(scoreBand)} · {l.leadScore ?? 0}
            </span>
            <span className="text-muted-foreground">via {l.source}</span>
            {data.owner && <span className="text-muted-foreground">· owned by {data.owner.name}</span>}
            <span className="text-muted-foreground">
              · last contact {l.lastContactAt ? formatRelative(l.lastContactAt) : "never"}
            </span>
          </div>
        </PageHeaderCard>

        {/* WHAT TO DO NOW — kept directly under the name, ahead of the numbers. */}
        {next && <NextStepBanner label={next.label} hint={next.hint} />}

        {/* HOW IT IS GOING. Four tiles in the same anatomy the rest of the app
            uses, rather than the bespoke grey strip this page had: the figures
            were 18px in a tinted bar and read as a toolbar, not as metrics.
            Tone is earned — amber only when the number is asking for action. */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={Flame}
            label="Lead score"
            value={String(l.leadScore ?? 0)}
            sub={bandLabel(scoreBand)}
            tone={scoreBand === "hot" ? "rose" : scoreBand === "warm" ? "amber" : "muted"}
          />
          <Stat
            icon={CalendarCheck}
            label="Days as lead"
            value={String(daysAsLead)}
            tone={daysAsLead > 30 ? "amber" : "muted"}
          />
          <Stat
            icon={MessageCircle}
            label="Messages"
            value={messageCount >= 50 ? "50+" : String(messageCount)}
            tone="muted"
          />
          <Stat
            icon={ListChecks}
            label="Open tasks"
            value={String(openTasks)}
            tone={openTasks > 0 ? "amber" : "muted"}
          />
        </div>

        {/* ACT. Every way to reach or move this lead, in one card. Reaching out
            and logging the outcome were previously separated by the stat strip,
            which is the wrong seam — they are the same job. */}
        <div className="card-surface p-5 space-y-4" data-lead-actions>
          <div className="flex flex-wrap items-center gap-2">
            {l.phone && (
              <a href={`tel:${l.phone}`} className="btn-secondary !px-2.5 !py-1 !text-sm !font-normal text-muted-foreground hover:text-foreground">
                <Phone className="size-4" /> {formatPhoneIN(l.phone)}
              </a>
            )}
            {l.email && (
              <a href={`mailto:${l.email}`} className="btn-secondary !px-2.5 !py-1 !text-sm !font-normal text-muted-foreground hover:text-foreground">
                <Mail className="size-4" /> {l.email}
              </a>
            )}
            {l.phone && (
              <a
                href={`https://wa.me/${l.phone.replace(/[^\d]/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary !px-2.5 !py-1 !text-sm !font-normal text-muted-foreground hover:text-foreground"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            <div className="ml-auto">
              <LeadScoreButton
                name={l.name}
                source={l.source}
                stage={l.stage}
                ageInStageDays={daysAsLead}
                lastTouchDaysAgo={
                  l.lastContactAt
                    ? Math.max(0, Math.floor((Date.now() - new Date(l.lastContactAt as any).getTime()) / 86_400_000))
                    : null
                }
              />
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <LeadActions
              leadId={l.id}
              leadName={l.name}
              leadEmail={l.email}
              leadPhone={l.phone}
              currentStage={l.stage}
              alreadyConvertedInvestorId={l.convertedInvestorId ?? null}
            />
            <div className="flex flex-wrap items-center gap-2">
              <CheckInButton subject={{ type: "lead", id: l.id, name: l.name, phone: l.phone }} />
              <LogActivityButton subject={{ type: "lead", id: l.id, name: l.name, phone: l.phone }} label="Log call / visit" variant="secondary" />
              <OverflowMenu>
                <ChangeLogButton entityType="lead" entityId={l.id} />
                <RecordAutomations subject={{ type: "lead", id: l.id }} />
              </OverflowMenu>
            </div>
            <RecordProvenance
              entityType="lead"
              entityId={l.id}
              createdAt={l.createdAt}
              updatedAt={l.updatedAt}
              className="text-xs"
            />
          </div>
        </div>
      </div>
      </RelatedListSection>

      {/* Category tabs — group the sections; the header stays pinned above. */}
      <InvestorDetailTabs
        moduleKey="leads-detail"
        label="Lead sections"
        tabs={leadDetailTabs({ activityCount: data.relatedComms.length + data.relatedTasks.length })}
      />


      {/* Converted banner */}
      {l.convertedInvestorId && (
        <RelatedListSection moduleKey="leads-detail" sectionKey="converted_banner">
          <div className="rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>
              Converted to client {l.convertedAt && <>on {formatDate(l.convertedAt)}</>}.{" "}
              <Link href={`/dashboard/investors/${l.convertedInvestorId}`} className="font-medium underline">
                Open client →
              </Link>
            </span>
          </div>
        </RelatedListSection>
      )}

      {/* Blueprint stage bar — lead-phase only (stages 1–12, up to Documents
          Received). When the lead reaches docs_received the bar swaps in a
          big "Convert to Client" CTA. The remaining stages (Operations →
          Portal Welcome → Active Client) render on the investor page. */}
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

      {/* Onboarding actions — pinned scroll target for the blueprint's
          "Send risk profile / Send doc checklist / Capture approval"
          buttons (they dispatch a custom event that scrolls here). */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="onboarding">
        <div data-onboarding-actions>
          <OnboardingActions
            leadId={l.id}
            leadStage={l.stage}
            leadPhone={l.phone}
            leadEmail={l.email}
            leadName={l.name}
            hasRiskProfile={!!data.latestRisk}
            pendingProposalId={data.latestProposal?.id ?? null}
            alreadyConvertedInvestorId={l.convertedInvestorId ?? null}
          />
        </div>
      </RelatedListSection>

      {/* Behavioural engagement signals (Zoho scoring parity) */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="signals">
      <SignalScoreCard session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }} leadId={l.id} />
      </RelatedListSection>

      {/* Editable record — every spec field, inline edit */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="edit_panel">
        <LeadEditPanel lead={JSON.parse(JSON.stringify(l))} />
      </RelatedListSection>

      {/* MFD-defined custom fields (renders only if the firm has defined any).
          Wrapped as a section so it belongs to Details like the rest of the
          record — unwrapped, it sat outside the tab system and repeated itself
          under Overview and Activity too. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="custom_fields">
        <CustomFieldsCard entity="lead" recordId={l.id} initialValues={(l as any).customFields ?? null} />
      </RelatedListSection>

      {/* Activity timeline */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="activity">
        <div className="card-surface overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground" aria-hidden>
              <ClipboardList className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground">Activity timeline</h3>
              <p className="text-2xs text-muted-foreground">Calls, messages, tasks and notes, newest first</p>
            </div>
            <span className="chip bg-secondary text-muted-foreground tabular-nums">
              {data.relatedTasks.length + data.relatedComms.length}
            </span>
          </div>
          <ActivityTimeline tasks={data.relatedTasks} comms={data.relatedComms} notes={l.followUpNotes ?? ""} />
        </div>
      </RelatedListSection>

      <RelatedListSection moduleKey="leads-detail" sectionKey="whatsapp">
        <WhatsAppRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityPhone={l.phone} />
      </RelatedListSection>

      <RelatedListSection moduleKey="leads-detail" sectionKey="emails">
        <EmailRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityEmail={l.email} />
      </RelatedListSection>

      </RelatedListsContainer>

    </div>
  );
}

function ActivityTimeline({
  tasks: relatedTasks,
  comms,
  notes,
}: {
  tasks: any[];
  comms: any[];
  notes: string;
}) {
  // Merge tasks + comms + notes into a single timeline, newest first
  type Item = { at: Date; kind: "task" | "comm" | "note"; title: string; meta: string; sub?: string };
  const items: Item[] = [];

  for (const t of relatedTasks) {
    items.push({
      at: new Date(t.createdAt),
      kind: "task",
      title: t.title,
      meta: `${t.type} · ${t.priority} · ${t.status}`,
      sub: t.dueAt ? `Due ${formatDate(t.dueAt)}` : undefined,
    });
  }
  for (const c of comms) {
    items.push({
      at: new Date(c.createdAt),
      kind: "comm",
      title: `${c.direction === "outbound" ? "Sent" : "Received"} ${c.channel}`,
      meta: c.templateKey ?? c.status,
      sub: String(
        (() => {
          const r = (c.payload as any)?.rendered;
          // `rendered` is now an object { subject, text, tokens } (older rows may
          // have stored a plain string) — extract the text either way.
          return (typeof r === "string" ? r : r?.text) ?? (c.inboundContent as any)?.text ?? "";
        })()
      ).slice(0, 120),
    });
  }
  // Notes are a single text blob with [timestamp · type · author] headers — split it
  if (notes) {
    const blocks = notes.split(/\n\n---\n\n/);
    for (const b of blocks) {
      const m = b.match(/^\[(.+?)\]\n([\s\S]*)$/);
      if (m) {
        const header = m[1]; // "2026-05-24 10:30 · call · Pooja Shah"
        const body = m[2];
        const tsMatch = header.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
        const at = tsMatch ? new Date(tsMatch[1].replace(" ", "T") + ":00Z") : new Date();
        items.push({
          at,
          kind: "note",
          title: header,
          meta: "",
          sub: body,
        });
      }
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());

  if (items.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        No activity yet. Use the buttons above to log a call, schedule a meeting, or add a task.
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((i, idx) => {
        const Icon = i.kind === "task" ? ListChecks : i.kind === "comm" ? MessageCircle : ClipboardList;
        const tone =
          i.kind === "task" ? "text-amber-600" : i.kind === "comm" ? "text-blue-600" : "text-emerald-600";
        return (
          <li key={idx} className="px-4 py-3 flex items-start gap-3">
            <Icon className={`size-4 mt-0.5 ${tone}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{i.title}</div>
              {i.meta && <div className="text-xs text-muted-foreground mt-0.5">{i.meta}</div>}
              {i.sub && <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{i.sub}</div>}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{formatRelative(i.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="font-semibold mb-3">{title}</h2>
      <dl className="text-sm space-y-0">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 py-1.5 border-b last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
