/**
 * SwipeableClientRow — a client in the Clients list with swipe actions, like
 * the task list: swipe right → Call (arms the after-call prompt: outcome,
 * notes, next follow-up); swipe left → WhatsApp (logged on the client's
 * timeline) and Follow up (a new task). The swipe only REVEALS the buttons;
 * nothing happens until one is tapped. Tap opens the client, long-press the
 * row actions. A screen reader gets all of them as actions on the row.
 */

import React, { useEffect, useRef } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { InvestorCard } from "../../components/domain/InvestorCard";
import { Text } from "../../components/ui/Text";
import { startCall } from "../activities/callAndLog";
import { openWhatsApp } from "../activities/whatsapp";
import { toast } from "../../lib/toast";
import { healthBadge, kycBadge } from "../../lib/status";
import { palette, spacing, radius, fontWeight } from "../../theme/tokens";
import { aumLabel, clientSubLine, kycNeedsAttention } from "./clientRow";
import { SwipeHint } from "./SwipeHint";
import { markSwipeHintSeen, useSwipeHint } from "./swipeHintStore";
import type { Investor } from "../investors/api";

export function SwipeableClientRow({ investor, rmName, onPress, onLongPress, hintCandidate }: {
  investor: Investor;
  rmName?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
  /** The first row: carries the one-time swipe hint. */
  hintCandidate?: boolean;
}) {
  const router = useRouter();
  const ref = useRef<SwipeableMethods>(null);
  const hint = useSwipeHint("clients");
  // FlashList recycles rows: a row left open must not open on another client.
  useEffect(() => { ref.current?.reset(); }, [investor.id]);

  const phone = investor.phone?.trim() || null;
  const name = investor.name || "Client";
  const call = () => {
    ref.current?.close();
    if (phone) startCall({ subjectType: "investor", subjectId: investor.id, name, phone });
  };
  const whatsApp = () => {
    ref.current?.close();
    Haptics.selectionAsync().catch(() => {});
    if (!openWhatsApp({ phone, subjectType: "investor", subjectId: investor.id, name })) toast.error("This mobile number can't be used for WhatsApp.");
  };
  const followUp = () => {
    ref.current?.close();
    router.push({ pathname: "/m/tasks/new", params: { relatedInvestorId: investor.id, title: "Follow up with " + name } } as any);
  };

  const a11yLabel = [
    name,
    `AUM ${aumLabel(investor.aum)}`,
    investor.healthBand ? healthBadge(investor.healthBand).label : null,
    clientSubLine(investor.pan, rmName),
    kycNeedsAttention(investor.kycStatus) ? kycBadge(investor.kycStatus).label : null,
  ].filter(Boolean).join(", ");

  return (
    <View>
      {hintCandidate && hint.visible ? <SwipeHint text={phone ? "Swipe right to call, left for WhatsApp" : "Swipe left to follow up"} onDismiss={hint.dismiss} /> : null}
      <ReanimatedSwipeable
        ref={ref}
        friction={2}
        leftThreshold={48}
        rightThreshold={48}
        overshootLeft={false}
        overshootRight={false}
        onSwipeableWillOpen={() => markSwipeHintSeen("clients")}
        renderLeftActions={phone ? () => (
          <View style={styles.actions}>
            <Action icon="phone" label="Call" color={palette.success} onPress={call} />
          </View>
        ) : undefined}
        renderRightActions={() => (
          <View style={styles.actions}>
            {phone ? <Action icon="message-circle" label="WhatsApp" color={palette.ink70} onPress={whatsApp} /> : null}
            <Action icon="corner-up-right" label="Follow up" color={palette.brand} onPress={followUp} />
          </View>
        )}
      >
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityActions={[
            { name: "activate", label: "Open" },
            ...(phone ? [{ name: "call", label: "Call" }, { name: "whatsapp", label: "WhatsApp" }] : []),
            { name: "followup", label: "Follow up" },
            ...(onLongPress ? [{ name: "longpress", label: "More actions" }] : []),
          ]}
          onAccessibilityAction={(e) => {
            const a = e.nativeEvent.actionName;
            if (a === "activate") onPress();
            else if (a === "call") call();
            else if (a === "whatsapp") whatsApp();
            else if (a === "followup") followUp();
            else if (a === "longpress") onLongPress?.();
          }}
        >
          <InvestorCard investor={investor} rmName={rmName} onPress={onPress} onLongPress={onLongPress} />
        </View>
      </ReanimatedSwipeable>
    </View>
  );
}

function Action({ icon, label, color, onPress }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.action, { backgroundColor: color }]} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon} size={18} color={palette.white} />
      <Text variant="caption" style={{ color: palette.white, fontWeight: fontWeight.semibold }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // marginBottom matches the card's, so the buttons line up with it.
  actions: { flexDirection: "row", alignItems: "stretch", gap: spacing.xs, marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  action: { width: 84, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 4 },
});
