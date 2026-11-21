/**
 * Scheme inputs for the calculators — picked from the firm's Scheme Master
 * (every plan), or for Fund Research from the whole AMFI universe, as the web's
 * research picker does (`source="universe"`) — and the NAV-history loader
 * behind the Fund Research tools.
 *
 * History comes from GET /api/mf/schemes/:code/nav (mfapi.in, cached 6 h on the
 * server) — the same endpoint the web's Fund Research tools compute on — and is
 * kept per scheme code by React Query, so moving between tools does not
 * download it again.
 */

import React from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Text } from "../../components/ui/Text";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { SearchBar } from "../../components/ui/SearchBar";
import { spacing, palette, radius, fontSize } from "../../theme/tokens";
import { api } from "../../api/client";
import { navSeries, type NavSeries } from "./web/fund-research/nav";
import type { SchemePick } from "./types";

type SchemeHit = { schemeCode: string; schemeName: string; amc: string | null; category: string | null };

/** GET /api/mf/schemes — every plan; `universe` searches all of AMFI, not just the firm's master. */
function useSchemeLookup(q: string, source: "master" | "universe") {
  const term = q.trim();
  return useQuery({
    queryKey: ["calc-scheme-search", source, term],
    queryFn: () => api.get<{ schemes: SchemeHit[]; masterEmpty?: boolean }>("/api/mf/schemes", { q: term, limit: "20", source: source === "universe" ? "universe" : undefined }),
    enabled: term.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function SchemeInput({ label, value, onChange, source = "master" }: { label: string; value: SchemePick; onChange: (v: SchemePick) => void; source?: "master" | "universe" }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const res = useSchemeLookup(open ? q : "", source);
  const rows = res.data?.schemes ?? [];
  return (
    <View>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>{label}</Text>
      <View style={styles.control}>
        <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)}>
          <Text style={{ color: value ? palette.ink : palette.faint, fontSize: fontSize.md }} numberOfLines={2}>
            {value?.name ?? (source === "universe" ? "Search all schemes…" : "Search the Scheme Master…")}
          </Text>
        </Pressable>
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} hitSlop={8} onPress={() => onChange(null)}>
            <Feather name="x" size={18} color={palette.faint} />
          </Pressable>
        ) : (
          <Feather name="search" size={16} color={palette.faint} />
        )}
      </View>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        {res.data?.masterEmpty ? <Text variant="caption" style={{ color: palette.warning, marginBottom: spacing.sm }}>The firm's Scheme Master is empty — sync it in the CRM first.</Text> : null}
        <SearchBar value={q} onChangeText={setQ} placeholder={source === "universe" ? "Search all mutual fund schemes…" : "Search your Scheme Master…"} />
        <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
          {rows.map((s) => (
            <Pressable
              key={s.schemeCode}
              style={styles.row}
              onPress={() => { onChange({ code: s.schemeCode, name: s.schemeName }); setOpen(false); setQ(""); }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={2}>{s.schemeName}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{[s.amc, s.category].filter(Boolean).join(" · ")}</Text>
              </View>
            </Pressable>
          ))}
          {q.trim().length >= 2 && !res.isFetching && rows.length === 0 && !res.data?.masterEmpty ? (
            <Text variant="body" tone="muted" style={{ textAlign: "center", padding: spacing.lg }}>No scheme matches.</Text>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

type NavPayload = { schemeCode: string; schemeName: string; firstDate: string; lastDate: string; points: Array<[string, number]> };

export type NavLoad = { code: string; status: "loading" | "ready" | "error"; series?: NavSeries; firstDate?: string; lastDate?: string; error?: string };

/** NAV history for each scheme code, from the CRM's NAV endpoint. */
export function useNavHistories(codes: string[]): NavLoad[] {
  const results = useQueries({
    queries: codes.map((code) => ({
      queryKey: ["mf-nav-history", code],
      queryFn: async () => {
        const j = await api.get<NavPayload>(`/api/mf/schemes/${encodeURIComponent(code)}/nav`);
        return { series: navSeries(j.points.map(([date, nav]) => ({ date, nav }))), firstDate: j.firstDate, lastDate: j.lastDate };
      },
      staleTime: 6 * 60 * 60 * 1000,
      gcTime: 6 * 60 * 60 * 1000,
      retry: 1,
    })),
  });
  return codes.map((code, i) => {
    const r = results[i];
    if (r?.data) return { code, status: "ready", series: r.data.series, firstDate: r.data.firstDate, lastDate: r.data.lastDate };
    if (r?.isError) {
      const status = (r.error as any)?.status;
      return { code, status: "error", error: status === 404 ? "No NAV history is available for this scheme." : "Could not load the NAV history." };
    }
    return { code, status: "loading" };
  });
}

const styles = StyleSheet.create({
  control: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
