import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { CalendarPlus, FileDown, FileText, Sparkles, Target, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { buttonClass } from "@/components/ui/button-class";
import { MENU_ICON, MENU_ITEM } from "@/components/ui/menu-item-class";
import { InlineEmpty } from "@/components/common/EmptyState";
import { RecordMenu, RecordMenuSeparator } from "@/components/common/RecordMenu";
import { RecordTimeline } from "@/components/common/RecordTimeline";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { RowActions } from "@/components/common/RowActions";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { RelatedListSection, RelatedListsContainer } from "@/components/common/RelatedLists";
import { InvestorDetailTabs } from "@/components/investors/InvestorDetailTabs";
import { LogActivityButton } from "@/components/activities/ActivityLogger";
import { InfoTip } from "@/components/dashboards/my/Shared";
import { AddMemberDialog } from "@/components/families/AddMemberDialog";
import { AddFamilyTaskButton } from "@/components/families/AddFamilyTaskButton";
import { RemoveMemberButton } from "@/components/families/RemoveMemberButton";
import { MemberRoleSelect } from "@/components/families/MemberRoleSelect";
import { FamilyEditPanel } from "@/components/families/FamilyEditPanel";
import { DuplicateGroup } from "@/components/investors/DuplicateMerge";
import { loadFamilyMemberDuplicates } from "@/lib/families/member-duplicates";
import { FamilyHealthCard } from "@/components/families/FamilyHealthCard";
import { FamilyPortfolioAllocation } from "@/components/families/FamilyPortfolioAllocation";
import { FamilyTouchpoints } from "@/components/families/FamilyTouchpoints";
import { EngageNextGenButton } from "@/components/families/EngageNextGenButton";
import { FamilyTreeVisualizer } from "@/components/families/FamilyTreeVisualizer";
import { canEditFamilies } from "@/lib/families/access";
import { goalProjection, loadFamilyDetail } from "@/lib/families/detail";
import { familyReviewState, hasNominee, isLiveMember } from "@/lib/families/health";
import { familyReviewFrequencyLabel } from "@/lib/families/cadence";
import { roleLabel } from "@/lib/families/roles";
import { aliveClient } from "@/lib/metrics/scope";
import { sipMonthlySql } from "@/lib/metrics/sip";
import { fromActivities, fromMeetings, fromTasks, mergeTimeline } from "@/lib/timeline";

/**
 * One family (household) — rebuilt 2026-10-01 from the family-mapping audit.
 *
 * What it fixes:
 *  · Visibility: the page checked nothing; it now goes through
 *    lib/families/access (loadFamilyDetail), the same rule as the list.
 *  · One set of numbers: combined AUM / SIP count LIVE members (not closed,
 *    exited, deleted or merged away) — the same as the Families list.
 *  · The head is the recorded head, never "the first member" as a stand-in.
 *  · One gaps list (Family health) instead of four status tiles, a
 *    succession card and a "why this score" all saying the same things.
 *  · "Schedule family review" now actually opens with this family picked.
 *
 * What it adds: the family's meetings, tasks and activity in one timeline;
 * every member's SIPs; proposals for the family; a relationship you can change
 * in place (choosing "Self / Head" makes that member the head); adding several
 * members at once; and the family code / category.
 *
 * Layout follows the client page: header + KPI row, then tabs (Overview ·
 * Portfolio · Goals & next generation · Activity · Details).
 */
export const dynamic = "force-dynamic";

const MODULE = "families-detail";

const PROPOSAL_TONE: Record<string, BadgeTone> = {
  accepted: "success",
  executed: "success",
  partially_approved: "success",
  rejected: "danger",
  expired: "neutral",
};

export default async function FamilyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const detail = await loadFamilyDetail(tx, session, id);
    if (!detail) return null;
    const memberIds = detail.members.map((m) => m.id);
    const idList = memberIds.length ? sql.join(memberIds.map((m) => sql`${m}::uuid`), sql`, `) : sql`NULL::uuid`;

    const [rmOpts, meetings, taskRows, activityRows, proposals, sips] = await Promise.all([
      // Who can be the family's RM: the people who carry clients, plus whoever
      // holds the family now (so a departed RM still shows as the current value).
      tx.execute(sql`
        SELECT id, name FROM users
         WHERE tenant_id = ${session.tenantId}::uuid
           AND ((status = 'active' AND roles && ARRAY['rm','owner','branch_head','team_member']::text[])
                OR id = ${detail.family.rmId ?? null}::uuid)
         ORDER BY name
      `),
      // Family reviews, and every member's own meetings.
      tx.execute(sql`
        SELECT rm.id, rm.meeting_type AS "meetingType", rm.meeting_date AS "meetingDate", rm.meeting_mode AS "meetingMode",
               rm.duration_minutes AS "durationMinutes", rm.status, rm.discussion_points AS "discussionPoints",
               rm.outcome_notes AS "outcomeNotes", rm.family_id AS "familyId", i.name AS member_name
          FROM review_meetings rm
          LEFT JOIN investors i ON i.id = rm.investor_id
         WHERE rm.tenant_id = ${session.tenantId}::uuid
           AND (rm.family_id = ${id}::uuid OR rm.investor_id IN (${idList}))
         ORDER BY rm.meeting_date DESC
         LIMIT 60
      `),
      // Tasks about the family, or about any member (both task links).
      tx.execute(sql`
        SELECT t.id, t.title, t.description, t.type, t.priority, t.status, t.due_at AS "dueAt", t.created_at AS "createdAt",
               i.name AS member_name
          FROM tasks t
          LEFT JOIN investors i ON i.id = COALESCE(t.related_investor_id, CASE WHEN t.subject_type = 'investor' THEN t.subject_id END)
         WHERE t.tenant_id = ${session.tenantId}::uuid AND t.deleted_at IS NULL
           AND ((t.subject_type = 'family' AND t.subject_id = ${id}::uuid)
                OR t.related_investor_id IN (${idList})
                OR (t.subject_type = 'investor' AND t.subject_id IN (${idList})))
         ORDER BY t.created_at DESC
         LIMIT 80
      `),
      // Calls, visits and notes on the family or any member.
      tx.execute(sql`
        SELECT a.id, a.kind, a.direction, a.status, a.subject, a.notes, a.occurred_at, a.duration_sec,
               a.location_label, a.next_followup_at, u.name AS owner_name,
               CASE WHEN a.subject_type = 'investor' THEN i.name END AS member_name
          FROM activities a
          LEFT JOIN users u ON u.id = a.owner_user_id
          LEFT JOIN investors i ON a.subject_type = 'investor' AND i.id = a.subject_id
         WHERE a.tenant_id = ${session.tenantId}::uuid
           AND ((a.subject_type = 'family' AND a.subject_id = ${id}::uuid)
                OR (a.subject_type = 'investor' AND a.subject_id IN (${idList})))
         ORDER BY a.occurred_at DESC
         LIMIT 80
      `),
      tx.execute(sql`
        SELECT p.id, p.title, p.proposal_number, p.status, p.created_at, p.sent_at, p.family_id,
               i.name AS member_name
          FROM proposals p
          LEFT JOIN investors i ON i.id = p.investor_id
         WHERE p.tenant_id = ${session.tenantId}::uuid
           AND (p.family_id = ${id}::uuid OR p.investor_id IN (${idList}))
         ORDER BY p.created_at DESC
         LIMIT 20
      `),
      // Every live member's active SIPs, monthly-equivalent like the SIP book.
      tx.execute(sql`
        SELECT s.id, s.scheme_name, s.amc_name, s.amount, s.frequency, s.next_installment_at, s.end_date,
               ${sipMonthlySql("s")} AS monthly, i.id AS investor_id, i.name AS member_name
          FROM sips s
          JOIN investors i ON i.id = s.investor_id
         WHERE s.tenant_id = ${session.tenantId}::uuid AND s.status = 'active'
           AND i.family_id = ${id}::uuid AND ${aliveClient("i")}
         ORDER BY i.name, monthly DESC
         LIMIT 200
      `),
    ]);

    // The same person listed twice among the members (one with a PAN, one a registrar's spelling without).
    const repeated = await loadFamilyMemberDuplicates(tx, session.tenantId, detail.members as any[]);

    return {
      ...detail,
      repeated,
      rmOpts: rmOpts.rows as Array<{ id: string; name: string }>,
      meetings: meetings.rows as any[],
      taskRows: taskRows.rows as any[],
      activityRows: activityRows.rows as any[],
      proposals: proposals.rows as any[],
      sips: sips.rows as any[],
    };
  });
  if (!data) notFound();

  const { family, members, liveMembers, head, totals } = data;
  const familyName = family.familyName ?? family.headName;
  const canEdit = canEditFamilies(session);
  // Merging clients is the owner's tool (Merge Clients).
  const canMerge = can(session.roles, "dashboard.view.owner", session.permissions);
  const canDelete = can(session.roles, "family.delete", session.permissions) || can(session.roles, "investor.edit.all", session.permissions);
  const review = familyReviewState(family as any);
  const closedCount = members.length - liveMembers.length;

  // One timeline: the family's and its members' activity, tasks and meetings.
  // A member's own item says whose it is.
  const byId = new Map<string, string>();
  for (const a of data.activityRows) if (a.member_name) byId.set(`act-${a.id}`, a.member_name);
  for (const t of data.taskRows) if (t.member_name) byId.set(`task-${t.id}`, t.member_name);
  for (const m of data.meetings) if (m.member_name && !m.familyId) byId.set(`meeting-${m.id}`, m.member_name);
  const timeline = mergeTimeline(
    fromActivities(data.activityRows),
    fromTasks(data.taskRows, { href: (t) => `/dashboard/tasks?focus=${t.id}` }),
    fromMeetings(data.meetings),
  ).map((it) => {
    const who = byId.get(it.id);
    return who ? { ...it, meta: [who, it.meta].filter(Boolean).join(" · ") } : it;
  });
  const openTasks = data.taskRows.filter((t) => !["completed", "cancelled"].includes(String(t.status))).length;
  const upcomingMeetings = data.meetings.filter((m) => m.status === "scheduled" && new Date(m.meetingDate).getTime() >= Date.now()).length;

  const sipTotal = data.sips.reduce((s, r) => s + Number(r.monthly ?? 0), 0);
  const goalsWithProjection = data.goals.map((g: any) => ({ g, p: goalProjection(g) }));

  const meta = [
    family.familyCode ? `Code ${family.familyCode}` : null,
    data.rm ? `RM ${data.rm.name}` : "No RM assigned",
    head ? `Head ${head.name}` : "No head of family set",
  ].filter(Boolean);

  const tabs = [
    { key: "overview", label: "Overview", sections: ["members", "health"], count: liveMembers.length },
    { key: "portfolio", label: "Portfolio", sections: ["allocation", "sips", "wealth-map"], count: data.sips.length },
    { key: "goals", label: "Goals & next generation", sections: ["goals", "next-gen", "touchpoints"], count: data.goals.length },
    { key: "activity", label: "Activity", sections: ["timeline", "proposals"], count: timeline.length },
    { key: "details", label: "Details", sections: ["details"] },
  ];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeaderCard
        breadcrumb={[{ label: "Families", href: "/dashboard/families" }, { label: familyName }]}
        title={<>{familyName}</>}
        subtitle={<>{meta.join(" · ")}</>}
        actions={
          <>
            {head ? (
              <Link
                href={`/dashboard/review-meetings/new?familyId=${id}`}
                className={buttonClass("primary")}
              >
                <CalendarPlus className="size-4" /> Schedule family review
              </Link>
            ) : (
              <a href="#family-members" className={buttonClass("primary")} title="A family review is held with the head of family — set one first">
                <Users className="size-4" /> Set the head of family
              </a>
            )}
            <LogActivityButton subject={{ type: "family", id, name: familyName }} label="Log call / visit" variant="secondary" />
            <RecordMenu>
              <Link href={`/dashboard/proposals/new?familyId=${id}`} className={MENU_ITEM}>
                <FileText className={MENU_ICON} /> New proposal for the family
              </Link>
              <DownloadButton url={`/api/families/${id}/statement/pdf?download=1`} className={MENU_ITEM}>
                <FileDown className={MENU_ICON} /> Household statement (PDF)
              </DownloadButton>
              {canEdit && (
                <AddFamilyTaskButton
                  familyId={id}
                  familyName={familyName}
                  members={liveMembers.map((m) => ({ id: m.id, name: m.name }))}
                  triggerClassName={MENU_ITEM}
                />
              )}
              <ChangeLogButton entityType="family" entityId={id} triggerClassName={MENU_ITEM} />
              {canDelete && (
                <>
                  <RecordMenuSeparator />
                  <RowActions
                    menuItem
                    deleteUrl={`/api/families/${id}`}
                    itemLabel="family"
                    itemName={familyName}
                    verb="Delete"
                    redirectTo="/dashboard/families"
                  />
                </>
              )}
            </RecordMenu>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {family.familyCategory && <Badge raw>{family.familyCategory}</Badge>}
          {review === "overdue" && <Badge raw tone="danger">Review overdue</Badge>}
          {review === "never" && <Badge raw>Never reviewed</Badge>}
        </div>
      </PageHeaderCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Combined AUM" value={formatINR(totals.totalAum)} />
        <Kpi label="SIP / month" value={totals.totalSip > 0 ? formatINR(totals.totalSip) : "—"} />
        <Kpi
          label="Members"
          value={String(totals.memberCount)}
          sub={closedCount > 0 ? `+ ${closedCount} closed, not counted` : undefined}
        />
        <Kpi
          label="Next review"
          value={family.nextReviewAt ? formatDate(family.nextReviewAt) : "Not scheduled"}
          sub={[
            familyReviewFrequencyLabel(family.reviewFrequency),
            family.lastReviewAt ? `last ${formatRelative(family.lastReviewAt)}` : "never reviewed",
          ]
            .filter(Boolean)
            .join(" · ")}
          danger={review === "overdue"}
        />
      </div>

      <InvestorDetailTabs moduleKey={MODULE} label="Family sections" tabs={tabs} />

      <RelatedListsContainer>
        {/* ── Overview ── */}
        <RelatedListSection moduleKey={MODULE} sectionKey="members">
          <Card>
            <div id="family-members" className="scroll-mt-24" />
            <CardHeader
              title={`Members (${members.length})`}
              action={canEdit ? <AddMemberDialog familyId={id} familyName={familyName} /> : undefined}
            />
            {canMerge && data.repeated.length > 0 && (
              <div className="mx-5 mb-4 space-y-3 rounded-lg border border-warning/50 bg-warning/5 p-4">
                <div className="text-sm font-medium">
                  {data.repeated.length === 1 ? "One person is listed twice in this family" : `${data.repeated.length} people are listed twice in this family`}
                </div>
                {data.repeated.map((c) => (
                  <DuplicateGroup key={`${c.kind}-${c.gkey}`} kind={c.kind} gkey={c.gkey} members={c.members} />
                ))}
              </div>
            )}
            {members.length === 0 ? (
              <InlineEmpty
                icon={Users}
                message="No members yet. Add the head of the family first, then the rest of the household."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 text-left font-medium">Member</th>
                      <th className="py-2 text-left font-medium">Relationship</th>
                      <th className="py-2 text-left font-medium">PAN</th>
                      <th className="py-2 text-right font-medium">AUM</th>
                      <th className="py-2 text-right font-medium">SIP / month</th>
                      <th className="py-2 pl-4 text-left font-medium">Gaps</th>
                      {canEdit && <th className="relative px-4 py-2"><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const live = isLiveMember(m as any);
                      const isHead = m.id === family.primaryInvestorId;
                      const kycGap = m.kycStatus !== "verified";
                      const nomineeGap = !hasNominee(m as any);
                      return (
                        <tr key={m.id} className={`border-b last:border-0 ${live ? "" : "text-muted-foreground"}`}>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar src={(m as any).avatarUrl ? `/api/investors/${m.id}/avatar` : null} name={m.name} size={28} />
                              <div className="min-w-0">
                                <Link href={`/dashboard/investors/${m.id}`} className="font-medium hover:underline">
                                  {m.name}
                                </Link>
                                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                  {isHead && <Badge raw tone="info">Head</Badge>}
                                  {m.isMinor && <Badge raw>Minor</Badge>}
                                  {!live && <Badge raw>{m.status === "exited" ? "Exited" : "Closed"}</Badge>}
                                  {m.segmentTag && <span>{m.segmentTag}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 text-xs">
                            <MemberRoleSelect
                              familyId={id}
                              investorId={m.id}
                              investorName={m.name}
                              role={m.familyRole}
                              isHead={isHead}
                              canEdit={canEdit}
                            />
                          </td>
                          <td className="py-2.5 font-mono text-xs text-muted-foreground">{m.pan ?? "—"}</td>
                          <td className="py-2.5 text-right tabular-nums">{formatINR(Number(m.aum ?? 0))}</td>
                          <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                            {Number(m.activeSipAmount ?? 0) > 0 ? formatINR(Number(m.activeSipAmount)) : "—"}
                          </td>
                          <td className="py-2.5 pl-4">
                            {live && (kycGap || nomineeGap) ? (
                              <div className="flex flex-wrap gap-1">
                                {kycGap && <Badge raw tone="danger">KYC</Badge>}
                                {nomineeGap && <Badge raw tone="danger">Nominee</Badge>}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          {canEdit && (
                            <td className="px-4 py-2.5 text-right">
                              <RemoveMemberButton familyId={id} investorId={m.id} investorName={m.name} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </RelatedListSection>

        <RelatedListSection moduleKey={MODULE} sectionKey="health">
          <FamilyHealthCard family={family as any} members={members as any} familyId={id} />
        </RelatedListSection>

        {/* ── Portfolio ── */}
        <RelatedListSection moduleKey={MODULE} sectionKey="allocation">
          <FamilyPortfolioAllocation session={session} memberIds={liveMembers.map((m) => m.id)} />
        </RelatedListSection>

        <RelatedListSection moduleKey={MODULE} sectionKey="sips">
          <Card>
            <CardHeader
              title={`Active SIPs (${data.sips.length})`}
              subtitle={data.sips.length ? `${formatINR(sipTotal)} a month across the family` : undefined}
              action={
                data.sips.length ? (
                  <Link href={`/dashboard/sips?status=active&fam=${id}`} className="text-xs font-medium text-primary hover:underline">
                    Open in SIPs
                  </Link>
                ) : undefined
              }
            />
            {data.sips.length === 0 ? (
              <InlineEmpty message="No member has an active SIP." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 text-left font-medium">Member</th>
                      <th className="py-2 text-left font-medium">Scheme</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                      <th className="py-2 pl-4 text-left font-medium">Next instalment</th>
                      <th className="px-5 py-2 text-left font-medium">Ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sips.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="px-5 py-2.5">
                          <Link href={`/dashboard/investors/${s.investor_id}`} className="hover:underline">{s.member_name}</Link>
                        </td>
                        <td className="max-w-xs py-2.5">
                          <div className="truncate">{s.scheme_name ?? "—"}</div>
                          {s.amc_name && <div className="truncate text-xs text-muted-foreground">{s.amc_name}</div>}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {formatINR(Number(s.amount ?? 0))}
                          {s.frequency && s.frequency !== "monthly" && (
                            <span className="ml-1 text-xs text-muted-foreground">{String(s.frequency).replace(/_/g, "-")}</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-4 text-xs text-muted-foreground">{s.next_installment_at ? formatDate(s.next_installment_at) : "—"}</td>
                        <td className="px-5 py-2.5 text-xs text-muted-foreground">{s.end_date ? formatDate(s.end_date) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </RelatedListSection>

        <RelatedListSection moduleKey={MODULE} sectionKey="wealth-map">
          <FamilyTreeVisualizer members={members as any} primaryInvestorId={family.primaryInvestorId} />
        </RelatedListSection>

        {/* ── Goals & next generation ── */}
        <RelatedListSection moduleKey={MODULE} sectionKey="goals">
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-1">
                  Family goals ({data.goals.length})
                  <InfoTip>
                    Open goals across every member. The shortfall projects today&apos;s value and the monthly
                    contribution to the target date at each goal&apos;s own expected return (10% a year when none is
                    set); the step-up is the extra monthly amount that closes it.
                  </InfoTip>
                </span>
              }
            />
            {data.goals.length === 0 ? (
              <InlineEmpty icon={Target} message="No open goals across the family's members." />
            ) : (
              <CardBody>
                <ul className="space-y-4">
                  {goalsWithProjection.map(({ g, p }) => {
                    const pct = Math.max(0, Math.min(100, Number(g.progress_pct ?? 0)));
                    return (
                      <li key={g.id} className="border-b pb-3 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <div>
                            <span className="font-medium">{g.name}</span>{" "}
                            <Link href={`/dashboard/investors/${g.member_id}`} className="text-xs text-muted-foreground hover:underline">
                              · {g.member_name}
                            </Link>
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatINR(Number(g.current_value ?? 0))} of {formatINR(Number(g.target_amount ?? 0))}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {pct.toFixed(0)}% · by {g.target_date ? formatDate(g.target_date) : "—"}
                            {g.category ? ` · ${String(g.category).replace(/_/g, " ")}` : ""}
                          </span>
                          {Number(g.monthly_contribution ?? 0) > 0 && (
                            <span className="tabular-nums">{formatINR(Number(g.monthly_contribution))} a month</span>
                          )}
                        </div>
                        {p.shortfall > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Badge raw tone="danger">Short by {formatINR(p.shortfall)}</Badge>
                            {p.stepUp > 0 && <Badge raw>Step up {formatINR(p.stepUp)} a month</Badge>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            )}
          </Card>
        </RelatedListSection>

        <RelatedListSection moduleKey={MODULE} sectionKey="next-gen">
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-1">
                  Next generation ({data.nextGen.length})
                  <InfoTip>
                    Members who are minors or 18–30 and do not invest yet. Onboarding heirs with their own SIPs is the
                    best predictor of keeping a family when wealth changes hands.
                  </InfoTip>
                </span>
              }
              action={
                <Link href="/dashboard/families/at-risk" className="text-xs font-medium text-primary hover:underline">
                  Next generation view
                </Link>
              }
            />
            {data.nextGen.length === 0 ? (
              <InlineEmpty icon={Sparkles} message="No one to onboard — every younger member already invests, or none is recorded." />
            ) : (
              <ul className="divide-y px-5 pb-3">
                {data.nextGen.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/dashboard/investors/${m.id}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {m.familyRole ? roleLabel(m.familyRole) : "Relationship not set"} ·{" "}
                        {m.dob ? `born ${formatDate(m.dob)}` : "date of birth not recorded"}
                        {m.isMinor ? " · minor" : ""}
                      </div>
                    </div>
                    <EngageNextGenButton investorId={m.id} investorName={m.name} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </RelatedListSection>

        <RelatedListSection moduleKey={MODULE} sectionKey="touchpoints">
          <FamilyTouchpoints members={liveMembers as any} />
        </RelatedListSection>

        {/* ── Activity ── */}
        <RelatedListSection moduleKey={MODULE} sectionKey="timeline">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{openTasks} open task{openTasks === 1 ? "" : "s"}</span>
              <span aria-hidden>·</span>
              <span>{upcomingMeetings} upcoming meeting{upcomingMeetings === 1 ? "" : "s"}</span>
              {canEdit && (
                <span className="ml-auto">
                  <AddFamilyTaskButton
                    familyId={id}
                    familyName={familyName}
                    members={liveMembers.map((m) => ({ id: m.id, name: m.name }))}
                  />
                </span>
              )}
            </div>
            <RecordTimeline
              items={timeline}
              title="Family activity"
              emptyMessage="Nothing logged for this family or its members yet. Log a call, add a task or schedule a review and it shows up here."
            />
          </div>
        </RelatedListSection>

        <RelatedListSection moduleKey={MODULE} sectionKey="proposals">
          <Card>
            <CardHeader
              title={`Proposals (${data.proposals.length})`}
              action={
                <Link href={`/dashboard/proposals/new?familyId=${id}`} className="text-xs font-medium text-primary hover:underline">
                  New proposal
                </Link>
              }
            />
            {data.proposals.length === 0 ? (
              <InlineEmpty icon={FileText} message="No proposals for this family or its members yet." />
            ) : (
              <ul className="divide-y px-5 pb-3">
                {data.proposals.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/dashboard/proposals/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {p.proposal_number} · {p.family_id ? "whole family" : p.member_name ?? "member"} ·{" "}
                        {formatDate(p.sent_at ?? p.created_at)}
                      </div>
                    </div>
                    <Badge raw tone={PROPOSAL_TONE[String(p.status)] ?? "neutral"}>
                      {String(p.status).replace(/_/g, " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </RelatedListSection>

        {/* ── Details ── */}
        <RelatedListSection moduleKey={MODULE} sectionKey="details">
          <Card>
            <div id="family-details" className="scroll-mt-24" />
            <CardHeader title="Family details" />
            <CardBody>
              {canEdit && (
                <div className="mb-4">
                  <FamilyEditPanel
                    family={JSON.parse(JSON.stringify(family))}
                    members={liveMembers.map((m) => ({ id: m.id, name: m.name, pan: m.pan ?? "" }))}
                    rms={data.rmOpts}
                  />
                </div>
              )}
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Detail label="Family name" value={familyName} />
                <Detail label="Head of family" value={head?.name ?? "Not set"} />
                <Detail label="Family code" value={family.familyCode ?? "—"} />
                <Detail label="Category" value={family.familyCategory ?? "—"} />
                <Detail label="Family RM" value={data.rm?.name ?? "Not assigned"} />
                <Detail label="Review frequency" value={familyReviewFrequencyLabel(family.reviewFrequency) || "None"} />
                <Detail label="First meeting" value={family.firstMeetingDate ? formatDate(family.firstMeetingDate) : "—"} />
                <Detail label="Last review" value={family.lastReviewAt ? formatDate(family.lastReviewAt) : "Never"} />
              </dl>
              <div className="mt-4">
                <div className="text-xs text-muted-foreground">Notes</div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{family.notes || "—"}</p>
              </div>
              <RecordProvenance
                entityType="family"
                entityId={family.id}
                createdAt={family.createdAt}
                updatedAt={family.updatedAt}
                className="mt-4"
              />
            </CardBody>
          </Card>
        </RelatedListSection>
      </RelatedListsContainer>
    </div>
  );
}

function Kpi({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${danger ? "text-destructive" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
