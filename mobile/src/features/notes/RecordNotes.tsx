/**
 * Notes on a client or lead — the CRM's one Notes card (web RecordNotes):
 * every entry in the interaction log that carries text, newest first
 * (GET /api/{investors|leads}/[id]/notes — a lead's also folds in its old
 * follow-up notes). "Add note" logs a note activity (POST /api/activities,
 * kind "note"), so calls and visits logged anywhere show here too.
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { Section, Empty } from "../investors/detail/primitives";
import { api } from "../../api/client";
import { toast } from "../../lib/toast";
import { timeAgo, titleCase } from "../../lib/format";
import { palette, spacing } from "../../theme/tokens";
import { asIcon } from "../../lib/icons";

export interface RecordNote { id: string; kind: string; at: string; title: string | null; body: string | null; meta?: Record<string, any> | null }

const KIND_ICON: Record<string, string> = { call: "phone", visit: "map-pin", whatsapp: "message-circle", email: "mail", sms: "message-square", note: "edit-3", meeting: "calendar" };

export function useRecordNotes(type: "investor" | "lead", id?: string) {
  return useQuery({
    queryKey: ["record-notes", type, id],
    enabled: !!id,
    queryFn: () => api.get<{ notes: RecordNote[] }>(`/api/${type === "investor" ? "investors" : "leads"}/${id}/notes`).then((r) => r.notes ?? []),
  });
}

export function RecordNotes({ type, id, limit = 20 }: { type: "investor" | "lead"; id: string; limit?: number }) {
  const qc = useQueryClient();
  const notes = useRecordNotes(type, id);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    mutationFn: (text: string) => api.post("/api/activities", { subjectType: type, subjectId: id, kind: "note", notes: text }),
    onSuccess: () => {
      setDraft(""); setAdding(false); toast.success("Note added");
      qc.invalidateQueries({ queryKey: ["record-notes", type, id] });
      qc.invalidateQueries({ queryKey: ["activities"] });
    },
  });
  const rows = notes.data ?? [];
  return (
    <Section title="Notes" icon="edit-3" right={!adding ? <Text variant="caption" tone="brand" onPress={() => setAdding(true)}>Add note</Text> : undefined}>
      {adding ? (
        <View style={{ marginBottom: spacing.md }}>
          <TextField label="" value={draft} onChangeText={(v) => setDraft(v.slice(0, 4000))} placeholder="Write a note…" multiline />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button label="Save note" size="sm" loading={add.isPending} onPress={() => draft.trim() && add.mutate(draft.trim())} />
            <Button label="Cancel" size="sm" variant="ghost" onPress={() => { setAdding(false); setDraft(""); }} />
          </View>
        </View>
      ) : null}
      {notes.isLoading ? <Text variant="caption" tone="muted">Loading…</Text> : rows.length === 0 ? <Empty text="No notes yet." /> : rows.slice(0, limit).map((n) => (
        <View key={n.id} style={styles.row}>
          <Feather name={asIcon(KIND_ICON[n.kind] ?? "file-text")} size={14} color={palette.muted} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="faint">{[n.title || titleCase(n.kind), timeAgo(n.at)].filter(Boolean).join(" · ")}</Text>
            {n.body ? <Text variant="caption">{n.body}</Text> : null}
          </View>
        </View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
});
