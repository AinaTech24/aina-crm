/**
 * Task page — the live CRM's task page for the phone (web TaskDetailDrawer).
 *
 * Title + status / priority (tap to change), snooze, the approval loop
 * (completing a task that needs approval sends it for approval), "Need
 * information" (ask — the task waits, blocked — and answer), the request a
 * financial task carries, "How we do this" (the firm's SOPs), sub-tasks,
 * related records (link / unlink through /related), and comments
 * (/comments — the old remarks column is read-only "Earlier notes"; writing
 * it would replace the whole work log). Entry date and closed date as on web.
 */

import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { confirmDelete } from "../../../../src/lib/confirm";
import { toast } from "../../../../src/lib/toast";
import { useMe, hasCap } from "../../../../src/api/me";
import { useTeam } from "../../../../src/features/team/api";
import { useSearch } from "../../../../src/features/search/api";
import {
  useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddTaskComment, useTaskRelated, useInfoRequest,
  TASK_PRIORITY_TONE, TASK_STATUSES, TASK_PRIORITIES, slaInfo, checklistProgress,
  type ChecklistItem, type Task, type TaskLink,
} from "../../../../src/features/tasks/api";
import { titleCase, fmtDate, timeAgo, inr } from "../../../../src/lib/format";
import { taskStatusBadge } from "../../../../src/lib/status";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";
import { asIcon } from "../../../../src/lib/icons";

// The web's four sub-task states; completing one stamps doneAt.
const CHECK_CYCLE: Record<string, ChecklistItem["status"]> = { not_started: "in_progress", in_progress: "completed", completed: "not_started", assigned_to_other: "completed" };
const CHECK_ICON: Record<string, string> = { not_started: "circle", in_progress: "loader", completed: "check-circle", assigned_to_other: "user" };
const LINK_ICON: Record<TaskLink["kind"], string> = { client: "user", lead: "trending-up", meeting: "calendar", request: "life-buoy" };
const LINK_FIELD: Record<TaskLink["kind"], string> = { client: "relatedInvestorId", lead: "relatedLeadId", meeting: "relatedMeetingId", request: "relatedServiceRequestId" };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
/** A web /dashboard link as the app's screen; "#" (not in your book) opens nothing. */
const mobileHref = (href: string) => (href.startsWith("/dashboard/") ? href.replace("/dashboard/", "/m/") : null);
/** SOP markdown as plain reading text (never HTML). */
const plainMarkdown = (md: string) => md.replace(/^#{1,6}\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^\s*[-*]\s+/gm, "• ").trim();

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: task, isLoading, isError, error, refetch } = useTask(id);
  const { data: me } = useMe();
  const team = useTeam();
  const update = useUpdateTask(id!);
  const del = useDeleteTask();
  const comments = useTaskComments(id);
  const addComment = useAddTaskComment(id!);
  const related = useTaskRelated(id);
  const info = useInfoRequest(id!);
  const [statusSheet, setStatusSheet] = useState(false);
  const [prioSheet, setPrioSheet] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");
  const [answer, setAnswer] = useState("");
  const [openSop, setOpenSop] = useState<string | null>(null);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Task" /><LoadingState /></View>;
  if (isError || !task) return <View style={styles.screen}><ScreenHeader title="Task" /><ErrorState message={(error as any)?.message} onRetry={() => refetch()} /></View>;

  const myId = me?.user?.id;
  const canViewAll = hasCap(me?.capabilities, "task.view.all");
  const status = taskStatusBadge(task.status);
  const done = task.status === "completed";
  const closed = done || task.status === "cancelled";
  const sla = slaInfo(task);
  const checklist: ChecklistItem[] = task.meta?.checklist ?? [];
  const cl = checklistProgress(task);
  const earlier = parseRemarks(task.remarks);
  const nameOf = (uid?: string | null) => (uid ? team.data?.rows?.find((u) => u.id === uid)?.name ?? null : null);
  const ir = task.meta?.infoRequest;
  const irOpen = !!ir && !ir.answer;
  const canAnswer = irOpen && (myId === ir!.askedToId || myId === task.createdById || canViewAll);
  const canAsk = !irOpen && !closed && myId === task.assigneeId;
  const pendingApproval = task.approvalStatus === "pending";
  const canApprove = pendingApproval && myId !== task.assigneeId;
  const request = task.meta?.request;

  const patch = (p: any, onDone?: (r: any) => void) => { Haptics.selectionAsync().catch(() => {}); update.mutate(p, { onSuccess: onDone }); };
  /** Completing a task that needs approval sends it for approval instead. */
  const complete = () => patch({ status: "completed" }, (r: Task | null) => {
    if (r && r.status !== "completed" && r.approvalStatus === "pending") toast.success("Sent for approval");
  });
  const setStatus = (s: string) => { setStatusSheet(false); s === "completed" ? complete() : patch({ status: s }); };
  const setPriority = (p: string) => { setPrioSheet(false); patch({ priority: p }); };
  const snooze = (days: number) => {
    const base = task.dueAt ? new Date(task.dueAt) : new Date();
    base.setDate(base.getDate() + days);
    patch({ dueAt: base.toISOString() });
  };
  const saveChecklist = (items: ChecklistItem[]) => update.mutate({ checklist: items } as any);
  const cycleItem = (item: ChecklistItem) => saveChecklist(checklist.map((c) => {
    if (c.id !== item.id) return c;
    const next = CHECK_CYCLE[c.status ?? "not_started"];
    return { ...c, status: next, done: next === "completed", doneAt: next === "completed" ? new Date().toISOString() : null };
  }));
  const removeItem = (item: ChecklistItem) => saveChecklist(checklist.filter((c) => c.id !== item.id));
  const addItem = () => { if (!newItem.trim()) return; saveChecklist([...checklist, { id: newId(), text: newItem.trim(), status: "not_started", done: false }]); setNewItem(""); };
  const postComment = () => { const b = comment.trim(); if (!b) return; addComment.mutate(b.slice(0, 5000), { onSuccess: () => setComment("") }); };
  const sendAnswer = () => { const a = answer.trim(); if (!a) return; info.mutate({ action: "answer", answer: a }, { onSuccess: () => { setAnswer(""); toast.success("Answered — the task is back with its owner"); } }); };
  const onDelete = () => confirmDelete({ title: "Delete task?", message: "It moves to Trash — you can restore it later." }, () => del.mutate(id!, { onSuccess: () => router.back() }));
  const allDone = checklist.length > 0 && checklist.every((c) => c.status === "completed" || c.done);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Task" subtitle={titleCase(task.type) || undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeIn.duration(240)}>
          <Card>
            <Text variant="title">{task.title}</Text>
            <View style={styles.badgeRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${status.label}. Change status`} onPress={() => setStatusSheet(true)}><StatusPill label={status.label} tone={status.tone} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Change priority" onPress={() => setPrioSheet(true)}>{task.priority ? <StatusPill label={titleCase(task.priority)} tone={TASK_PRIORITY_TONE[task.priority] ?? "neutral"} dot={false} /> : <StatusPill label="Set priority" tone="neutral" dot={false} />}</Pressable>
              {sla ? <StatusPill label={sla.label} tone={sla.tone} dot={false} /> : null}
              {pendingApproval ? <StatusPill label="Awaiting approval" tone="warning" dot={false} /> : task.approvalStatus === "rejected" ? <StatusPill label="Approval rejected" tone="danger" dot={false} /> : null}
            </View>
          </Card>

          {/* Need information */}
          {irOpen ? (
            <View style={[styles.banner, { borderColor: palette.warning, backgroundColor: palette.warning + "12" }]}>
              <Text variant="caption" style={{ fontWeight: fontWeight.semibold }}>
                {ir!.askedByName ?? nameOf(ir!.askedById) ?? "Someone"} needs information from {ir!.askedToName ?? nameOf(ir!.askedToId) ?? "you"} · {timeAgo(ir!.askedAt)}
              </Text>
              <Text variant="body">{ir!.question}</Text>
              {canAnswer ? (
                <>
                  <TextField label="" value={answer} onChangeText={setAnswer} placeholder="Your answer…" multiline />
                  <Button label="Send answer" size="sm" loading={info.isPending} onPress={sendAnswer} />
                </>
              ) : null}
            </View>
          ) : null}

          {/* Approval */}
          {canApprove ? (
            <View style={[styles.row2, { marginTop: spacing.lg }]}>
              <View style={{ flex: 1 }}><Button label="Approve" full loading={update.isPending} onPress={() => patch({ approvalAction: "approve" }, () => toast.success("Approved"))} /></View>
              <View style={{ flex: 1 }}><Button label="Reject" variant="secondary" full onPress={() => setRejectOpen(true)} /></View>
            </View>
          ) : null}

          {!closed && !pendingApproval ? (
            <Button label={allDone ? "All points done — mark complete" : task.requiresApproval ? "Submit for approval" : "Mark complete"} icon={<Feather name="check" size={16} color={palette.white} />} onPress={complete} loading={update.isPending} full style={{ marginTop: spacing.lg }} />
          ) : null}

          {!closed ? (
            <View style={styles.snoozeRow}>
              <Text variant="caption" tone="muted" style={{ marginRight: spacing.xs }}>Snooze:</Text>
              <SnoozeBtn label="+1d" onPress={() => snooze(1)} />
              <SnoozeBtn label="+1w" onPress={() => snooze(7)} />
              <SnoozeBtn label="+1m" onPress={() => snooze(30)} />
              {canAsk ? <Pressable onPress={() => setAskOpen(true)} style={[styles.snooze, { marginLeft: "auto" }]}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold }}>Need information</Text></Pressable> : null}
            </View>
          ) : null}

          <View style={[styles.row2, { marginTop: spacing.md }]}>
            <View style={{ flex: 1 }}><Button label="Edit" variant="secondary" full icon={<Feather name="edit-2" size={16} color={palette.ink} />} onPress={() => router.push(`/m/tasks/new?editId=${id}` as any)} /></View>
            <View style={{ flex: 1 }}><Button label="Delete" variant="danger" full loading={del.isPending} icon={<Feather name="trash-2" size={16} color={palette.white} />} onPress={onDelete} /></View>
          </View>

          <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
            <Field label="Type" value={titleCase(task.type)} />
            <Field label="Assigned to" value={task.assignee ?? nameOf(task.assigneeId)} />
            <Field label="Entry date" value={fmtDate(task.entryDate)} />
            <Field label="Due" value={fmtDate(task.dueAt)} />
            <Field label="SLA due" value={fmtDate(task.slaDueAt)} last={!done} />
            {done ? <Field label="Closed date" value={fmtDate(task.completedAt)} last /> : null}
          </Card>

          {request && (request.rows?.length || request.kycMode || task.meta?.boValue) ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">REQUEST</Text>
              {request.kycMode ? <Text variant="body" style={{ marginTop: 4 }}>{request.kycMode === "online" ? "Online KYC" : "Physical KYC"}</Text> : null}
              {(request.rows ?? []).map((r, i) => (
                <Text key={i} variant="caption" style={{ marginTop: 4 }}>
                  • {[r.fromSchemeName ? `${r.fromSchemeName} →` : null, r.schemeName, r.amount ? inr(r.amount) : null, r.allUnits ? "all units" : r.units ? `${r.units} units` : null, r.sipDay ? `SIP day ${r.sipDay}` : null, r.folio ? `folio ${r.folio}` : null].filter(Boolean).join(" ")}
                </Text>
              ))}
              {task.meta?.boValue ? <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>Value {inr(task.meta.boValue)}{task.meta.boChannel ? ` · ${titleCase(task.meta.boChannel)}` : ""}</Text> : null}
              {task.meta?.businessEntryId ? <Text variant="caption" tone="muted">Booked as a Business entry</Text> : null}
            </Card>
          ) : null}

          {task.description ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">DESCRIPTION</Text>
              <Text variant="body" style={{ marginTop: 4 }}>{task.description}</Text>
            </Card>
          ) : null}

          {task.sops?.length ? (
            <Card style={{ marginTop: spacing.lg }}>
              <View style={styles.secHead}><Feather name="book-open" size={14} color={palette.muted} /><Text variant="label" tone="muted" style={{ flex: 1 }}>HOW WE DO THIS</Text></View>
              {task.sops.map((s) => (
                <View key={s.sopId} style={styles.logRow}>
                  <Pressable onPress={() => setOpenSop((v) => (v === s.sopId ? null : s.sopId))} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }} accessibilityRole="button">
                    <Text variant="body" style={{ flex: 1, fontWeight: fontWeight.semibold }}>{s.title}</Text>
                    <Feather name={openSop === s.sopId ? "chevron-up" : "chevron-down"} size={16} color={palette.muted} />
                  </Pressable>
                  {openSop === s.sopId ? <Text variant="caption" style={{ marginTop: spacing.xs, lineHeight: 19 }}>{plainMarkdown(s.markdown)}</Text> : null}
                </View>
              ))}
            </Card>
          ) : null}

          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.secHead}>
              <Feather name="check-square" size={14} color={palette.muted} />
              <Text variant="label" tone="muted" style={{ flex: 1 }}>SUB-TASKS</Text>
              {cl.total > 0 ? <Text variant="caption" tone="muted">{cl.done}/{cl.total} done</Text> : null}
            </View>
            {checklist.length === 0 ? <Text variant="caption" tone="muted">No sub-tasks yet.</Text> : checklist.map((item) => (
              <View key={item.id} style={styles.clRow}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: item.status === "completed" }} accessibilityLabel={item.text} onPress={() => cycleItem(item)} hitSlop={8}><Feather name={asIcon(CHECK_ICON[item.status ?? "not_started"] ?? "circle")} size={18} color={item.status === "completed" ? palette.success : palette.faint} /></Pressable>
                <View style={{ flex: 1 }}>
                  <Text variant="body" style={item.status === "completed" ? { textDecorationLine: "line-through", color: palette.faint } : undefined}>{item.text}</Text>
                  {item.actionDate || item.remark ? <Text variant="caption" tone="muted">{[item.actionDate ? fmtDate(item.actionDate) : null, item.remark].filter(Boolean).join(" · ")}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Remove sub-task" onPress={() => removeItem(item)} hitSlop={8}><Feather name="x" size={15} color={palette.faint} /></Pressable>
              </View>
            ))}
            <View style={styles.addRow}>
              <View style={{ flex: 1 }}><TextField label="" value={newItem} onChangeText={setNewItem} placeholder="Add a sub-task…" /></View>
              <Button label="Add" size="sm" variant="secondary" onPress={addItem} />
            </View>
          </Card>

          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.secHead}>
              <Feather name="link" size={14} color={palette.muted} />
              <Text variant="label" tone="muted" style={{ flex: 1 }}>RELATED</Text>
              {related.data?.canEdit ? <Text variant="caption" tone="brand" onPress={() => setLinkOpen(true)}>Link</Text> : null}
            </View>
            {(related.data?.links ?? []).length === 0 ? <Text variant="caption" tone="muted">Nothing linked.</Text> : related.data!.links.map((l) => {
              const href = mobileHref(l.href);
              return (
                <View key={`${l.kind}:${l.id}`} style={styles.clRow}>
                  <Feather name={asIcon(LINK_ICON[l.kind])} size={16} color={palette.brandDark} />
                  <Pressable style={{ flex: 1 }} disabled={!href} onPress={() => href && router.push(href as any)}>
                    <Text variant="body" style={{ color: href ? palette.ink : palette.muted }} numberOfLines={1}>{l.name}</Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>{titleCase(l.kind)}{l.sub ? ` · ${l.sub}` : ""}{href ? "" : " · Not in your book"}</Text>
                  </Pressable>
                  {l.fixed ? <Feather name="lock" size={14} color={palette.faint} />
                    : related.data?.canEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`Unlink ${l.name}`} hitSlop={8} onPress={() => patch({ [LINK_FIELD[l.kind]]: null })}><Feather name="x" size={15} color={palette.faint} /></Pressable> : null}
                </View>
              );
            })}
          </Card>

          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.secHead}><Feather name="message-square" size={14} color={palette.muted} /><Text variant="label" tone="muted" style={{ flex: 1 }}>COMMENTS</Text></View>
            {(comments.data ?? []).map((c) => (
              <View key={c.id} style={styles.logRow}>
                <Text variant="caption" tone="faint">{c.authorName ?? "—"} · {timeAgo(c.createdAt)}</Text>
                <Text variant="caption">{c.body}</Text>
              </View>
            ))}
            <View style={styles.addRow}>
              <View style={{ flex: 1 }}><TextField label="" value={comment} onChangeText={setComment} placeholder="Add a comment…" multiline /></View>
              <Button label="Post" size="sm" onPress={postComment} loading={addComment.isPending} />
            </View>
            {earlier.length ? (
              <>
                <Text variant="caption" tone="faint" style={{ marginTop: spacing.md }}>EARLIER NOTES</Text>
                {earlier.map((r, i) => (
                  <View key={i} style={styles.logRow}>
                    {r.header ? <Text variant="caption" tone="faint">{r.header}</Text> : null}
                    <Text variant="caption">{r.body}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </Card>
        </Animated.View>
      </ScrollView>

      <BottomSheet visible={statusSheet} onClose={() => setStatusSheet(false)} title="Set status">
        {TASK_STATUSES.map((s) => (
          <Pressable key={s.key} onPress={() => setStatus(s.key)} style={styles.option}>
            <Text variant="body" style={{ color: task.status === s.key ? palette.brand : palette.ink }}>{s.label}</Text>
            {task.status === s.key ? <Feather name="check" size={18} color={palette.brand} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
      <BottomSheet visible={prioSheet} onClose={() => setPrioSheet(false)} title="Set priority">
        {TASK_PRIORITIES.map((p) => (
          <Pressable key={p.key} onPress={() => setPriority(p.key)} style={styles.option}>
            <Text variant="body" style={{ color: task.priority === p.key ? palette.brand : palette.ink }}>{p.label}</Text>
            {task.priority === p.key ? <Feather name="check" size={18} color={palette.brand} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
      <AskSheet visible={askOpen} onClose={() => setAskOpen(false)} busy={info.isPending}
        people={(team.data?.rows ?? []).filter((u) => u.id !== myId && (u.status ?? "active") === "active").map((u) => ({ value: u.id, label: u.name ?? "—" }))}
        defaultTo={task.createdById && task.createdById !== myId ? task.createdById : null}
        onAsk={(question, askToId) => info.mutate({ action: "ask", question, ...(askToId ? { askToId } : {}) }, { onSuccess: () => { setAskOpen(false); toast.success("Asked — the task waits for the answer"); } })} />
      <RejectApprovalSheet visible={rejectOpen} onClose={() => setRejectOpen(false)} busy={update.isPending}
        onReject={(note) => patch({ approvalAction: "reject", ...(note ? { approvalNote: note } : {}) }, () => { setRejectOpen(false); toast.success("Sent back"); })} />
      <LinkSheet visible={linkOpen} onClose={() => setLinkOpen(false)} onLink={(field, value) => { setLinkOpen(false); patch({ [field]: value }); }} />
    </View>
  );
}

function AskSheet({ visible, onClose, onAsk, busy, people, defaultTo }: { visible: boolean; onClose: () => void; onAsk: (q: string, to: string | null) => void; busy: boolean; people: { value: string; label: string }[]; defaultTo: string | null }) {
  const [q, setQ] = useState("");
  const [to, setTo] = useState<string | null>(defaultTo);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Need information">
      <TextField label="What do you need?" value={q} onChangeText={(v) => setQ(v.slice(0, 3000))} multiline required />
      <SelectField label="Ask" value={to} placeholder="Whoever created the task" options={people} onChange={setTo} />
      <Button label="Ask" full loading={busy} onPress={() => q.trim() && onAsk(q.trim(), to)} />
    </BottomSheet>
  );
}

function RejectApprovalSheet({ visible, onClose, onReject, busy }: { visible: boolean; onClose: () => void; onReject: (note: string) => void; busy: boolean }) {
  const [note, setNote] = useState("");
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Reject — send back">
      <TextField label="What needs fixing (optional)" value={note} onChangeText={(v) => setNote(v.slice(0, 2000))} multiline />
      <Button label="Send back" variant="danger" full loading={busy} onPress={() => onReject(note.trim())} />
    </BottomSheet>
  );
}

/** Link a client, lead, meeting or service request (GET /api/search). */
function LinkSheet({ visible, onClose, onLink }: { visible: boolean; onClose: () => void; onLink: (field: string, id: string) => void }) {
  const [q, setQ] = useState("");
  const s = useSearch(q);
  const d: any = s.data ?? {};
  const rows: Array<{ field: string; id: string; title: string; sub: string }> = [
    ...(d.investors ?? []).map((r: any) => ({ field: "relatedInvestorId", id: r.id, title: r.name, sub: "Client" })),
    ...(d.leads ?? []).map((r: any) => ({ field: "relatedLeadId", id: r.id, title: r.name, sub: "Lead" })),
    ...(d.meetings ?? []).map((r: any) => ({ field: "relatedMeetingId", id: r.id, title: r.subject ?? r.title ?? r.investor_name ?? "Meeting", sub: "Meeting" })),
    ...(d.serviceRequests ?? []).map((r: any) => ({ field: "relatedServiceRequestId", id: r.id, title: r.ticket_no ?? r.subject ?? "Service request", sub: `Service request${r.subject ? ` · ${r.subject}` : ""}` })),
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Link to this task">
      <SearchBar value={q} onChangeText={setQ} placeholder="Search clients, leads, meetings, requests…" />
      <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {rows.map((r) => (
          <Pressable key={`${r.field}:${r.id}`} style={styles.option} onPress={() => { setQ(""); onLink(r.field, r.id); }}>
            <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{r.title}</Text><Text variant="caption" tone="muted" numberOfLines={1}>{r.sub}</Text></View>
            <Feather name="plus-circle" size={16} color={palette.brand} />
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

function parseRemarks(raw?: string | null): { header: string; body: string }[] {
  if (!raw) return [];
  return raw.split(/\n\n+/).map((block) => {
    const m = block.match(/^\s*\[(.+?)\]\s*([\s\S]*)$/);
    return m ? { header: m[1], body: m[2].trim() } : { header: "", body: block.trim() };
  }).filter((e) => e.body || e.header);
}

function SnoozeBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.snooze}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold }}>{label}</Text></Pressable>;
}
function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.divider]}>
      <Text variant="label" tone="muted">{label}</Text>
      <Text variant="body" style={{ color: palette.ink, flex: 1, textAlign: "right" }} numberOfLines={2}>{value || "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginTop: spacing.lg },
  row2: { flexDirection: "row", gap: spacing.md },
  snoozeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  snooze: { backgroundColor: palette.brandLight, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  secHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  clRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  addRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  logRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft, gap: 2, marginTop: spacing.xs },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
});
