/**
 * Start a new discovery — find the client or lead it is for, and create the
 * fact-find. The app's copy of the CRM's NewDiscoveryDialog: one search over
 * name, PAN, mobile or email, clients first (up to 8) then leads (up to 6),
 * each row saying which it is. The server prefills the draft from the record
 * and, when the person already has an open fact-find, returns that one.
 */

import React, { useEffect, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { SearchBar } from "../../components/ui/SearchBar";
import { StatusPill } from "../../components/ui/StatusPill";
import { Text } from "../../components/ui/Text";
import { initials, titleCase } from "../../lib/format";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { useSearch, MIN_QUERY } from "../search/api";
import { useCreateDiscovery } from "./api";

type Hit = {
  id: string;
  name: string;
  type: "investor" | "lead";
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Segment for a client, stage for a lead. */
  tag?: string | null;
};

export function NewDiscoverySheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const create = useCreateDiscovery();
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!visible) { setQ(""); setTerm(""); } }, [visible]);

  // The last answer stays up while the next query flies (placeholderData);
  // the spinner shows only while there is nothing to show yet.
  const search = useSearch(term);
  const long = q.trim().length >= MIN_QUERY;
  const hits: Hit[] = long && term.length >= MIN_QUERY && search.data
    ? [
        ...(search.data.investors ?? []).slice(0, 8).map((h) => ({
          id: h.id, name: h.name, type: "investor" as const, pan: h.pan_display, phone: h.phone, email: h.email, tag: h.segment_tag ? titleCase(h.segment_tag) : null,
        })),
        ...(search.data.leads ?? []).slice(0, 6).map((h) => ({
          id: h.id, name: h.name, type: "lead" as const, phone: h.phone, email: h.email, tag: h.stage ? titleCase(String(h.stage)) : null,
        })),
      ]
    : [];
  const busy = long && (q.trim() !== term || search.isFetching || search.isPlaceholderData);
  const status = !long ? "hint" : busy && hits.length === 0 ? "loading" : !busy && hits.length === 0 ? "none" : "results";

  const pick = (h: Hit) => {
    if (creating) return;
    setCreating(h.id);
    create.mutate(
      { subjectType: h.type, subjectId: h.id },
      {
        onSuccess: (r) => { if (r?.id) onCreated(r.id); },
        onSettled: () => setCreating(null),
      },
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Start a financial discovery">
      <SearchBar value={q} onChangeText={setQ} placeholder="Name, PAN, mobile or email" autoFocus />
      <View style={{ minHeight: 120, maxHeight: 320, marginTop: spacing.sm }}>
        {status === "hint" ? (
          <Text variant="body" tone="muted" center style={styles.msg}>Type at least {MIN_QUERY} letters of a name, or a PAN, mobile or email.</Text>
        ) : status === "loading" ? (
          <View style={styles.msg}><ActivityIndicator color={palette.brand} /></View>
        ) : status === "none" ? (
          <Text variant="body" tone="muted" center style={styles.msg}>No client or lead matches “{q.trim()}”.</Text>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            {hits.map((h) => {
              const sub = [h.pan, h.phone, h.email].filter(Boolean).join(" · ");
              return (
                <Pressable
                  key={`${h.type}-${h.id}`}
                  onPress={() => pick(h)}
                  disabled={!!creating}
                  accessibilityRole="button"
                  accessibilityLabel={`Start a discovery for ${h.name}, ${h.type === "investor" ? "client" : "lead"}`}
                  style={({ pressed }) => [styles.row, (pressed || creating === h.id) && { backgroundColor: palette.surfaceSunken }, !!creating && creating !== h.id && { opacity: 0.5 }]}
                >
                  <View style={styles.avatar}><Text variant="caption" style={{ color: palette.brandDark, fontWeight: fontWeight.bold }}>{initials(h.name)}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.semibold, flexShrink: 1 }} numberOfLines={1}>{h.name}</Text>
                      <StatusPill label={h.type === "investor" ? "Client" : "Lead"} tone="neutral" size="sm" dot={false} />
                    </View>
                    {h.tag || sub ? (
                      <Text variant="caption" tone="muted" numberOfLines={1}>{[h.tag, sub || null].filter(Boolean).join(" · ")}</Text>
                    ) : null}
                  </View>
                  {creating === h.id ? <ActivityIndicator color={palette.muted} /> : <Feather name="chevron-right" size={18} color={palette.faint} />}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  msg: { paddingVertical: spacing["2xl"], alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
