/**
 * Meeting detail + editor — web parity with ReviewMeetingDetailEditor.
 *
 * Header (subject / type / who / when / RM) · prep brief (upcoming investor
 * meetings) · status + Mark completed + Save · schedule/reschedule · attendees ·
 * discussion · action items · attachments · next review date · cancel.
 *
 * The CRM's rules (2026-10-01): attendees are looked up — team, clients, leads —
 * or added as a guest; an action item has an owner and a due date and IS a
 * task (the server creates it on the first save and returns its id, kept here
 * so the next save edits it). The meeting has no notes box and no Outcome card.
 */

import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { DateField } from "../../../../src/components/form/DateField";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { confirmDelete } from "../../../../src/lib/confirm";
import {
  useMeeting, useUpdateMeeting, useCancelMeeting, useMeetingTeam,
  MEETING_STATUSES, MEETING_MODES, ATTENDEE_ROLES, ATTENDEE_KIND_LABEL,
  type MeetingActionItem, type MeetingAttendee,
} from "../../../../src/features/meetings/api";
import { AttendeePicker } from "../../../../src/features/meetings/AttendeePicker";
import { api, ApiError } from "../../../../src/api/client";
import { meetingStatusBadge } from "../../../../src/lib/status";
import { titleCase, inr } from "../../../../src/lib/format";
import { palette, spacing, radius, fontWeight } from "../../../../src/theme/tokens";

/** An uploaded file has no URL — it is kept by its fileId. */
type Attachment = { name: string; url: string; fileId?: string; size?: number; uploadedAt?: string };

// 15-minute time slots, 12-hour labels (mirrors the web TIME_SLOTS).
const TIME_SLOTS = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) {
    const hh = String(h).padStart(2, "0"), mm = String(m).padStart(2, "0");
    const ampm = h < 12 ? "AM" : "PM", h12 = h % 12 === 0 ? 12 : h % 12;
    out.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
  }
  return out;
})();

function splitLocal(v: any): { day: string; time: string } {
  if (!v) return { day: "", time: "11:00" };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { day: "", time: "11:00" };
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}
function fmtWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" });
}

export default function MeetingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: m, isLoading, isError, error, refetch } = useMeeting(id);
  const update = useUpdateMeeting(id);
  const cancel = useCancelMeeting(id);
  const team = useMeetingTeam();

  // ── Editor state (hydrated once the meeting loads) ──
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const [status, setStatus] = useState("scheduled");
  const [subject, setSubject] = useState("");
  const [meetingDay, setMeetingDay] = useState("");
  const [meetingTime, setMeetingTime] = useState("11:00");
  const [origDay, setOrigDay] = useState("");
  const [origTime, setOrigTime] = useState("11:00");
  const [meetingMode, setMeetingMode] = useState("office");
  const [location, setLocation] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [discussion, setDiscussion] = useState("");
  const [items, setItems] = useState<MeetingActionItem[]>([]);
  const [atts, setAtts] = useState<Attachment[]>([]);
  // Only a changed link list is sent: the PATCH replaces the whole list, so an
  // untouched save would drop a file someone uploaded on the web meanwhile.
  const [attsDirty, setAttsDirty] = useState(false);
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nextReview, setNextReview] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!m || hydratedId === m.id) return;
    const dt = splitLocal(m.meeting_date);
    setStatus(m.status ?? "scheduled");
    setSubject(m.subject ?? "");
    setMeetingDay(dt.day); setMeetingTime(dt.time); setOrigDay(dt.day); setOrigTime(dt.time);
    setMeetingMode(m.meeting_mode ?? "office");
    setLocation(m.location_or_link ?? "");
    setDiscussion(m.discussion_points ?? "");
    setItems(Array.isArray(m.action_items) ? (m.action_items as MeetingActionItem[]) : []);
    setAtts(Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : []);
    setAttsDirty(false);
    setAttendees(Array.isArray(m.attendees) ? (m.attendees as MeetingAttendee[]) : []);
    setNextReview(m.next_review_date ? String(m.next_review_date).slice(0, 10) : "");
    setHydratedId(m.id);
  }, [m, hydratedId]);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Meeting" onBack={() => router.back()} /><LoadingState /></View>;
  if (isError || !m) return <View style={styles.screen}><ScreenHeader title="Meeting" onBack={() => router.back()} /><ErrorState message={(error as any)?.message} onRetry={() => refetch()} /></View>;

  const st = meetingStatusBadge(status);
  const who = m.subject_name ?? m.investor_name ?? m.lead_name ?? "Subject";
  const subjectKind = m.lead_id ? "Lead" : "Client";
  const dateMoved = !!meetingDay && (meetingDay !== origDay || meetingTime !== origTime);
  const prep = m.prep;

  async function save(overrideStatus?: string) {
    setErr(null); setOk(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const payload: Record<string, any> = {
      status: overrideStatus ?? status,
      subject: subject || undefined,
      discussionPoints: discussion || undefined,
      // A title under 2 characters is not a task yet; it stays off the save.
      actionItems: items
        .filter((i) => i.title.trim().length >= 2)
        .map((i) => ({ ...i, title: i.title.trim(), assigneeId: i.assigneeId || undefined, dueAt: i.dueAt || undefined })),
      ...(attsDirty ? { attachments: atts.filter((a) => a.fileId || (a.url ?? "").trim().length > 0) } : {}),
      attendees: attendees.filter((a) => a.name.trim().length > 0),
      nextReviewDate: nextReview || undefined,
      meetingMode: meetingMode || undefined,
      locationOrLink: location || undefined,
      ...(dateMoved ? { meetingDate: new Date(`${meetingDay}T${meetingTime || "11:00"}:00`).toISOString(), rescheduleReason: rescheduleReason || undefined } : {}),
    };
    try {
      const res = await update.mutateAsync(payload);
      // Keep what the server stored: every action item now carries its task,
      // so the next save edits those tasks instead of creating new ones.
      if (Array.isArray(res?.actionItems)) setItems(res.actionItems);
      if (Array.isArray(res?.attendees)) setAttendees(res.attendees);
      if (overrideStatus === "completed" || res?.completed) {
        setStatus("completed");
        const also = Array.isArray(res?.familyMembers) ? res.familyMembers : [];
        setOk(`Marked completed.${also.length ? ` The review also covers ${also.join(", ")}.` : ""}`);
      } else setOk("Saved.");
      setRescheduleReason("");
      // The server decides the stored status and date (a reschedule is stored
      // as scheduled): take them back so the next save doesn't resend ours.
      await refetch();
      setHydratedId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save. Please try again.");
    }
  }

  /** An uploaded file is deleted on the server, not just dropped from the list. */
  const removeFile = (a: Attachment) => confirmDelete({ title: `Delete ${a.name}?`, message: "The file is removed from this meeting.", confirmLabel: "Delete" }, async () => {
    try {
      await api.del(`/api/review-meetings/${id}/files/${a.fileId}`);
      setAtts((s) => s.filter((x) => x.fileId !== a.fileId));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete the file.");
    }
  });
  /** A meeting entered by mistake (not completed, nothing recorded) is deleted outright. */
  const doPurge = () => confirmDelete(
    { title: "Delete this meeting?", message: "Only for a meeting entered by mistake — it is removed completely.", confirmLabel: "Delete" },
    async () => {
      try { await api.del(`/api/review-meetings/${id}/purge`); router.back(); }
      catch (e) { setErr(e instanceof ApiError ? e.message : "Could not delete the meeting."); }
    },
  );
  const doCancel = () => confirmDelete(
    { title: "Cancel this meeting?", message: "It's marked cancelled and the reminder task is cleared.", confirmLabel: "Cancel meeting" },
    () => cancel.mutate(undefined, { onSuccess: () => router.back() })
  );

  const busy = update.isPending;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={m.subject ?? "Meeting"} subtitle={titleCase(m.meeting_type) || undefined} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInUp.duration(240)}>
          {/* Header */}
          <Card>
            <Text variant="title">{m.subject ?? `${who} · ${titleCase(m.meeting_type)}`}</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{who} · {subjectKind}</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{fmtWhen(m.meeting_date)} · {titleCase(m.meeting_mode)}{m.rm_name ? ` · RM: ${m.rm_name}` : ""}</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" }}>
              <StatusPill label={st.label} tone={st.tone} />
              {Number(m.reschedule_count ?? 0) > 0 ? <StatusPill label={`rescheduled ${m.reschedule_count}×`} tone="warning" dot={false} /> : null}
            </View>
          </Card>

          {/* Prep brief */}
          {prep ? (
            <Card style={{ marginTop: spacing.lg }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md }}>
                <Feather name="target" size={15} color={palette.brand} />
                <Text variant="subtitle">Prep brief</Text>
                <Text variant="caption" tone="faint">— walk in ready</Text>
              </View>
              <View style={styles.prepGrid}>
                <Prep label="AUM" value={inr(prep.aum ?? 0)} />
                <Prep label="Monthly SIP" value={inr(prep.active_sip_amount ?? 0)} />
                <Prep label="Last review" value={prep.last_review_at ? new Date(prep.last_review_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "Never"} tone={!prep.last_review_at ? palette.danger : undefined} />
                <Prep label="Open requests" value={String(prep.open_srs ?? 0)} tone={Number(prep.open_srs) > 0 ? palette.warning : undefined} />
                <Prep label="SIP bounces 6mo" value={String(prep.bounces_6mo ?? 0)} tone={Number(prep.bounces_6mo) > 0 ? palette.danger : undefined} />
                <Prep label="Goals" value={String(prep.goals_count ?? 0)} />
              </View>
              {m.investor_id ? (
                <Pressable onPress={() => router.push(`/m/investors/${m.investor_id}` as any)} style={{ marginTop: spacing.md }}>
                  <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold }}>Open Client 360 →</Text>
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          {ok ? <Banner tone="success" text={ok} /> : null}
          {err ? <Banner tone="danger" text={err} /> : null}

          {/* Status + actions */}
          <Card style={{ marginTop: spacing.lg }}>
            <SelectField label="Status" value={status} options={MEETING_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} onChange={setStatus} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              {status !== "completed" ? (
                <View style={{ flex: 1 }}><Button label="Mark completed" variant="secondary" loading={busy} onPress={() => save("completed")} icon={<Feather name="check-circle" size={15} color={palette.success} />} full /></View>
              ) : null}
              <View style={{ flex: 1 }}><Button label="Save" loading={busy} onPress={() => save()} icon={<Feather name="save" size={15} color="#fff" />} full /></View>
            </View>
          </Card>

          {/* Subject */}
          <Card style={{ marginTop: spacing.lg }}>
            <TextField label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Q1 portfolio review + tax-saving + nominee update" />
          </Card>

          {/* Schedule / reschedule */}
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.md }}>Schedule</Text>
            <DateField label="Date" value={meetingDay} onChange={setMeetingDay} />
            <SelectField label="Time" value={meetingTime} options={TIME_SLOTS} onChange={setMeetingTime} />
            <SelectField label="Mode" value={meetingMode} options={MEETING_MODES.map((v) => ({ value: v, label: titleCase(v) }))} onChange={setMeetingMode} />
            <TextField label="Location / link" value={location} onChangeText={setLocation} placeholder="Office / address / video link" />
            {dateMoved ? (
              <>
                <TextField label="Reschedule reason" value={rescheduleReason} onChangeText={setRescheduleReason} placeholder="Why is this being moved? (optional)" />
                <Text variant="caption" tone="warning">Saving moves the T-1 reminder task to the new date and logs a reschedule.</Text>
              </>
            ) : null}
          </Card>

          {/* Attendees — looked up from team, clients and leads */}
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>Attendees ({attendees.length})</Text>
            {attendees.map((a, i) => {
              const href = a.kind === "client" && a.refId ? `/m/investors/${a.refId}` : a.kind === "lead" && a.refId ? `/m/leads/${a.refId}` : null;
              return (
                <View key={`${a.kind ?? "x"}:${a.refId ?? a.name}:${i}`} style={styles.rowItem}>
                  <StatusPill label={a.kind ? ATTENDEE_KIND_LABEL[a.kind] : ATTENDEE_ROLES.find((r) => r.value === a.role)?.label ?? a.role} tone={a.kind === "user" ? "info" : "neutral"} size="sm" dot={false} />
                  <Text variant="body" style={[{ flex: 1 }, href ? { color: palette.brand } : null]} numberOfLines={1} onPress={href ? () => router.push(href as any) : undefined}>{a.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} onPress={() => setAttendees((p) => p.filter((_, idx) => idx !== i))} hitSlop={8}><Feather name="x" size={16} color={palette.muted} /></Pressable>
                </View>
              );
            })}
            <Button label="Add attendee" variant="secondary" icon={<Feather name="user-plus" size={15} color={palette.ink} />} onPress={() => setPickerOpen(true)} style={{ marginTop: spacing.sm }} />
          </Card>

          {/* Discussion */}
          <Card style={{ marginTop: spacing.lg }}>
            <TextField label="Discussion points (agenda)" value={discussion} onChangeText={setDiscussion} placeholder="What you plan to cover with the client…" multiline />
          </Card>

          {/* Action items — each one is a task for the person it is given to */}
          <Card style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text variant="subtitle">Action items ({items.length})</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Add action item" onPress={() => setItems((s) => [...s, { title: "" }])} hitSlop={8}><Feather name="plus" size={18} color={palette.brand} /></Pressable>
            </View>
            {items.length === 0 ? (
              <Text variant="caption" tone="muted">None yet.</Text>
            ) : items.map((it, i) => (
              <View key={it.taskId ?? `new-${i}`} style={styles.item}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <TextField label={`Item ${i + 1}`} value={it.title} onChangeText={(v) => setItems((s) => s.map((x, idx) => idx === i ? { ...x, title: v } : x))} placeholder="e.g. Send tax-saving fund recommendation" />
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={it.taskId ? "Remove (cancels its task on save)" : "Remove action item"} onPress={() => setItems((s) => s.filter((_, idx) => idx !== i))} hitSlop={8} style={{ paddingTop: 30 }}><Feather name="trash-2" size={16} color={palette.danger} /></Pressable>
                </View>
                <SelectField label="Assigned to" value={it.assigneeId ?? null} placeholder="Assign to…" options={(team.data?.team ?? []).map((u) => ({ value: u.id, label: u.name }))} onChange={(v) => setItems((s) => s.map((x, idx) => idx === i ? { ...x, assigneeId: v } : x))} />
                <DateField label="Due" value={it.dueAt ? String(it.dueAt).slice(0, 10) : ""} onChange={(v) => setItems((s) => s.map((x, idx) => idx === i ? { ...x, dueAt: v } : x))} />
                {it.taskId ? <Text variant="caption" tone="brand" onPress={() => router.push(`/m/tasks/${it.taskId}` as any)}>Open task →</Text> : null}
              </View>
            ))}
            {items.length > 0 ? <Text variant="caption" tone="muted">No due date means a week from today.</Text> : null}
          </Card>

          {/* Attachments */}
          <Card style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text variant="subtitle">Attachments ({atts.length})</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" onPress={() => { setAttsDirty(true); setAtts((s) => [...s, { name: "", url: "" }]); }} hitSlop={8}><Feather name="plus" size={18} color={palette.brand} /></Pressable>
            </View>
            {atts.length === 0 ? (
              <Text variant="caption" tone="muted">Paste a link to a presentation, report, or signed document.</Text>
            ) : atts.map((a, i) => a.fileId ? (
              <View key={a.fileId} style={styles.rowItem}>
                <Feather name="paperclip" size={14} color={palette.muted} />
                <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>{a.name}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${a.name}`} onPress={() => removeFile(a)} hitSlop={8}><Feather name="x" size={16} color={palette.muted} /></Pressable>
              </View>
            ) : (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField label={`Name ${i + 1}`} value={a.name} onChangeText={(v) => { setAttsDirty(true); setAtts((s) => s.map((x, idx) => idx === i ? { ...x, name: v } : x)); }} placeholder="Display name" />
                  <TextField label="URL" value={a.url} onChangeText={(v) => { setAttsDirty(true); setAtts((s) => s.map((x, idx) => idx === i ? { ...x, url: v } : x)); }} placeholder="https://…" autoCapitalize="none" />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Remove attachment" onPress={() => { setAttsDirty(true); setAtts((s) => s.filter((_, idx) => idx !== i)); }} hitSlop={8} style={{ paddingTop: 30 }}><Feather name="trash-2" size={16} color={palette.danger} /></Pressable>
              </View>
            ))}
          </Card>

          {/* Next review */}
          <Card style={{ marginTop: spacing.lg }}>
            <DateField label="Next review date" value={nextReview} onChange={setNextReview} help="On completion, the client's next review is set to this date — or, left blank, from the client's review cadence." />
          </Card>

          {/* Cancel */}
          {status !== "cancelled" ? (
            <Button label="Cancel meeting" variant="danger" loading={cancel.isPending} onPress={doCancel} icon={<Feather name="x-circle" size={15} color="#fff" />} style={{ marginTop: spacing.lg }} />
          ) : null}
          {m.status !== "completed" ? (
            <Button label="Delete — entered by mistake" variant="ghost" onPress={doPurge} style={{ marginTop: spacing.sm }} />
          ) : null}
        </Animated.View>
      </ScrollView>
      <AttendeePicker visible={pickerOpen} onClose={() => setPickerOpen(false)} taken={attendees}
        onPick={(a) => { setAttendees((p) => [...p, a]); setPickerOpen(false); }} />
    </View>
  );
}

function Prep({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.prepCell}>
      <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: fontWeight.bold, color: tone ?? palette.ink }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Banner({ tone, text }: { tone: "success" | "danger"; text: string }) {
  const bg = tone === "success" ? palette.successBg ?? "#ECFDF5" : palette.dangerBg;
  const fg = tone === "success" ? palette.success : palette.danger;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg }}>
      <Text variant="body" style={{ color: fg }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  prepGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  prepCell: { width: "31%", backgroundColor: palette.surfaceSunken, borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  item: { marginBottom: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  rowItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
