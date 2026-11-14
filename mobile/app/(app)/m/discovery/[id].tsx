/**
 * One fact-find — the in-meeting editor (the CRM's /dashboard/discovery/[id]):
 * what the client changed that the record does not have yet, a client share
 * link (WhatsApp / email from the RM's own phone), the ten sections with a
 * live health snapshot, and Save draft / Mark reviewed.
 *
 * Saves as you type (two seconds after the last edit), exactly as the web
 * editor does, and saves once more on the way out; a save that fails says so
 * and keeps the edits on screen.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView, Pressable, KeyboardAvoidingView, Platform, Share, Linking, Alert, StyleSheet } from "react-native";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { ApiError } from "../../../../src/api/client";
import { useMe, hasCap, hasAnyCap, type Me } from "../../../../src/api/me";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import {
  useDiscovery, useSaveDiscovery, useShareDiscovery, useSaveRiskProfile, useSubjectRecord, STATUS_TONE,
  type Discovery, type DiscoveryResponse, type ShareResult,
} from "../../../../src/features/discovery/api";
import { computeDiscovery, type DiscoveryData } from "../../../../src/features/discovery/calc";
import { checkDiscovery } from "../../../../src/features/discovery/checks";
import { DiscoveryForm, SECTIONS, filledSections, sectionOfError, upgradeIncome, type SectionKey } from "../../../../src/features/discovery/DiscoveryForm";
import { HealthSnapshot, scoreColor } from "../../../../src/features/discovery/HealthSnapshot";
import { RecordChanges } from "../../../../src/features/discovery/RecordChanges";
import { recordDiffs, recordFromApi } from "../../../../src/features/discovery/record-diff";
import { indiaToday } from "../../../../src/features/discovery/today";
import { toast } from "../../../../src/lib/toast";
import { titleCase } from "../../../../src/lib/format";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

const seed = (d: DiscoveryData | null | undefined): DiscoveryData => {
  const data = (d ?? {}) as DiscoveryData;
  return { ...data, income: upgradeIncome(data.income) };
};

/** wa.me wants the number with its country code and nothing else (web rule). */
function waNumber(phone: string | null): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
}

/** May the viewer change the record behind the fact-find? The server decides
 *  (assertCanEditSubject); this only hides ticks that would be refused. */
function mayEditSubject(me: Me | undefined, subjectType: string, rec: Record<string, any> | null | undefined): boolean {
  if (!me || !rec) return false;
  const caps = me.capabilities;
  const roles = me.user.roles ?? [];
  const branchScoped = !roles.includes("owner") && roles.includes("branch_head") && !!me.user.branchId;
  if (subjectType === "lead") {
    if (!hasAnyCap(caps, ["lead.edit.all", "lead.edit.assigned"])) return false;
    if (branchScoped) return rec.branchId === me.user.branchId;
    return hasCap(caps, "lead.edit.all") || rec.ownerId === me.user.id;
  }
  if (!hasAnyCap(caps, ["investor.edit.all", "investor.edit.assigned"])) return false;
  if (hasCap(caps, "investor.edit.all")) return true;
  return branchScoped ? rec.branchId === me.user.branchId : rec.rmId === me.user.id;
}

export default function DiscoveryEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useDiscovery(id);
  const disc = q.data?.discovery;
  if (q.isLoading) return <View style={styles.page}><ScreenHeader title="Discovery" /><LoadingState /></View>;
  if (q.isError || !disc) return <View style={styles.page}><ScreenHeader title="Discovery" /><ErrorState onRetry={q.refetch} /></View>;
  return <Editor key={disc.id} disc={disc} response={q.data!} refetch={q.refetch} />;
}

function Editor({ disc, response, refetch }: { disc: Discovery; response: DiscoveryResponse; refetch: () => Promise<{ data?: DiscoveryResponse }> }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { data: me } = useMe();
  const subject = { type: disc.subjectType, id: disc.subjectId };
  const subjectHref = disc.subjectType === "lead" ? `/m/leads/${disc.subjectId}` : `/m/investors/${disc.subjectId}`;

  const [data, setData] = useState<DiscoveryData>(() => seed(disc.data));
  const today = indiaToday();
  const c = useMemo(() => computeDiscovery(data, { today }), [data, today]);
  const errors = useMemo(() => checkDiscovery(data, { today }), [data, today]);
  const errorCount = Object.keys(errors).length;
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { if (!errorCount) setBlocked(false); }, [errorCount]);

  const saveMut = useSaveDiscovery(disc.id);
  const shareMut = useShareDiscovery(disc.id);
  const riskMut = useSaveRiskProfile(disc.id);

  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v); };
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [share, setShare] = useState<ShareResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [riskSaving, setRiskSaving] = useState(false);
  const latest = useRef<DiscoveryData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(true); // the first render is not an edit

  /** PATCH the fact-find. Returns null when saved, else the message to show. */
  const save = async (d: DiscoveryData, extra?: { markReviewed?: boolean }): Promise<string | null> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaveError(null);
    try {
      await saveMut.mutateAsync({ data: d, ...extra });
      if (latest.current === d) setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      return null;
    } catch (e) {
      const msg = e instanceof ApiError && e.kind === "http"
        ? e.message || "Could not save — your changes are still on this page."
        : "No connection — your changes are still on this page.";
      setSaveError(msg);
      return msg;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Autosave two seconds after the last edit.
  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    latest.current = data;
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveRef.current(data); }, 2000);
  }, [data]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Leaving with unsaved edits: save them first; if that fails, ask.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      if (!dirtyRef.current || !latest.current) return;
      e.preventDefault();
      void saveRef.current(latest.current).then((err) => {
        if (!err) { navigation.dispatch(e.data.action); return; }
        Alert.alert("Not saved", err, [
          { text: "Stay", style: "cancel" },
          { text: "Leave anyway", style: "destructive", onPress: () => { dirtyRef.current = false; navigation.dispatch(e.data.action); } },
        ]);
      });
    });
    return unsub;
  }, [navigation]);

  /* ── scrolling to a section ─────────────────────────────────────────── */
  const scrollRef = useRef<ScrollView>(null);
  const formY = useRef(0);
  const snapY = useRef(0);
  const navH = useRef(0);
  const sectionY = useRef<Partial<Record<SectionKey, number>>>({});
  const onSectionLayout = useCallback((k: SectionKey, y: number) => { sectionY.current[k] = y; }, []);
  const scrollToY = (y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y - navH.current - spacing.sm), animated: true });
  const goSection = (k: SectionKey) => scrollToY(formY.current + (sectionY.current[k] ?? 0));

  /* ── actions ────────────────────────────────────────────────────────── */
  const saveDraft = async () => {
    latest.current = data;
    const err = await save(data);
    if (err) toast.error(err); else toast.success("Saved");
  };

  const markReviewed = async () => {
    if (errorCount) {
      setBlocked(true);
      const first = Object.keys(errors).map(sectionOfError)
        .sort((a, b) => SECTIONS.findIndex(([k]) => k === a) - SECTIONS.findIndex(([k]) => k === b))[0];
      if (first) goSection(first);
      return;
    }
    latest.current = data;
    const err = await save(data, { markReviewed: true });
    if (err) toast.error(err); else toast.success("Marked reviewed");
  };

  const makeLink = async () => {
    setShare(null);
    // The client opens what is saved — save pending edits first.
    if (dirtyRef.current && latest.current) await save(latest.current);
    shareMut.mutate(undefined, { onSuccess: (r) => setShare({ ...r, recipient: r.recipient ?? { name: null, phone: null, email: null } }) });
  };

  const saveRisk = async () => {
    setNotice(null);
    setRiskSaving(true);
    try {
      if (dirtyRef.current && latest.current) {
        const err = await save(latest.current);
        if (err) { toast.error(err); return; }
      }
      let r: { bandLabel?: string };
      try { r = await riskMut.mutateAsync(); } catch { return; } // the server's reason is toasted
      // Reload so section 10 shows the profile now on record.
      const fresh = await refetch().catch(() => null);
      const fd = fresh?.data?.discovery?.data;
      if (fd) {
        skipNext.current = true;
        latest.current = null;
        setDirty(false);
        setData(seed(fd));
      }
      setNotice(`Saved ${r.bandLabel ?? "the risk profile"} as a provisional risk profile. The client confirms it from Risk Profiles.`);
    } finally {
      setRiskSaving(false);
    }
  };

  /* ── what the client changed that the record does not have ──────────── */
  const reviewedish = disc.status === "submitted" || disc.status === "reviewed";
  const serverDiffs = Array.isArray(response.diffs) ? response.diffs : null;
  const record = useSubjectRecord(disc.subjectType, disc.subjectId, reviewedish && !serverDiffs);
  const diffs = useMemo(
    () => (!reviewedish ? [] : serverDiffs ?? recordDiffs(recordFromApi(disc.subjectType, record.data), disc.subjectType, (disc.data ?? {}) as DiscoveryData)),
    [reviewedish, serverDiffs, record.data, disc.subjectType, disc.data],
  );
  const canEdit = serverDiffs ? !!response.canEdit : mayEditSubject(me, disc.subjectType, record.data);
  const canSaveRisk = disc.subjectType === "investor" && hasAnyCap(me?.capabilities, ["investor.edit.all", "investor.edit.assigned"]);

  /* ── progress ───────────────────────────────────────────────────────── */
  const filled = filledSections(data, c);
  const countable = SECTIONS.filter(([k]) => filled[k] !== null);
  const done = countable.filter(([k]) => filled[k]).length;

  const greeting = share?.recipient.name ? `Hi ${share.recipient.name.split(" ")[0]}, ` : "Hi, ";
  const message = share
    ? `${greeting}please fill in this short Financial Health Check before our meeting${share.firmName ? ` — ${share.firmName}` : ""}. You can save and come back to it: ${share.url}`
    : "";
  const wa = share ? waNumber(share.recipient.phone) : null;

  const statusLine = saveError
    ? <Text variant="caption" tone="danger" style={{ flex: 1 }}>{saveError}</Text>
    : saveMut.isPending ? <Text variant="caption" tone="muted" style={{ flex: 1 }}>Saving…</Text>
    : dirty ? <Text variant="caption" tone="muted" style={{ flex: 1 }}>Unsaved changes</Text>
    : savedAt ? <Text variant="caption" tone="muted" style={{ flex: 1 }}>Saved {savedAt}</Text>
    : <View style={{ flex: 1 }} />;

  return (
    <View style={styles.page}>
      {/* A swipe-back cannot wait for the save; the back button and Android back can. */}
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <ScreenHeader title={disc.title || "Discovery & Suitability"} subtitle={disc.reviewType || undefined} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          stickyHeaderIndices={[1]}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing["3xl"] }}
        >
          {/* 0 · record link, record changes, share, notices */}
          <View style={{ padding: spacing.lg, paddingBottom: 0, gap: spacing.md }}>
            <Text variant="label" tone="brand" style={{ fontWeight: fontWeight.semibold }} onPress={() => router.push(subjectHref as any)}>
              {disc.subjectType === "lead" ? "Lead" : "Client"} record →
            </Text>

            {diffs.length ? (
              <RecordChanges discoveryId={disc.id} diffs={diffs} subjectType={disc.subjectType} subjectId={disc.subjectId} canEdit={canEdit} />
            ) : null}

            <Card style={styles.toolbar}>
              <Button label="Share client link" variant="secondary" size="sm" loading={shareMut.isPending} onPress={makeLink} icon={<Feather name="link-2" size={14} color={palette.ink} />} />
              {statusLine}
              <StatusPill label={titleCase(disc.status)} tone={STATUS_TONE[disc.status] ?? "neutral"} size="sm" dot={false} />
            </Card>

            {share ? (
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Feather name="link-2" size={16} color={palette.brandDark} />
                  <Text selectable variant="caption" style={{ flex: 1, color: palette.ink }} numberOfLines={3}>{share.url}</Text>
                </View>
                <View style={styles.shareRow}>
                  <Button label="Share" variant="secondary" size="sm" icon={<Feather name="share-2" size={14} color={palette.ink} />} onPress={() => { Share.share({ message }).catch(() => {}); }} />
                  {wa ? (
                    <Button
                      label="WhatsApp"
                      variant="secondary"
                      size="sm"
                      icon={<Feather name="message-circle" size={14} color={palette.ink} />}
                      onPress={() => openWhatsApp({ phone: wa, text: message, subjectType: disc.subjectType, subjectId: disc.subjectId, name: share.recipient.name, purpose: "Financial Health Check link" })}
                    />
                  ) : null}
                  {share.recipient.email ? (
                    <Button
                      label="Email"
                      variant="secondary"
                      size="sm"
                      icon={<Feather name="mail" size={14} color={palette.ink} />}
                      onPress={() => Linking.openURL(`mailto:${share.recipient.email}?subject=${encodeURIComponent("Your Financial Health Check")}&body=${encodeURIComponent(message)}`).catch(() => toast.error("Couldn't open email"))}
                    />
                  ) : null}
                </View>
                <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Valid 14 days. A new link cancels the earlier ones.</Text>
              </Card>
            ) : null}

            {notice ? (
              <View style={styles.notice}><Text variant="label" style={{ color: palette.ink }}>{notice}</Text></View>
            ) : null}
          </View>

          {/* 1 · progress + jump links (sticky) */}
          <View style={styles.navWrap} onLayout={(e) => { navH.current = e.nativeEvent.layout.height; }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav} keyboardShouldPersistTaps="handled">
              <Pressable onPress={() => scrollToY(snapY.current)} style={[styles.chip, styles.scoreChip]} accessibilityRole="button" accessibilityLabel={`Health score ${c.healthScore ?? "not yet"}`}>
                <Text variant="caption" style={{ color: scoreColor(c.healthScore), fontWeight: fontWeight.bold }}>{c.healthScore ?? "—"}</Text>
                <Text variant="caption" tone="muted">Health</Text>
              </Pressable>
              <Text variant="caption" tone="muted" style={{ alignSelf: "center", fontWeight: fontWeight.semibold }}>{done}/{countable.length} filled</Text>
              {SECTIONS.map(([k, label], i) => (
                <Pressable key={k} onPress={() => goSection(k)} style={[styles.chip, filled[k] ? styles.chipOn : null]} accessibilityRole="button" accessibilityLabel={`${label}${filled[k] ? ", filled" : ""}`}>
                  {filled[k] ? <Feather name="check" size={12} color={palette.success} /> : <Text variant="caption" tone="muted">{i + 1}</Text>}
                  <Text variant="caption" style={{ color: filled[k] ? palette.ink : palette.muted }}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* 2 · the ten sections */}
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }} onLayout={(e) => { formY.current = e.nativeEvent.layout.y + spacing.md; }}>
            <DiscoveryForm
              data={data}
              setData={setData}
              c={c}
              errors={errors}
              subject={subject}
              onSaveRisk={canSaveRisk ? saveRisk : undefined}
              riskSaving={riskSaving}
              onSectionLayout={onSectionLayout}
            />
          </View>

          {/* 3 · the live snapshot */}
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }} onLayout={(e) => { snapY.current = e.nativeEvent.layout.y + spacing.md; }}>
            <HealthSnapshot c={c} />
          </View>

          {/* 4 · actions */}
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
            {blocked && errorCount > 0 ? (
              <Text variant="label" tone="danger" style={{ fontWeight: fontWeight.semibold }}>
                Fix the {errorCount === 1 ? "highlighted field" : `${errorCount} highlighted fields`} first.
              </Text>
            ) : null}
            <Button label="Mark reviewed" onPress={markReviewed} loading={saveMut.isPending} full />
            <Button label="Save draft" variant="secondary" onPress={saveDraft} disabled={saveMut.isPending} full />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.surfaceAlt },
  toolbar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  shareRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  notice: { backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md },
  navWrap: { backgroundColor: palette.surfaceAlt, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  nav: { gap: spacing.xs, paddingHorizontal: spacing.lg, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, minHeight: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.surfaceSunken, borderColor: palette.surfaceSunken },
  scoreChip: { borderColor: palette.line },
});
