/**
 * Add a meeting attendee the CRM's way (web AttendeePicker): search team
 * members, clients and leads (GET /api/review-meetings/attendee-search — the
 * server limits clients and leads to the viewer's book), or add the typed name
 * as a guest for someone outside the CRM (a client's CA, an AMC RM).
 */

import React, { useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { SearchBar } from "../../components/ui/SearchBar";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { useAttendeeSearch, roleForKind, ATTENDEE_KIND_LABEL, type MeetingAttendee } from "./api";

export function AttendeePicker({ visible, onClose, onPick, taken }: {
  visible: boolean;
  onClose: () => void;
  onPick: (a: MeetingAttendee) => void;
  /** Already on the meeting — not offered again. */
  taken: MeetingAttendee[];
}) {
  const [q, setQ] = useState("");
  const term = q.trim();
  const search = useAttendeeSearch(term);
  const takenKeys = new Set(taken.filter((a) => a.refId).map((a) => `${a.kind}:${a.refId}`));
  const hits = (search.data ?? []).filter((h) => !takenKeys.has(`${h.kind}:${h.id}`));
  const pick = (a: MeetingAttendee) => { setQ(""); onPick(a); };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add attendee">
      <SearchBar value={q} onChangeText={setQ} placeholder="Search team, clients, leads…" />
      <ScrollView style={{ maxHeight: 380, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {hits.map((h) => (
          <Pressable key={`${h.kind}:${h.id}`} style={styles.row} accessibilityRole="button"
            onPress={() => pick({ name: h.name, kind: h.kind, refId: h.id, role: roleForKind(h.kind), isExternal: h.kind !== "user" })}>
            <Feather name={h.kind === "user" ? "briefcase" : h.kind === "client" ? "user" : "user-plus"} size={15} color={palette.brand} />
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={1}>{h.name}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>{ATTENDEE_KIND_LABEL[h.kind]}{h.detail ? ` · ${h.detail}` : ""}</Text>
            </View>
          </Pressable>
        ))}
        {term.length >= 2 ? (
          <Pressable style={styles.row} accessibilityRole="button" onPress={() => pick({ name: term, kind: "guest", role: "other", isExternal: true })}>
            <Feather name="plus" size={15} color={palette.muted} />
            <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>Add <Text style={{ fontWeight: fontWeight.semibold }}>“{term}”</Text> as a guest</Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="muted" style={{ padding: spacing.md }}>Type at least 2 letters.</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
