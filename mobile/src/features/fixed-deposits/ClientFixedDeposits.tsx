/**
 * The client page's Fixed deposits section (the CRM's ClientFdPanel, on the
 * Portfolio tab): the client's live FDs, then the rest folded, and "Add FD".
 */

import React, { useState } from "react";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Section, Empty } from "../investors/detail/primitives";
import { inr } from "../../lib/format";
import { palette, spacing } from "../../theme/tokens";
import { useFds } from "./api";
import { FdRowCard } from "./FdRowCard";
import { isLive } from "./terms";

export function ClientFixedDeposits({ investorId, name }: { investorId: string; name?: string }) {
  const router = useRouter();
  const q = useFds({ investorId, status: "all" });
  const [showAll, setShowAll] = useState(false);
  const rows = q.data?.rows ?? [];
  const live = rows.filter((r) => isLive(r.status));
  const rest = rows.filter((r) => !isLive(r.status));
  const livePrincipal = live.reduce((s, r) => s + Number(r.principal || 0), 0);
  const open = (id: string) => router.push(`/m/fixed-deposits/${id}${name ? `?name=${encodeURIComponent(name)}` : ""}` as any);
  return (
    <Section
      title={live.length ? `Fixed deposits · ${inr(livePrincipal)}` : "Fixed deposits"}
      icon="lock"
      right={<Text variant="caption" tone="brand" onPress={() => router.push(`/m/fixed-deposits/new?investorId=${investorId}${name ? `&name=${encodeURIComponent(name)}` : ""}` as any)}>Add FD</Text>}
    >
      {q.isLoading ? <Text variant="caption" tone="muted">Loading…</Text> : live.length === 0 ? <Empty text="No live fixed deposits." /> : null}
      {live.map((r) => <FdRowCard key={r.id} r={r} onPress={() => open(r.id)} />)}
      {rest.length ? (
        <Pressable onPress={() => setShowAll((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 36 }} accessibilityRole="button">
          <Feather name={showAll ? "chevron-up" : "chevron-down"} size={14} color={palette.muted} />
          <Text variant="caption" tone="muted">{showAll ? "Hide" : "Show"} matured / closed ({rest.length})</Text>
        </Pressable>
      ) : null}
      {showAll ? rest.map((r) => <FdRowCard key={r.id} r={r} onPress={() => open(r.id)} />) : null}
    </Section>
  );
}
