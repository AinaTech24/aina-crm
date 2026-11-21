/**
 * Client 360 detail — web-parity. Pinned hero (avatar + health, PAN, segment/KYC
 * badges, contact + verify pills, AUM/SIP/inflow/XIRR rail), one-tap call /
 * WhatsApp / email, an actions sheet (edit / statement / delete), and the four
 * tabs (Overview / Portfolio / KYC & Profile / Engagement) off GET
 * /api/investors/[id]/full.
 */

import React, { useState, useEffect } from "react";
import { View, ScrollView, Pressable, Image, Linking, RefreshControl, StyleSheet, Alert } from "react-native";
import { toast } from "../../../../src/lib/toast";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { SavedCopyBanner } from "../../../../src/components/SavedCopyBanner";
import { useConnectivity } from "../../../../src/state/connectivity";
import { OverviewTab } from "../../../../src/features/investors/detail/OverviewTab";
import { PortfolioTab } from "../../../../src/features/investors/detail/PortfolioTab";
import { ProfileTab } from "../../../../src/features/investors/detail/ProfileTab";
import { EngagementTab } from "../../../../src/features/investors/detail/EngagementTab";
import { AiBriefSheet } from "../../../../src/features/investors/detail/AiBriefSheet";
import { QuickCommsSheet } from "../../../../src/features/investors/detail/QuickCommsSheet";
import { OnboardingWizardSheet } from "../../../../src/features/investors/detail/OnboardingWizardSheet";
import { avatarUri, useAvatarHeaders, useUploadAvatar } from "../../../../src/features/investors/detail/subfeatures";
import { useInvestorFull, useVerifyContact, useSendStatement, useDeleteInvestor, useSetClientStatus } from "../../../../src/features/investors/api";
import { confirmDelete } from "../../../../src/lib/confirm";
import { inr, initials, fmtDate } from "../../../../src/lib/format";
import { investorStatusBadge, kycBadge } from "../../../../src/lib/status";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";
import { startCall } from "../../../../src/features/activities/callAndLog";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { AssignOpsSheet } from "../../../../src/features/tasks/AssignOpsSheet";
import { ownPan } from "../../../../src/features/investors/client-types";
import { useRecentlyViewed } from "../../../../src/state/recentlyViewed";
import { useBrand } from "../../../../src/theme/brand";
import { asIcon } from "../../../../src/lib/icons";

type Tab = "overview" | "portfolio" | "profile" | "engagement";
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "portfolio", label: "Portfolio" },
  { key: "profile", label: "KYC & Profile" },
  { key: "engagement", label: "Engagement" },
];
const HEALTH_DOT: Record<string, string> = { green: palette.success, amber: palette.warning, red: palette.danger };
const waNumber = (p?: string | null) => (p ? p.replace(/[^\d]/g, "").replace(/^0+/, "") : "");

export default function InvestorDetail() {
  // ?opportunity=new&product= — "Start opportunity" from the New lead form's
  // existing-client match opens New opportunity here (web #opportunities).
  const { id, opportunity, product } = useLocalSearchParams<{ id: string; opportunity?: string; product?: string }>();
  const router = useRouter();
  const { brand } = useBrand();
  const { data: d, isLoading, isError, refetch, isRefetching, dataUpdatedAt } = useInvestorFull(id);
  // No signal: show the copy saved on this phone (persisted cache, 24 h) instead of an error.
  const offline = useConnectivity((s) => !s.online);
  const verify = useVerifyContact(id!);
  const statement = useSendStatement(id!);
  const del = useDeleteInvestor();
  const exit = useSetClientStatus(id!);
  const avatar = useUploadAvatar(id!);
  const avatarHeaders = useAvatarHeaders();
  const [tab, setTab] = useState<Tab>("overview");
  const [actions, setActions] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [commsOpen, setCommsOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);

  useEffect(() => {
    const inv = (d as any)?.investor;
    if (inv?.id) useRecentlyViewed.getState().add({ type: "investor", id: inv.id, name: inv.name });
  }, [(d as any)?.investor?.id]);

  const pickAvatar = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      avatar.mutate({ uri: a.uri, name: a.fileName ?? `avatar-${Date.now()}.jpg`, mime: a.mimeType ?? "image/jpeg", clientName: (d as any)?.investor?.name });
    }
  };

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Client" /><LoadingState label="Loading client…" /></View>;
  if (!d?.investor) return <View style={styles.screen}><ScreenHeader title="Client" /><ErrorState onRetry={refetch} /></View>;
  const savedCopy = isError || offline;

  const i = d.investor;
  const status = investorStatusBadge(i.status);
  const kyc = kycBadge(i.kycStatus);
  const phone = i.phone as string | null;
  const email = i.email as string | null;
  const v = d.valuation ?? {};

  const exited = i.status === "exited" || i.status === "closed";
  const doExit = () => {
    setActions(false);
    Alert.alert(
      exited ? `Reactivate ${i.name}?` : `Mark ${i.name} as exited?`,
      exited
        ? "The client goes back to Active, in the client list and the dashboards."
        : "The client leaves the client list and the dashboard counts, but nothing is deleted — history, family, RM, notes and documents stay. When they invest again the CRM makes them Active by itself.",
      [
        { text: "Cancel", style: "cancel" },
        { text: exited ? "Reactivate" : "Mark as exited", onPress: () => exit.mutate(exited ? "active" : "exited", { onSuccess: () => toast.success(exited ? `${i.name} is Active again` : `${i.name} marked as exited`) }) },
      ],
    );
  };
  const inactive = i.status === "inactive";
  const doInactive = () => {
    setActions(false);
    Alert.alert(
      inactive ? `Mark ${i.name} as Active?` : `Mark ${i.name} as Inactive?`,
      inactive
        ? "The client goes back to Active. SIPs that were stopped stay stopped — a stopped SIP is restarted by a new registration."
        : "Their active SIPs will be stopped and orders still pending will be cancelled in the CRM. Processed transactions are kept as history. Use this when the client has stopped investing or has passed away (record the date of death on their details).",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: inactive ? "Mark active" : "Mark inactive",
          onPress: () => exit.mutate(inactive ? "active" : "inactive", {
            onSuccess: (r: any) => {
              const d = r?.demise;
              toast.success(inactive ? `${i.name} is Active again` : `${i.name} marked Inactive${d ? ` — ${d.sipsStopped} SIP${d.sipsStopped === 1 ? "" : "s"} stopped, ${d.ordersCancelled} pending order${d.ordersCancelled === 1 ? "" : "s"} cancelled` : ""}`);
            },
          }),
        },
      ],
    );
  };
  const doDelete = () => {
    setActions(false);
    confirmDelete(
      {
        title: `Delete ${i.name}?`,
        message: exited
          ? "The client moves to Trash and can be restored within 30 days."
          : "The client moves to Trash and can be restored within 30 days. A client who has left but may come back is better marked as exited — nothing is lost.",
        confirmLabel: "Delete",
      },
      // A client who holds money with the registrar is kept; the server says why (toasted).
      () => del.mutate(id!, { onSuccess: () => { toast.success(`${i.name} moved to Trash`); router.back(); } })
    );
  };
  // What the family owns is not asked again on the edit form: a member's
  // address is the head's and everyone's review frequency is the family's
  // (the CRM's investor PATCH ignores both). The form is told which applies.
  const fam = d.family as { primaryInvestorId?: string | null; reviewFrequency?: string | null; familyName?: string | null } | null;
  const editHref = () => {
    const p = new URLSearchParams({ editId: String(id) });
    if (fam?.primaryInvestorId && fam.primaryInvestorId !== i.id) p.set("famMember", "1");
    if (fam?.reviewFrequency) p.set("famReview", fam.reviewFrequency);
    if (fam?.familyName) p.set("famName", fam.familyName);
    return `/m/investors/new?${p.toString()}`;
  };
  const sendStatement = (channel: "email" | "whatsapp") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    statement.mutate(channel, {
      onSuccess: (r) => { setActions(false); if (r?.waUrl) Linking.openURL(r.waUrl).catch(() => {}); },
    });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={i.name}
        right={<Pressable accessibilityRole="button" accessibilityLabel="More actions" onPress={() => setActions(true)} hitSlop={10}><Feather name="more-vertical" size={20} color={palette.ink} /></Pressable>}
      />
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
            <Pressable style={[styles.avatar, { backgroundColor: palette.brandLight }]} onPress={pickAvatar} disabled={avatar.isPending}>
              {i.avatarUrl ? (
                <Image source={{ uri: `${avatarUri(id!)}?t=${i.updatedAt ?? ""}`, headers: avatarHeaders }} style={styles.avatarImg} />
              ) : (
                <Text style={{ color: palette.brandDark, fontWeight: "700", fontSize: 18 }}>{initials(i.name)}</Text>
              )}
              <View style={styles.camBadge}><Feather name={avatar.isPending ? "loader" : "camera"} size={10} color="#fff" /></View>
              {i.healthBand ? <View style={[styles.dot, { backgroundColor: HEALTH_DOT[i.healthBand] ?? palette.faint }]} /> : null}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="muted">{ownPan(i.pan) || "PAN —"}</Text>
              <View style={styles.badgeRow}>
                {i.segmentTag ? <Badge label={i.segmentTag} tone={palette.violet} /> : null}
                <Badge label={status.label} tone={status.tone === "success" ? palette.success : status.tone === "danger" ? palette.danger : palette.muted} />
                <Badge label={kyc.label} tone={kyc.tone === "success" ? palette.success : palette.warning} />
              </View>
              <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
                {i.onboardedAt ? `Onboarded ${fmtDate(i.onboardedAt)}` : ""}{i.address?.city ? ` · ${i.address.city}` : ""}
              </Text>
            </View>
          </View>

          {/* KPI rail */}
          <View style={styles.rail}>
            <Rail label="AUM" value={inr(i.aum)} />
            <Rail label="Active SIP" value={inr(i.activeSipAmount)} />
            <Rail label="Inflow" value={inr(i.lifetimeInflow)} />
            <Rail label="XIRR" value={v.xirr != null ? `${Number(v.xirr).toFixed(1)}%` : "—"} />
          </View>

          {/* Verify pills */}
          <View style={styles.verifyRow}>
            <VerifyPill label="Email" verified={!!i.emailVerifiedAt} onPress={() => email && verify.mutate({ channel: "email", verified: !i.emailVerifiedAt })} disabled={!email || verify.isPending} />
            <VerifyPill label="Phone" verified={!!i.phoneVerifiedAt} onPress={() => phone && verify.mutate({ channel: "phone", verified: !i.phoneVerifiedAt })} disabled={!phone || verify.isPending} />
          </View>

          {/* A recorded date of death: the client is Inactive and never contacted as if alive. */}
          {i.dateOfDemise ? (
            <View style={styles.deceased}>
              <Text variant="caption" style={{ color: palette.danger, fontWeight: "700" }}>Deceased — {fmtDate(i.dateOfDemise)}.</Text>
              <Text variant="caption" tone="muted">The client is Inactive; their SIPs were stopped and pending orders cancelled when the date was recorded.</Text>
            </View>
          ) : (
            <View style={styles.contactRow}>
              <ContactBtn icon="phone" label="Call" disabled={!phone} onPress={() => phone && startCall({ subjectType: "investor", subjectId: i.id, name: i.name ?? "Client", phone })} />
              <ContactBtn icon="message-circle" label="WhatsApp" disabled={!phone} onPress={() => phone && openWhatsApp({ phone, subjectType: "investor", subjectId: i.id, name: i.name })} />
              <ContactBtn icon="mail" label="Email" disabled={!email} onPress={() => email && Linking.openURL(`mailto:${email}`)} />
            </View>
          )}
        </View>

        {/* Sticky tab bar */}
        <View style={styles.tabBar}>
          <Segmented<Tab> options={TABS as any} value={tab} onChange={setTab} />
        </View>

        <Animated.View key={tab} entering={FadeIn.duration(220)}>
          {tab === "overview" ? <OverviewTab d={d} id={id!} startOpportunity={opportunity === "new" ? product ?? "" : undefined} />
            : tab === "portfolio" ? <PortfolioTab d={d} />
            : tab === "profile" ? <ProfileTab d={d} />
            : <EngagementTab d={d} id={id!} />}
        </Animated.View>
      </ScrollView>

      {/* Actions sheet */}
      <BottomSheet visible={actions} onClose={() => setActions(false)} title={i.name}>
        <Button label="Edit client" variant="secondary" full icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => { setActions(false); router.push(editHref() as any); }} style={{ marginBottom: spacing.sm }} />
        <Button label="AI client brief" variant="secondary" full icon={<Feather name="zap" size={15} color={palette.ink} />} onPress={() => { setActions(false); setAiOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Quick comms" variant="secondary" full icon={<Feather name="send" size={15} color={palette.ink} />} onPress={() => { setActions(false); setCommsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Send a form" variant="secondary" full icon={<Feather name="file-text" size={15} color={palette.ink} />} onPress={() => { setActions(false); setFormOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Assign to team" variant="secondary" full icon={<Feather name="users" size={15} color={palette.ink} />} onPress={() => { setActions(false); setOpsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Onboarding wizard" variant="secondary" full icon={<Feather name="check-square" size={15} color={palette.ink} />} onPress={() => { setActions(false); setOnboardOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Email statement" variant="secondary" full loading={statement.isPending} icon={<Feather name="file-text" size={15} color={palette.ink} />} onPress={() => sendStatement("email")} style={{ marginBottom: spacing.sm }} />
        <Button label="WhatsApp statement" variant="secondary" full loading={statement.isPending} icon={<Feather name="message-circle" size={15} color={palette.ink} />} onPress={() => sendStatement("whatsapp")} style={{ marginBottom: spacing.sm }} />
        {!exited ? <Button label={inactive ? "Mark active" : "Mark inactive"} variant="secondary" full loading={exit.isPending} icon={<Feather name={inactive ? "user-check" : "user-x"} size={15} color={palette.ink} />} onPress={doInactive} style={{ marginBottom: spacing.sm }} /> : null}
        <Button label={exited ? "Reactivate client" : "Mark as exited"} variant="secondary" full loading={exit.isPending} icon={<Feather name={exited ? "rotate-ccw" : "log-out"} size={15} color={palette.ink} />} onPress={doExit} style={{ marginBottom: spacing.sm }} />
        <Button label="Delete client" variant="danger" full loading={del.isPending} icon={<Feather name="trash-2" size={15} color="#fff" />} onPress={doDelete} />
      </BottomSheet>

      <AiBriefSheet id={id!} visible={aiOpen} onClose={() => setAiOpen(false)} phone={phone} />
      <QuickCommsSheet id={id!} visible={commsOpen} onClose={() => setCommsOpen(false)} />
      <OnboardingWizardSheet id={id!} visible={onboardOpen} onClose={() => setOnboardOpen(false)} investor={i} />
      <SendFormSheet visible={formOpen} onClose={() => setFormOpen(false)} subjectType="investor" subjectId={id!} name={i.name} />
      <AssignOpsSheet visible={opsOpen} onClose={() => setOpsOpen(false)} subjectType="investor" subjectId={id!} subjectName={i.name} />
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return <View style={[styles.badge, { backgroundColor: tone + "1A" }]}><Text style={{ fontSize: 11, color: tone, fontWeight: fontWeight.semibold }}>{label}</Text></View>;
}
function Rail({ label, value }: { label: string; value: string }) {
  return <View style={styles.railCell}><Text variant="caption" tone="muted">{label}</Text><Text style={{ fontWeight: fontWeight.bold }} numberOfLines={1}>{value}</Text></View>;
}
function VerifyPill({ label, verified, onPress, disabled }: { label: string; verified: boolean; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.verifyPill, verified && { backgroundColor: palette.successBg, borderColor: palette.success }, disabled && { opacity: 0.5 }]}>
      <Feather name={verified ? "check-circle" : "shield"} size={12} color={verified ? palette.success : palette.muted} />
      <Text style={{ fontSize: 11, color: verified ? palette.success : palette.muted, fontWeight: fontWeight.medium }}>{label}{verified ? " verified" : ""}</Text>
    </Pressable>
  );
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
  deceased: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.danger + "4D", backgroundColor: palette.danger + "0D", gap: 2 },
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  hero: { backgroundColor: palette.surface, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  heroTop: { flexDirection: "row", gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", overflow: "visible" },
  avatarImg: { width: 52, height: 52, borderRadius: 26 },
  camBadge: { position: "absolute", right: -2, top: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.surface },
  dot: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: palette.surface },
  badgeRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 4, alignItems: "center" },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  rail: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  railCell: { flex: 1 },
  verifyRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  verifyPill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: palette.line, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  contactRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  contactBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: palette.brandLight, borderRadius: radius.md, paddingVertical: spacing.sm },
  tabBar: { backgroundColor: palette.surfaceAlt, paddingVertical: spacing.sm },
});
