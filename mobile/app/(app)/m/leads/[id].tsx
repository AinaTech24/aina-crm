/**
 * Lead detail — web parity. Hero (score band, stage, source, owner + stat strip),
 * call/WhatsApp/email, a stage stepper, and 3 tabs (Overview / Details / Activity)
 * with actions: the CRM's guided next step (JourneyPanel), log activity,
 * convert-to-client, edit, delete. Data from GET /api/leads/[id]/full.
 *
 * There is no free stage picker: a lead moves the way the CRM moves it
 * (journey.ts) — Won on an approved proposal or the Won product pick, a call
 * loop with its next follow-up, a close with its reason.
 */

import { toast } from "../../../../src/lib/toast";
import { FollowUpField } from "../../../../src/components/form/FollowUpField";
import React, { useState, useEffect } from "react";
import { View, ScrollView, Pressable, Linking, RefreshControl, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { SavedCopyBanner } from "../../../../src/components/SavedCopyBanner";
import { useConnectivity } from "../../../../src/state/connectivity";
import { Section, FieldRow, Empty } from "../../../../src/features/investors/detail/primitives";
import { useLeadFull, useLogActivity, useConvertLead, useDeleteLead, LEAD_STAGES, stageMeta, stageDisplay, canonicalStage, leadSourceLabel } from "../../../../src/features/leads/api";
import { LEAD_PHASE, journeyStage } from "../../../../src/features/leads/journey";
import { JourneyPanel } from "../../../../src/features/leads/JourneyPanel";
import { RecordNotes } from "../../../../src/features/notes/RecordNotes";
import { DocumentsSection } from "../../../../src/features/investors/detail/DocumentsSection";
import { confirmDelete } from "../../../../src/lib/confirm";
import { startCall } from "../../../../src/features/activities/callAndLog";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import { QuickCommsSheet } from "../../../../src/features/investors/detail/QuickCommsSheet";
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { AssignOpsSheet } from "../../../../src/features/tasks/AssignOpsSheet";
import { useRecentlyViewed } from "../../../../src/state/recentlyViewed";
import { inr, initials, fmtDate, titleCase, timeAgo } from "../../../../src/lib/format";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";
import { useBrand } from "../../../../src/theme/brand";
import { asIcon } from "../../../../src/lib/icons";

type Tab = "overview" | "details" | "activity";
const TABS = [{ key: "overview", label: "Overview" }, { key: "details", label: "Details" }, { key: "activity", label: "Activity" }];
const BAND_TONE: Record<string, string> = { hot: palette.danger, warm: palette.warning, cold: palette.muted };
/** The web Convert dialog's categories (client types the convert route accepts). */
const CATEGORIES = [{ value: "individual", label: "Individual" }, { value: "huf", label: "HUF" }, { value: "corporate", label: "Corporate" }, { value: "trust", label: "Trust" }, { value: "nri", label: "NRI" }, { value: "minor", label: "Minor" }];
const SEGMENTS = [{ key: "Retail", label: "Retail" }, { key: "Affluent", label: "Affluent" }, { key: "HNI", label: "HNI" }, { key: "NRI", label: "NRI" }, { key: "Corporate", label: "Corporate" }];
const ACTIVITY_TYPES = [{ key: "note", label: "Note" }, { key: "call", label: "Call" }, { key: "meeting", label: "Meeting" }, { key: "email", label: "Email" }, { key: "whatsapp", label: "WhatsApp" }];
const toneColor = (t?: string) => (t === "success" ? palette.success : t === "warning" ? palette.warning : t === "danger" ? palette.danger : t === "violet" ? palette.violet : t === "info" ? palette.info : palette.muted);

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { brand } = useBrand();
  const { data: d, isLoading, isError, refetch, isRefetching, dataUpdatedAt } = useLeadFull(id);
  // No signal: show the copy saved on this phone (persisted cache, 24 h) instead of an error.
  const offline = useConnectivity((s) => !s.online);
  const logAct = useLogActivity(id!);
  const convert = useConvertLead(id!);
  const del = useDeleteLead();
  const [tab, setTab] = useState<Tab>("overview");
  const [actions, setActions] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [commsOpen, setCommsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState<false | string>(false);
  const [convertOpen, setConvertOpen] = useState(false);

  useEffect(() => {
    const ld = (d as any)?.lead;
    if (ld?.id) useRecentlyViewed.getState().add({ type: "lead", id: ld.id, name: ld.name });
  }, [(d as any)?.lead?.id]);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Lead" /><LoadingState label="Loading lead…" /></View>;
  if (!d?.lead) return <View style={styles.screen}><ScreenHeader title="Lead" /><ErrorState onRetry={refetch} /></View>;
  const savedCopy = isError || offline;

  const l = d.lead;
  const converted = !!l.convertedAt;
  const meta = stageMeta(l.stage);
  const phone = l.phone as string | null;
  const email = l.email as string | null;
  const amount = l.intendedAmount ?? l.expectedBusinessAmount;
  // No amount captured is "—", never "₹0".
  const hasAmount = amount != null && String(amount).trim() !== "";
  const stats = d.stats ?? {};

  const doDelete = () => {
    setActions(false);
    confirmDelete({ title: `Delete ${l.name}?`, message: "The lead is archived and hidden from the pipeline.", confirmLabel: "Delete" }, () => del.mutate(id!, { onSuccess: () => router.back() }));
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={l.name ?? "Lead"} right={<Pressable accessibilityRole="button" accessibilityLabel="More actions" onPress={() => setActions(true)} hitSlop={10}><Feather name="more-vertical" size={20} color={palette.ink} /></Pressable>} />
      {savedCopy ? <SavedCopyBanner savedAt={dataUpdatedAt} style={{ marginHorizontal: spacing.lg, marginTop: spacing.sm }} /> : null}
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        {/* Hero */}
        <View style={[styles.hero, { borderColor: brand }]}>
          <View style={styles.heroTop}>
            <View style={[styles.avatar, { backgroundColor: palette.brandLight }]}>
              <Text style={{ color: palette.brandDark, fontWeight: "700", fontSize: 18 }}>{initials(l.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeRow}>
                {l.scoreBand ? <Badge label={String(l.scoreBand).toUpperCase()} tone={BAND_TONE[l.scoreBand] ?? palette.muted} /> : null}
                {converted ? <Badge label="Converted" tone={palette.success} /> : meta ? <Badge label={stageDisplay(l.stage)} tone={toneColor(meta.tone)} /> : l.stage ? <Badge label={titleCase(l.stage)} tone={palette.muted} /> : null}
              </View>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {leadSourceLabel(l.source)}{l.city ? ` · ${l.city}` : ""}{d.owner?.name ? ` · RM ${d.owner.name}` : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text variant="caption" tone="faint">Intended</Text>
              <Text variant="subtitle">{hasAmount ? inr(amount) : "—"}</Text>
            </View>
          </View>

          {/* Stat strip */}
          <View style={styles.stats}>
            <Stat label="Score" value={String(l.leadScore ?? 0)} />
            <Stat label="Days" value={String(stats.daysAsLead ?? 0)} />
            <Stat label="Messages" value={String(stats.messages ?? 0)} />
            <Stat label="Open tasks" value={String(stats.openTasks ?? 0)} />
          </View>

          {/* Contact + convert */}
          <View style={styles.contactRow}>
            <ContactBtn icon="phone" label="Call" disabled={!phone} onPress={() => phone && startCall({ subjectType: "lead", subjectId: id!, name: l.name ?? "Lead", phone })} />
            <ContactBtn icon="message-circle" label="WhatsApp" disabled={!phone} onPress={() => phone && openWhatsApp({ phone, subjectType: "lead", subjectId: id!, name: l.name })} />
            <ContactBtn icon="mail" label="Email" disabled={!email} onPress={() => email && Linking.openURL(`mailto:${email}`)} />
          </View>
          {!converted && (
            <Button label="Convert to client" onPress={() => setConvertOpen(true)} full icon={<Feather name="user-check" size={15} color="#fff" />} style={{ marginTop: spacing.sm }} />
          )}
          {converted && l.convertedInvestorId && (
            <Button label="Open client" variant="secondary" onPress={() => router.replace(`/m/investors/${l.convertedInvestorId}` as any)} full icon={<Feather name="arrow-right" size={15} color={palette.ink} />} style={{ marginTop: spacing.sm }} />
          )}
        </View>

        {/* Sticky tabs */}
        <View style={styles.tabBar}><Segmented<Tab> options={TABS as any} value={tab} onChange={setTab} /></View>

        <Animated.View key={tab} entering={FadeIn.duration(200)}>
          {tab === "overview" ? <Overview d={d} id={id!} converted={converted} onLog={(t) => setActivityOpen(t)} />
            : tab === "details" ? <Details l={l} owner={d.owner} />
            : <Activity d={d} />}
        </Animated.View>
      </ScrollView>

      {/* Actions */}
      <BottomSheet visible={actions} onClose={() => setActions(false)} title={l.name}>
        <Button label="Log activity" variant="secondary" full icon={<Feather name="edit-3" size={15} color={palette.ink} />} onPress={() => { setActions(false); setActivityOpen("note"); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Quick comms" variant="secondary" full icon={<Feather name="send" size={15} color={palette.ink} />} onPress={() => { setActions(false); setCommsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Send a form" variant="secondary" full icon={<Feather name="file-text" size={15} color={palette.ink} />} onPress={() => { setActions(false); setFormOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Assign to team" variant="secondary" full icon={<Feather name="users" size={15} color={palette.ink} />} onPress={() => { setActions(false); setOpsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Edit lead" variant="secondary" full icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => { setActions(false); router.push(`/m/leads/new?editId=${id}` as any); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Delete lead" variant="danger" full loading={del.isPending} icon={<Feather name="trash-2" size={15} color="#fff" />} onPress={doDelete} />
      </BottomSheet>

      <QuickCommsSheet id={id!} visible={commsOpen} onClose={() => setCommsOpen(false)} subject="lead" />
      <SendFormSheet visible={formOpen} onClose={() => setFormOpen(false)} subjectType="lead" subjectId={id!} name={l.name} />
      <AssignOpsSheet visible={opsOpen} onClose={() => setOpsOpen(false)} subjectType="lead" subjectId={id!} subjectName={l.name} />

      {/* Log activity */}
      <LogActivitySheet visible={!!activityOpen} initialType={activityOpen || "note"} onClose={() => setActivityOpen(false)} pending={logAct.isPending} onSubmit={async (v) => { await logAct.mutateAsync(v); setActivityOpen(false); }} />

      {/* Convert */}
      <ConvertSheet visible={convertOpen} onClose={() => setConvertOpen(false)} pending={convert.isPending} defaultPan={l.pan} error={(convert.error as any)?.message}
        onSubmit={(v) => convert.mutate(v, { onSuccess: (r) => { setConvertOpen(false); if (r?.investorId) router.replace(`/m/investors/${r.investorId}` as any); } })} />
    </View>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function Overview({ d, id, converted, onLog }: { d: any; id: string; converted: boolean; onLog: (type: "call" | "meeting") => void }) {
  // The stepper is the six forward columns; a closed lead says so instead.
  const steps = LEAD_STAGES.filter((s) => s.key !== "not_qualified");
  const col = canonicalStage(d.lead.stage);
  const lost = col === "not_qualified";
  // Past Won (KYC, UCC, mandate… — client onboarding) every lead step is done;
  // such a stage is in no column, which used to leave the stepper blank.
  const onboarding = !!d.lead.stage && !LEAD_PHASE.has(journeyStage(d.lead.stage));
  const curIdx = onboarding ? steps.length : steps.findIndex((s) => s.key === col);
  return (
    <View>
      <Section title="Pipeline stage" icon="git-branch" right={lost ? <Text variant="caption" style={{ color: palette.danger, fontWeight: fontWeight.semibold }}>Lost</Text> : undefined}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
          {steps.map((s, i) => {
            const done = converted || i < curIdx;
            const active = !converted && i === curIdx;
            return (
              <View key={s.key} style={styles.step}>
                <View style={[styles.node, { backgroundColor: done ? palette.success : active ? palette.brand : palette.surfaceSunken, borderColor: done ? palette.success : active ? palette.brand : palette.line }]}>
                  {done ? <Feather name="check" size={11} color="#fff" /> : <Text style={{ fontSize: 10, color: active ? "#fff" : palette.muted, fontWeight: fontWeight.bold }}>{i + 1}</Text>}
                </View>
                <Text variant="caption" tone={active ? "brand" : "faint"} numberOfLines={2} style={styles.stepLabel}>{s.label}</Text>
              </View>
            );
          })}
        </ScrollView>
      </Section>

      {d.lead.convertedInvestorId ? (
        <Section title="Converted" icon="check-circle"><Empty text={`Converted to a client on ${fmtDate(d.lead.convertedAt)}.`} /></Section>
      ) : (
        <JourneyPanel leadId={id} leadStage={d.lead.stage} onLog={onLog} />
      )}
    </View>
  );
}

function Details({ l, owner }: { l: any; owner: any }) {
  return (
    <View>
      <Section title="Lead details" icon="file-text">
        <FieldRow label="Source" value={leadSourceLabel(l.source)} />
        <FieldRow label="Campaign" value={l.sourceCampaign} />
        <FieldRow label="Phone" value={l.phone} />
        <FieldRow label="Email" value={l.email} />
        <FieldRow label="Alt phone" value={l.altPhone} />
        <FieldRow label="Alt email" value={l.altEmail} />
        <FieldRow label="City" value={l.city} />
        <FieldRow label="Pincode" value={l.pincode} />
        <FieldRow label="Lead type" value={titleCase(l.leadType)} />
        <FieldRow label="AUM potential" value={titleCase(l.aumPotential)} />
        <FieldRow label="Occupation" value={l.profile?.occupation} />
        <FieldRow label="Expected business" value={l.expectedBusinessAmount != null ? inr(l.expectedBusinessAmount) : (l.intendedAmount ? inr(l.intendedAmount) : null)} />
        <FieldRow label="Score" value={`${l.leadScore ?? 0}${l.scoreBand ? ` · ${titleCase(l.scoreBand)}` : ""}`} />
        <FieldRow label="Owner (RM)" value={owner?.name} />
        <FieldRow label="Referred by" value={l.referredByName} />
        <FieldRow label="Last contact" value={fmtDate(l.lastContactAt)} />
        <FieldRow label="Next follow-up" value={fmtDate(l.nextFollowUpAt)} />
      </Section>
      {Array.isArray(l.interestProducts) && l.interestProducts.length > 0 && (
        <Section title="Interested in" icon="tag">
          <View style={styles.tags}>{l.interestProducts.map((p: string) => <View key={p} style={styles.tag}><Text variant="caption" style={{ color: palette.brand }}>{p}</Text></View>)}</View>
        </Section>
      )}
      {l.notes ? <Section title="Notes" icon="edit-3"><Text variant="caption" tone="muted">{l.notes}</Text></Section> : null}
    </View>
  );
}

function Activity({ d }: { d: any }) {
  const tasks: any[] = d.tasks ?? [];
  const comms: any[] = d.communications ?? [];
  return (
    <View>
      {/* The CRM's Notes feed: calls, visits and notes logged anywhere (the app's
          call log included) plus the lead's older follow-up notes. */}
      <RecordNotes type="lead" id={d.lead.id} />
      {/* Attachments — they move to the client when the lead converts. */}
      <DocumentsSection id={d.lead.id} subject="lead" clientName={d.lead.name} />
      <Section title="Tasks" icon="check-square" right={<Text variant="caption" tone="faint">{tasks.length}</Text>}>
        {tasks.length === 0 ? <Empty text="No tasks." /> : tasks.slice(0, 15).map((t) => (
          <View key={t.id} style={styles.row}>
            <Feather name={t.status === "completed" ? "check-circle" : "circle"} size={13} color={t.status === "completed" ? palette.success : palette.faint} />
            <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>{t.title}</Text>
            <Text variant="caption" tone="faint">{t.dueAt ? fmtDate(t.dueAt) : titleCase(t.priority)}</Text>
          </View>
        ))}
      </Section>
      <Section title="Communications" icon="message-circle" right={<Text variant="caption" tone="faint">{comms.length}</Text>}>
        {comms.length === 0 ? <Empty text="No messages." /> : comms.slice(0, 15).map((c) => (
          <View key={c.id} style={styles.row}>
            <Feather name={c.channel === "whatsapp" ? "message-circle" : c.channel === "email" ? "mail" : "message-square"} size={13} color={c.direction === "inbound" ? palette.info : palette.brand} />
            <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>{String(c.payload?.rendered?.text ?? c.templateKey ?? titleCase(c.channel)).slice(0, 70)}</Text>
            <Text variant="caption" tone="faint">{timeAgo(c.createdAt)}</Text>
          </View>
        ))}
      </Section>
    </View>
  );
}

// ── Action sheets ─────────────────────────────────────────────────────────────
function LogActivitySheet({ visible, initialType, onClose, onSubmit, pending }: { visible: boolean; initialType: string; onClose: () => void; onSubmit: (v: { note: string; activityType: string; nextFollowUpAt?: string }) => Promise<void>; pending: boolean }) {
  const [note, setNote] = useState("");
  const [type, setType] = useState(initialType);
  // Opened from the journey's "Call Done" / "Meeting Done": start on that type
  // (logging it is what moves the lead on).
  useEffect(() => { if (visible) setType(initialType); }, [visible, initialType]);
  const [next, setNext] = useState("");
  const submit = async () => { if (!note.trim()) { toast.error("Write what happened first"); return; } if (next && !Number.isFinite(new Date(next).getTime())) { toast.error("Choose a valid follow-up time"); return; } try { await onSubmit({ note: note.trim(), activityType: type, nextFollowUpAt: next ? new Date(next).toISOString() : undefined }); setNote(""); setNext(""); setType("note"); } catch { /* Mutation displays the error; preserve the draft. */ } };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={type === "call" ? "Log the call" : type === "meeting" ? "Log the meeting" : "Log activity"}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}><Segmented<string> options={ACTIVITY_TYPES} value={type} onChange={setType} /></ScrollView>
      <View style={{ height: spacing.md }} />
      <TextField label="Note" value={note} onChangeText={setNote} placeholder="What happened?" multiline required />
      <FollowUpField value={next} onChange={setNext} />
      <View style={{ height: spacing.md }} />
      <Button label="Save activity" full loading={pending} onPress={submit} />
    </BottomSheet>
  );
}

function ConvertSheet({ visible, onClose, onSubmit, pending, defaultPan, error }: { visible: boolean; onClose: () => void; onSubmit: (v: { pan?: string; segmentTag: string; investorCategory: string }) => void; pending: boolean; defaultPan?: string | null; error?: string }) {
  const [pan, setPan] = useState(defaultPan ?? "");
  const [segment, setSegment] = useState("Retail");
  const [category, setCategory] = useState("individual");
  // PAN is optional; a typed one must look like ABCDE1234F (the convert route's rule).
  const panBad = pan.trim() !== "" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim());
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Convert to client">
      <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>Creates a client from this lead and carries over risk profile, proposals, meetings and documents.</Text>
      <TextField label="PAN (optional)" value={pan} onChangeText={(v) => setPan(v.toUpperCase().replace(/\s/g, "").slice(0, 10))} placeholder="ABCDE1234F" autoCapitalize="characters" error={panBad && pan.trim().length >= 10 ? "PAN must look like ABCDE1234F" : undefined} />
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Segment</Text>
      <Segmented<string> options={SEGMENTS} value={segment} onChange={setSegment} />
      <View style={{ height: spacing.md }} />
      <SelectField label="Category" value={category} options={CATEGORIES} onChange={setCategory} />
      {error ? <Text variant="caption" style={{ color: palette.danger, marginTop: spacing.sm }}>{error}</Text> : null}
      <View style={{ height: spacing.md }} />
      <Button label="Convert to client" full loading={pending} disabled={panBad}
        onPress={() => onSubmit({ pan: pan.trim() || undefined, segmentTag: segment, investorCategory: category })} icon={<Feather name="user-check" size={15} color="#fff" />} />
    </BottomSheet>
  );
}

// ── bits ──────────────────────────────────────────────────────────────────────
function Badge({ label, tone }: { label: string; tone: string }) {
  return <View style={[styles.badge, { backgroundColor: tone + "1A" }]}><Text style={{ fontSize: 11, color: tone, fontWeight: fontWeight.semibold }}>{label}</Text></View>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={{ fontWeight: fontWeight.bold }}>{value}</Text><Text variant="caption" tone="muted">{label}</Text></View>;
}
function ContactBtn({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.contactBtn, disabled && { opacity: 0.4 }]}>
      <Feather name={asIcon(icon)} size={16} color={palette.brand} />
      <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.medium }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  hero: { backgroundColor: palette.surface, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  heroTop: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  badgeRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", alignItems: "center" },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  stats: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  stat: { flex: 1 },
  contactRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  contactBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: palette.brandLight, borderRadius: radius.md, paddingVertical: spacing.sm },
  tabBar: { backgroundColor: palette.surfaceAlt, paddingVertical: spacing.sm },
  step: { width: 74, alignItems: "center", gap: 4 },
  node: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stepLabel: { textAlign: "center", fontSize: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: { backgroundColor: palette.brandLight, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
});
