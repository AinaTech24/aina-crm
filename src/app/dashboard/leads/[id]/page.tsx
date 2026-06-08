import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  ChevronLeft,
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
import { leads, users, tasks, communications, riskProfileResponses, proposals } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";
import { LeadActions } from "@/components/leads/LeadActions";
import { EmailRelatedList } from "@/components/comms/EmailRelatedList";
import { WhatsAppRelatedList } from "@/components/comms/WhatsAppRelatedList";
import { SectionNav } from "@/components/common/SectionNav";
import { CheckInButton, LogActivityButton } from "@/components/activities/ActivityLogger";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { RecordAutomations } from "@/components/sales-ops/RecordAutomations";
import { SignalScoreCard } from "@/components/leads/SignalScoreCard";
import { LeadEditPanel } from "@/components/leads/LeadEditPanel";
import { LeadScoreButton } from "@/components/leads/LeadScoreButton";
import { stageBadgeClass, stageLabel } from "@/lib/leads/stages";
import { bandBadgeClass, bandLabel } from "@/lib/leads/score";
import { OnboardingActions } from "@/components/leads/OnboardingActions";
import { BlueprintStageBar } from "@/components/leads/BlueprintStageBar";
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
  { key: "blueprint", label: "Blueprint stage tracker" },
  { key: "onboarding", label: "Onboarding actions (risk profile / docs / approval)" },
  { key: "converted_banner", label: "Converted-to-client banner" },
  { key: "edit_panel", label: "Editable details" },
  { key: "emails", label: "Emails" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "activity", label: "Activity timeline" },
];

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const lead = (await tx.select().from(leads).where(eq(leads.id, id)).limit(1))[0];
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
        .where(and(eq(tasks.subjectType, "lead"), eq(tasks.subjectId, id)))
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

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/leads"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to leads
        </Link>
        <RelatedListsManager moduleKey="leads-detail" sections={LEAD_DETAIL_SECTIONS} />
      </div>

      <SectionNav moduleKey="leads-detail" sections={LEAD_DETAIL_SECTIONS} />

      <RelatedListsContainer>
      <RelatedListSection moduleKey="leads-detail" sectionKey="header">
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{l.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${stageBadgeClass(l.stage)}`}>
                {stageLabel(l.stage)}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${bandBadgeClass((l.scoreBand as any) ?? "cold")}`}
                title="Deterministic lead score (0–100)"
              >
                <Flame className="size-3" /> {bandLabel((l.scoreBand as any) ?? "cold")} · {l.leadScore ?? 0}
              </span>
              <span className="text-muted-foreground">via {l.source}</span>
              {data.owner && <span className="text-muted-foreground">· owned by {data.owner.name}</span>}
            </div>
            <div className="flex gap-3 mt-3 text-sm">
              {l.phone && (
                <a href={`tel:${l.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Phone className="size-4" /> {l.phone}
                </a>
              )}
              {l.email && (
                <a href={`mailto:${l.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Mail className="size-4" /> {l.email}
                </a>
              )}
              {l.phone && (
                <a
                  href={`https://wa.me/${l.phone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <CheckInButton subject={{ type: "lead", id: l.id, name: l.name, phone: l.phone }} />
              <LogActivityButton subject={{ type: "lead", id: l.id, name: l.name, phone: l.phone }} label="Log call / visit" variant="secondary" />
              <ChangeLogButton entityType="lead" entityId={l.id} />
              <RecordAutomations subject={{ type: "lead", id: l.id }} />
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            Created {formatRelative(l.createdAt)}
            <br />
            Last contact {l.lastContactAt ? formatRelative(l.lastContactAt) : "—"}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 pt-4 border-t space-y-3" data-lead-actions>
          <LeadActions
            leadId={l.id}
            leadName={l.name}
            leadEmail={l.email}
            leadPhone={l.phone}
            currentStage={l.stage}
            alreadyConvertedInvestorId={l.convertedInvestorId ?? null}
          />
          <LeadScoreButton
            name={l.name}
            source={l.source}
            stage={l.stage}
            ageInStageDays={
              l.createdAt
                ? Math.max(0, Math.floor((Date.now() - new Date(l.createdAt as any).getTime()) / 86_400_000))
                : null
            }
            lastTouchDaysAgo={
              l.lastContactAt
                ? Math.max(0, Math.floor((Date.now() - new Date(l.lastContactAt as any).getTime()) / 86_400_000))
                : null
            }
          />
        </div>
      </div>
      </RelatedListSection>

      {/* Behavioural engagement signals (Zoho scoring parity) */}
      <SignalScoreCard session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }} leadId={l.id} />

      {/* Blueprint stage bar — lead-phase only (stages 1–12, up to Documents
          Received). When the lead reaches docs_received the bar swaps in a
          big "Convert to Client" CTA. The remaining stages (Operations →
          Portal Welcome → Active Client) render on the investor page. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="blueprint">
        <BlueprintStageBar
          leadId={l.id}
          phase="lead"
          convertedInvestorId={l.convertedInvestorId ?? null}
        />
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

      {/* Editable record — every spec field, inline edit */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="edit_panel">
        <LeadEditPanel lead={JSON.parse(JSON.stringify(l))} />
      </RelatedListSection>

      <RelatedListSection moduleKey="leads-detail" sectionKey="whatsapp">
        <WhatsAppRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityPhone={l.phone} />
      </RelatedListSection>

      <RelatedListSection moduleKey="leads-detail" sectionKey="emails">
        <EmailRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityEmail={l.email} />
      </RelatedListSection>

      {/* Activity timeline */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="activity">
        <div className="border rounded-lg bg-card">
          <div className="border-b px-4 py-2.5 font-medium flex items-center gap-2">
            <ClipboardList className="size-4" /> Activity timeline
          </div>
          <ActivityTimeline tasks={data.relatedTasks} comms={data.relatedComms} notes={l.followUpNotes ?? ""} />
        </div>
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
