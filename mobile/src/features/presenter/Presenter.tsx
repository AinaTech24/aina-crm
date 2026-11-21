/**
 * Presenter mode — the phone turned to the client: a full-screen, read-only
 * view with the firm's logo and name on top, large type, and the compliance
 * text at the foot. Nothing internal reaches it; each caller hands it only
 * the client-facing content (CalculatorPresentation / ProposalPresentation).
 *
 *  - The status bar is hidden while it is open. A native modal copies the
 *    status bar's state when it opens (RN's Modal on both platforms), so
 *    `open()` hides the bar first and shows the modal a frame later; the
 *    <StatusBar hidden /> inside keeps it hidden, and closing restores it.
 *  - Keep-awake is not wired: expo-keep-awake is not a declared dependency.
 *  - One clear Close button (and the Android back gesture). No editing.
 */

import React from "react";
import { Modal, View, ScrollView, Pressable, StyleSheet } from "react-native";
import { StatusBar, setStatusBarHidden } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { useTheme } from "../../theme";
import { useBrand } from "../../theme/brand";
import { spacing, radius, fontWeight } from "../../theme/tokens";
import { absUrl } from "../../api/client";
import { useTenant } from "../settings/api";
import { initials } from "../../lib/format";
import { AMFI_TAGLINE, formatArn } from "./disclosures";

/** Open / close the presenter, hiding the status bar around it. */
export function usePresenter() {
  const [visible, setVisible] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = React.useCallback(() => {
    setStatusBarHidden(true, "fade");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), 80);
  }, []);
  const close = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
    setStatusBarHidden(false, "fade");
  }, []);
  // A screen left while presenting must not leave the bar hidden.
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    setStatusBarHidden(false, "none");
  }, []);
  return { visible, open, close };
}

/** The firm as the client should see it: name, logo, tagline, ARN. */
export function useFirm() {
  const { data } = useTenant();
  const t: any = data?.tenant ?? data ?? {};
  return {
    name: String(t.displayName || t.legalName || "Your mutual fund distributor"),
    logo: absUrl(t.logoUrl),
    arn: formatArn(t.arn),
    arnRaw: (t.arn as string | null | undefined) ?? null,
    email: (t.email as string | null | undefined) ?? null,
    phone: (t.phone as string | null | undefined) ?? null,
  };
}

/** The screen stays on while a client is looking at it. Mounted only while presenting. */
function StayAwake() {
  useKeepAwake("presenter");
  return null;
}

export function Presenter({ visible, onClose, title, subtitle, footer, children }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  /** Compliance text — shown in full at the foot, never cut. */
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const { color } = useTheme();
  const { brand } = useBrand();
  const insets = useSafeAreaInsets();
  const firm = useFirm();

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <StatusBar hidden />
      {visible ? <StayAwake /> : null}
      <View style={[styles.screen, { backgroundColor: color.surfaceAlt, paddingTop: Math.max(insets.top, spacing.md) }]}>
        <View style={[styles.bar, { borderBottomColor: color.line }]}>
          {firm.logo ? (
            <Image source={{ uri: firm.logo }} style={[styles.logo, { backgroundColor: color.surface }]} contentFit="contain" accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.logo, { backgroundColor: brand, alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: color.white, fontWeight: fontWeight.bold, fontSize: 18 }}>{initials(firm.name) || "F"}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text variant="subtitle" numberOfLines={2}>{firm.name}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>{[AMFI_TAGLINE, firm.arn].filter(Boolean).join(" · ")}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close presenter" hitSlop={10}
            style={({ pressed }) => [styles.close, { backgroundColor: color.surface, borderColor: color.line, opacity: pressed ? 0.7 : 1 }]}>
            <Feather name="x" size={22} color={color.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing["3xl"] }}>
          <Text variant="title">{title}</Text>
          {subtitle ? <Text variant="body" tone="muted" style={{ marginTop: spacing.xs }}>{subtitle}</Text> : null}
          <View style={{ marginTop: spacing.xl, gap: spacing.md }}>{children}</View>
          <View style={[styles.footer, { borderTopColor: color.line }]}>{footer}</View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A headline figure: label, the number in display type, a short line under it. */
export function BigFigure({ label, value, sub, fg, bg }: { label: string; value: string; sub?: string; fg?: string; bg?: string }) {
  const { color } = useTheme();
  return (
    <View style={[styles.figure, { backgroundColor: bg ?? color.surface, borderColor: color.line }]}>
      <Text variant="subtitle" style={{ color: fg ?? color.ink70 }}>{label}</Text>
      <Text variant="display" style={{ color: fg ?? color.ink, marginTop: 2 }} adjustsFontSizeToFit numberOfLines={1}>{value}</Text>
      {sub ? <Text variant="body" style={{ color: fg ?? color.muted, opacity: fg ? 0.85 : 1 }}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  logo: { width: 48, height: 48, borderRadius: radius.md },
  close: { width: 48, height: 48, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  footer: { marginTop: spacing["2xl"], paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  figure: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
});
