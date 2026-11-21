/**
 * Service request — the web ticket workspace (ServiceRequestDetailEditor) for
 * the phone: what the client asked, the two SLA clocks (first response,
 * resolution), status / priority / assignee, "Mark first response", the SEBI
 * complaint register (a complaint only: category, sub-category, source, SCORES
 * ref), internal remarks, resolution notes, CSAT once resolved, a timeline note
 * and the activity timeline. Every save is PATCH /api/service-requests/[id],
 * which appends the timeline and stamps respondedAt / resolvedAt.
 *
 * A complaint is resolved or closed only with resolution notes (the Complaint
 * Register's rule — checked here first, enforced by the server). Writing needs
 * service_request.manage; without it the ticket is read-only.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { ErrorState } from "../../../../src/components/states";
import { api } from "../../../../src/api/client";
import { useMe, hasCap } from "../../../../src/api/me";
import { useTeam } from "../../../../src/features/team/api";
import {
  useServiceRequest, useUpdateServiceRequest, srStatusMeta, isSlaBreached, slaClock, srTypeLabel,
  SR_STATUSES, PRIORITY_TONE, SEBI_CATEGORIES, COMPLAINT_SOURCES, SR_EVENT_LABEL,
  type SrStatus, type SrPatch, type ServiceRequest,
} from "../../../../src/features/service-requests/api";
import { toast } from "../../../../src/lib/toast";
import { fmtDate, timeAgo, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors } from "../../../../src/theme";

const PRIORITIES = [{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }];
const NEEDS_NOTES = "A complaint needs resolution notes before it is resolved or closed.";

export default function ServiceRequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sid = String(id ?? "");
  const { data: r, isLoading, isError, error, refetch } = useServiceRequest(sid);

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Request" />
        <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={120} /><Skeleton width="100%" height={80} style={{ marginTop: spacing.md }} /></View>
      </View>
    );
  }
  // A ticket outside the viewer's scope (404) used to spin as a skeleton for ever.
  if (isError || !r) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Request" />
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      </View>
    );
  }
  // Keyed by the row's last change: a fresh server copy re-seeds the editor.
  return <Workspace key={`${r.id}:${r.updatedAt ?? ""}`} r={r} />;
}

function Workspace({ r }: { r: ServiceRequest }) {
  const router = useRouter();
  const update = useUpdateServiceRequest(r.id);
  const { data: me } = useMe();
  const canManage = hasCap(me?.capabilities, "service_request.manage");
  const team = useTeam();
  const nameOf = (uid?: string | null) => (uid ? team.data?.rows?.find((u) => u.id === uid)?.name ?? null : null);
  const people = (team.data?.rows ?? []).filter((u) => (u.status ?? "active") === "active").map((u) => ({ value: u.id, label: u.name ?? "—" }));
  // The client's name — the client page's own query; outside the viewer's book it says so.
  const client = useQuery({
    queryKey: ["investor", r.investorId],
    enabled: !!r.investorId,
    queryFn: () => api.get<any>(`/api/investors/${r.investorId}`),
    retry: false,
    staleTime: 60_000,
  });
  const clientName: string | null = client.data?.investor?.name ?? null;

  const isComplaint = r.type === "complaint";
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [priority, setPriority] = React.useState<string>(r.priority ?? "normal");
  const [assignee, setAssignee] = React.useState<string>(r.assignedToUserId ?? "");
  const [remarks, setRemarks] = React.useState<string>(r.remarks ?? "");
  const [notes, setNotes] = React.useState<string>(r.resolutionNotes ?? "");
  const [newNote, setNewNote] = React.useState("");
  const [csat, setCsat] = React.useState<number>(r.csatRating ?? 0);
  const [csatComment, setCsatComment] = React.useState<string>(r.csatComment ?? "");
  const [sebiCategory, setSebiCategory] = React.useState<string>(r.sebiCategory ?? "service");
  const [sebiSubCategory, setSebiSubCategory] = React.useState<string>(r.sebiSubCategory ?? "");
  const [complaintSource, setComplaintSource] = React.useState<string>(r.complaintSource ?? "direct");
  const [scoresRefNo, setScoresRefNo] = React.useState<string>(r.scoresRefNo ?? "");

  const meta = srStatusMeta(r.status);
  const breached = isSlaBreached(r);
  const closed = r.status === "resolved" || r.status === "closed";
  const timeline = (Array.isArray(r.timeline) ? r.timeline : []).slice().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const send = (body: SrPatch, okMsg: string, after?: () => void) =>
    update.mutate(body, { onSuccess: () => { toast.success(okMsg); after?.(); } });

  /** The web's Save: everything on the page in one PATCH (a status change optional). */
  const save = (nextStatus?: SrStatus) => {
    if (update.isPending) return;
    const status = nextStatus ?? (r.status as SrStatus | null) ?? "open";
    if (isComplaint && (status === "resolved" || status === "closed") && status !== r.status && !notes.trim()) {
      toast.error(NEEDS_NOTES);
      return;
    }
    const body: SrPatch = {
      status,
      priority,
      assignedToUserId: assignee || undefined,
      remarks: remarks || undefined,
      resolutionNotes: notes || undefined,
    };
    if (csat > 0 && csat !== r.csatRating) body.csatRating = csat;
    if (csatComment && csatComment !== r.csatComment) body.csatComment = csatComment.slice(0, 1000);
    if (isComplaint) {
      body.sebiCategory = sebiCategory;
      body.sebiSubCategory = sebiSubCategory || undefined;
      body.complaintSource = complaintSource;
      body.scoresRefNo = complaintSource === "scores" ? scoresRefNo || undefined : undefined;
    }
    send(body, nextStatus === "resolved" ? "Resolved — TAT clock stopped." : nextStatus ? `Marked ${srStatusMeta(nextStatus).label.toLowerCase()}` : "Saved.", () => setStatusOpen(false));
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={r.ticketNo ?? "Request"} subtitle={srTypeLabel(r.type) || undefined} />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* What the client asked */}
        <Card style={breached ? { borderLeftWidth: 3, borderLeftColor: toneColors("danger").fg } : undefined}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <Text variant="title" style={{ flex: 1 }}>{r.subject ?? "Request"}</Text>
            <Pressable disabled={!canManage} accessibilityRole="button" accessibilityLabel={`Status: ${meta.label}${canManage ? ". Change status" : ""}`} onPress={() => setStatusOpen(true)}>
              <StatusPill label={meta.label} tone={meta.tone} size="sm" />
            </Pressable>
          </View>
          <View style={styles.metaRow}>
            {r.priority ? <StatusPill label={titleCase(r.priority)} tone={PRIORITY_TONE[r.priority] ?? "neutral"} size="sm" dot={false} /> : null}
            {breached ? <StatusPill label="SLA passed" tone="danger" size="sm" dot={false} /> : null}
            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="faint">Raised {timeAgo(r.createdAt)}</Text>
          </View>
          <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
            {[r.investorId ? clientName ?? (client.isError ? "Client not in your book" : "…") : "No client linked", r.channel ? titleCase(r.channel) : null].filter(Boolean).join(" · ")}
          </Text>
          {r.description ? <Text variant="body" style={{ color: palette.ink, lineHeight: 21, marginTop: spacing.sm }}>{r.description}</Text> : null}
          {r.investorId && clientName ? (
            <Pressable onPress={() => router.push(`/m/investors/${r.investorId}` as any)} style={{ marginTop: spacing.sm, minHeight: 32, justifyContent: "center" }} accessibilityRole="link">
              <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold }}>Open client →</Text>
            </Pressable>
          ) : null}
        </Card>

        {/* SLA clocks */}
        <View style={[styles.row2, { marginTop: spacing.md }]}>
          <SlaTile label="First response" due={r.slaResponseAt} done={r.respondedAt} />
          <SlaTile label="Resolution (TAT)" due={r.slaResolutionAt} done={r.resolvedAt} />
        </View>

        {canManage ? (
          <>
            {/* Move it along */}
            <SectionLabel text="UPDATE STATUS" />
            <View style={styles.statusRow}>
              {(["in_progress", "waiting_customer", "resolved"] as SrStatus[]).map((s) => {
                const m = srStatusMeta(s);
                const active = r.status === s;
                return (
                  <Pressable key={s} style={[styles.statusBtn, active && { backgroundColor: toneColors(m.tone).bg, borderColor: toneColors(m.tone).fg }]} onPress={() => { if (!active) save(s); }} disabled={update.isPending} accessibilityRole="button" accessibilityState={{ selected: active }}>
                    <Text variant="caption" style={{ color: active ? toneColors(m.tone).fg : palette.ink, fontWeight: fontWeight.semibold }}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!r.respondedAt ? (
              <Button label="Mark first response" variant="secondary" size="sm" icon={<Feather name="phone-call" size={14} color={palette.ink} />} onPress={() => send({ markResponded: true }, "First response recorded.")} disabled={update.isPending} style={{ marginTop: spacing.sm }} />
            ) : null}

            <Card flat style={{ marginTop: spacing.lg }}>
              <SelectField label="Priority" value={priority} options={PRIORITIES} onChange={setPriority} />
              <SelectField label="Assigned to" value={assignee || null} placeholder={nameOf(r.assignedToUserId) ?? "Unassigned"} options={people} onChange={setAssignee} />
            </Card>

            {isComplaint ? (
              <>
                <SectionLabel text="SEBI COMPLAINT REGISTER" />
                <Card flat>
                  <SelectField label="SEBI category" required value={sebiCategory} options={SEBI_CATEGORIES} onChange={setSebiCategory} />
                  <TextField label="Sub-category" value={sebiSubCategory} onChangeText={(v) => setSebiSubCategory(v.slice(0, 120))} placeholder="e.g. Scheme switch" />
                  <SelectField label="Source" value={complaintSource} options={COMPLAINT_SOURCES} onChange={setComplaintSource} />
                  {complaintSource === "scores" ? <TextField label="SCORES ref no" value={scoresRefNo} onChangeText={(v) => setScoresRefNo(v.slice(0, 80))} placeholder="2026/0001234" autoCapitalize="characters" /> : null}
                </Card>
              </>
            ) : null}

            <SectionLabel text="NOTES" />
            <Card flat>
              <TextField label="Internal remarks" value={remarks} onChangeText={(v) => setRemarks(v.slice(0, 4000))} multiline />
              <TextField label={isComplaint ? "Resolution notes (SEBI register)" : "Resolution notes"} required={isComplaint} value={notes} onChangeText={(v) => setNotes(v.slice(0, 4000))} multiline placeholder="What you did, and what you told the client…" />
            </Card>

            {closed ? (
              <>
                <SectionLabel text="CLIENT SATISFACTION (CSAT)" />
                <Card flat>
                  <View style={{ flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md, alignItems: "center" }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Pressable key={n} onPress={() => setCsat(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n} star`} style={{ padding: 2 }}>
                        <Feather name="star" size={24} color={n <= csat ? palette.warning : palette.line} />
                      </Pressable>
                    ))}
                    {csat > 0 ? <Text variant="caption" tone="muted" style={{ marginLeft: spacing.sm }}>{csat}/5</Text> : null}
                  </View>
                  <TextField label="Client comment (optional)" value={csatComment} onChangeText={setCsatComment} />
                </Card>
              </>
            ) : null}

            <View style={[styles.row2, { marginTop: spacing.lg }]}>
              {!closed ? <View style={{ flex: 1 }}><Button label="Resolve" variant="secondary" full disabled={update.isPending} icon={<Feather name="check-circle" size={15} color={palette.success} />} onPress={() => save("resolved")} /></View> : null}
              <View style={{ flex: 1 }}><Button label="Save" full loading={update.isPending} icon={<Feather name="save" size={15} color={palette.white} />} onPress={() => save()} /></View>
            </View>

            <SectionLabel text="ADD NOTE" />
            <Card flat>
              <TextField label="" value={newNote} onChangeText={(v) => setNewNote(v.slice(0, 1000))} multiline placeholder="Called the client, sent the form…" />
              <Button label="Add note" size="sm" variant="secondary" disabled={!newNote.trim() || update.isPending} onPress={() => send({ timelineNote: newNote.trim() }, "Note added.", () => setNewNote(""))} />
            </Card>
          </>
        ) : r.resolutionNotes ? (
          <>
            <SectionLabel text="RESOLUTION NOTES" />
            <Card flat><Text variant="body">{r.resolutionNotes}</Text></Card>
          </>
        ) : null}

        <SectionLabel text={`ACTIVITY (${timeline.length})`} />
        <Card flat>
          {timeline.length === 0 ? <Text variant="caption" tone="muted">No activity yet.</Text> : timeline.map((t, i) => (
            <View key={i} style={[styles.logRow, i === 0 && { borderTopWidth: 0, marginTop: 0 }]}>
              <Text variant="caption" style={{ fontWeight: fontWeight.semibold }}>{SR_EVENT_LABEL[t.event] ?? titleCase(t.event)} <Text variant="caption" tone="faint">· {nameOf(t.by) ?? "system"} · {timeAgo(t.at)}</Text></Text>
              {t.note ? <Text variant="caption" tone="muted">{t.note}</Text> : null}
            </View>
          ))}
        </Card>
      </Screen>

      {/* Full status picker */}
      <BottomSheet visible={statusOpen} onClose={() => setStatusOpen(false)} title="Set status">
        {SR_STATUSES.map((s) => (
          <Pressable key={s.value} style={styles.pickRow} onPress={() => (r.status === s.value ? setStatusOpen(false) : save(s.value))} disabled={update.isPending}>
            <View style={[styles.dot, { backgroundColor: toneColors(s.tone).fg }]} />
            <Text variant="body" style={{ flex: 1 }}>{s.label}</Text>
            {r.status === s.value ? <Feather name="check" size={16} color={toneColors("success").fg} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
}

/** One SLA clock — "No SLA", Met / Missed once done, else due (amber within a day, red once breached). */
function SlaTile({ label, due, done }: { label: string; due?: string | null; done?: string | null }) {
  const c = slaClock(due, done);
  const color = c ? (c.tone === "neutral" ? palette.ink : toneColors(c.tone).fg) : palette.muted;
  const when = done ? fmtDate(done) : due ? fmtDate(due) : "";
  const text = !c ? "No SLA" : done ? `${c.label} · ${when}` : c.label === "Overdue" ? `Breached · was due ${when}` : `Due ${when}`;
  return (
    <View style={[styles.slaTile, c && c.tone !== "neutral" ? { borderColor: toneColors(c.tone).fg } : null]}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="body" style={{ color, fontWeight: fontWeight.semibold, marginTop: 2 }} numberOfLines={2}>{text}</Text>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm }}>{text}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  row2: { flexDirection: "row", gap: spacing.md },
  slaTile: { flex: 1, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md },
  statusRow: { flexDirection: "row", gap: spacing.sm },
  statusBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, borderRadius: radius.md, paddingVertical: spacing.md, minHeight: 44 },
  logRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft, gap: 2, marginTop: spacing.xs },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
