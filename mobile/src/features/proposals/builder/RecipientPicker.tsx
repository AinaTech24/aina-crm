/**
 * Who the proposal is for (web builder/RecipientPicker): an existing client,
 * a family (optionally one member of it), or a lead. Editing a saved
 * proposal, the recipient is fixed.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../../components/ui/Text";
import { Segmented } from "../../../components/ui/Segmented";
import { SearchBar } from "../../../components/ui/SearchBar";
import { useSearch } from "../../search/api";
import { useFamilySearch, useFamilyMembers, type RecipientType } from "../api";
import { proposalStyles } from "../ui";
import { initials, titleCase } from "../../../lib/format";
import { spacing, palette, radius, fontWeight } from "../../../theme/tokens";

export type Recipient = { type: RecipientType; id: string; name: string };

export function RecipientPicker({ value, onChange, familyMemberId, onFamilyMember, locked }: {
  value: Recipient | null;
  onChange: (r: Recipient | null) => void;
  familyMemberId: string | null;
  onFamilyMember: (id: string | null) => void;
  locked?: boolean;
}) {
  const [mode, setMode] = React.useState<RecipientType>(value?.type ?? "investor");
  const [q, setQ] = React.useState("");
  React.useEffect(() => { if (value?.type) setMode(value.type); }, [value?.type]);

  const search = useSearch(mode === "family" ? "" : q);
  const families = useFamilySearch(q, mode === "family" && !value);
  const members = useFamilyMembers(value?.type === "family" ? value.id : null);

  const switchMode = (m: RecipientType) => { setMode(m); setQ(""); onChange(null); onFamilyMember(null); };

  if (locked && value) return <Picked name={value.name} sub={value.type === "lead" ? "Lead" : value.type === "family" ? "Family group" : "Client"} />;

  const pick = (r: Recipient) => { onChange(r); setQ(""); };

  return (
    <View style={{ gap: spacing.md }}>
      <Segmented
        options={[{ key: "investor", label: "Client" }, { key: "family", label: "Family" }, { key: "lead", label: "Lead" }]}
        value={mode}
        onChange={(m) => switchMode(m as RecipientType)}
      />

      {value ? (
        <>
          <Picked
            name={value.name}
            sub={value.type === "lead" ? "Lead" : value.type === "family" ? "Family group · contact resolves to the head" : "Client"}
            onClear={() => { onChange(null); onFamilyMember(null); }}
          />
          {value.type === "family" && (members.data?.members.length ?? 0) > 0 ? (
            <View style={styles.members}>
              <Text variant="caption" tone="muted" style={{ letterSpacing: 0.6, fontWeight: fontWeight.semibold }}>ADDRESS PROPOSAL TO (OPTIONAL)</Text>
              <MemberRow active={!familyMemberId} onPress={() => onFamilyMember(null)} title="Whole family" sub="Default · contact = head" />
              {members.data!.members.map((m) => (
                <MemberRow key={m.id} active={familyMemberId === m.id} onPress={() => onFamilyMember(m.id)} title={m.name}
                  sub={`${m.familyRole ? titleCase(m.familyRole) : "Member"}${members.data!.primaryId === m.id ? " · Head" : ""}`} />
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <View>
          <SearchBar
            value={q}
            onChangeText={setQ}
            placeholder={mode === "investor" ? "Search client by name, PAN, mobile, or email…" : mode === "lead" ? "Search leads by name, phone, or email…" : "Search families by family name or head name…"}
          />
          <View style={{ marginTop: spacing.xs }}>
            {mode === "investor" && q.trim().length >= 2 ? (search.data?.investors ?? []).slice(0, 12).map((i) => (
              <ResultRow key={i.id} name={i.name} sub={[i.pan_display, i.phone].filter(Boolean).join(" · ") || "Client"} onPress={() => pick({ type: "investor", id: i.id, name: i.name })} />
            )) : null}
            {mode === "lead" && q.trim().length >= 2 ? (search.data?.leads ?? []).slice(0, 12).map((l) => (
              <ResultRow key={l.id} name={l.name} sub={[l.phone ?? "—", l.stage ? titleCase(l.stage) : null, l.source ? titleCase(l.source) : null].filter(Boolean).join(" · ")} onPress={() => pick({ type: "lead", id: l.id, name: l.name })} />
            )) : null}
            {mode === "family" ? (families.data ?? []).map((f) => (
              <ResultRow key={f.id} name={f.name} sub={`Head · ${f.head ?? "—"}`} onPress={() => pick({ type: "family", id: f.id, name: f.name })} />
            )) : null}
            {mode !== "family" && q.trim().length >= 2 && !search.isFetching && (mode === "investor" ? search.data?.investors.length : search.data?.leads.length) === 0 ? (
              <Text variant="caption" tone="muted" style={{ textAlign: "center", padding: spacing.md }}>No matches.</Text>
            ) : null}
            {mode === "family" && !families.isFetching && families.data?.length === 0 ? (
              <Text variant="caption" tone="muted" style={{ textAlign: "center", padding: spacing.md }}>{q.trim() ? `No families match “${q.trim()}”.` : "No families yet."}</Text>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

function Avatar({ name }: { name: string }) {
  return <View style={proposalStyles.avatar}><Text style={{ color: palette.white, fontWeight: fontWeight.bold, fontSize: 12 }}>{initials(name)}</Text></View>;
}

function Picked({ name, sub, onClear }: { name: string; sub: string; onClear?: () => void }) {
  return (
    <View style={styles.picked}>
      <Avatar name={name} />
      <View style={{ flex: 1 }}>
        <Text variant="body" style={{ fontWeight: fontWeight.semibold, color: palette.ink }} numberOfLines={1}>{name}</Text>
        <Text variant="caption" tone="muted">{sub}</Text>
      </View>
      {onClear ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel="Change recipient" style={styles.icon}>
          <Feather name="x" size={18} color={palette.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ResultRow({ name, sub, onPress }: { name: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={proposalStyles.pickRow} onPress={onPress} accessibilityRole="button">
      <Avatar name={name} />
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1} style={{ color: palette.ink }}>{name}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function MemberRow({ active, onPress, title, sub }: { active: boolean; onPress: () => void; title: string; sub: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: active }} style={[styles.member, active && { borderColor: palette.brand, backgroundColor: palette.brandLight }]}>
      <Text variant="body" numberOfLines={1} style={{ fontWeight: fontWeight.semibold, color: palette.ink }}>{title}</Text>
      <Text variant="caption" tone="muted">{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  picked: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: palette.brandTint, backgroundColor: palette.brandLight, borderRadius: radius.md, padding: spacing.md },
  icon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  members: { gap: spacing.sm, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  member: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: palette.surface },
});
