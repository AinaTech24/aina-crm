/**
 * Proposals — the live CRM's list (web dashboard/proposals).
 *
 *  - List or Pipeline. The list has the web's status tabs, with counts under
 *    the search: Draft (default) · Sent · Accepted · Rejected · Expired. A
 *    draft or sent proposal past its valid-till date (on the IST calendar) is
 *    Expired whatever its stored status says, and Renew gives it 30 days.
 *  - A superseded proposal is an older VERSION of one that is listed — it is
 *    reached from that proposal's versions, never counted twice.
 *  - Each row opens the proposal; the PDF button downloads the document the
 *    client receives.
 *  - ?leadId= (a lead journey's "Open proposals") lists that lead's only.
 */

import React from "react";
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { FAB } from "../../../../src/components/ui/FAB";
import { ErrorState } from "../../../../src/components/states";
import { useMe, hasCap } from "../../../../src/api/me";
import { api } from "../../../../src/api/client";
import { useTeam } from "../../../../src/features/team/api";
import { useProposals, useRefreshProposals, num, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, RECIPIENT_LABEL, type Proposal } from "../../../../src/features/proposals/api";
import { ProposalsBoard, boardTotals, lakhs } from "../../../../src/features/proposals/Board";
import { downloadProposalPdf } from "../../../../src/features/proposals/pdf";
import { toast } from "../../../../src/lib/toast";
import { inr, fmtDate, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

/** The IST calendar day of a moment, YYYY-MM-DD. */
const istDay = (d: string | number | Date) => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
/** Past its valid-till date on the IST calendar: valid till the 25th is valid all of the 25th. */
const past = (p: Proposal) => !!p.validUntil && istDay(p.validUntil) < istDay(Date.now());
const OPEN = ["draft", "ready", "sent", "viewed", "changes_requested"];

const TABS: Array<{ key: string; label: string; match: (p: Proposal) => boolean }> = [
  { key: "draft", label: "Draft", match: (p) => ["draft", "ready"].includes(p.status) && !past(p) },
  { key: "sent", label: "Sent", match: (p) => ["sent", "viewed", "changes_requested"].includes(p.status) && !past(p) },
  { key: "accepted", label: "Accepted", match: (p) => ["accepted", "partially_approved", "executed"].includes(p.status) },
  { key: "rejected", label: "Rejected", match: (p) => p.status === "rejected" },
  { key: "expired", label: "Expired", match: (p) => p.status === "expired" || (OPEN.includes(p.status) && past(p)) },
];
const isExpired = (p: Proposal) => p.status === "expired" || (OPEN.includes(p.status) && past(p));

const SORTS = [
  { key: "created_desc", label: "Newest first" },
  { key: "created_asc", label: "Oldest first" },
  { key: "invest_desc", label: "Investment ₹ — high to low" },
  { key: "invest_asc", label: "Investment ₹ — low to high" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

/** The validity a new proposal gets, so a renewal matches it. */
const RENEW_DAYS = 30;
const WEEK_MS = 7 * 864e5;

/** Within a week either side, how long; further out, the valid-till date itself. */
function validTill(p: Proposal): string {
  if (!p.validUntil) return "—";
  // The moment it stops being valid: midnight IST after its last valid day.
  const lapses = new Date(`${istDay(p.validUntil)}T00:00:00+05:30`).getTime() + 864e5;
  const diff = lapses - Date.now();
  if (Math.abs(diff) >= WEEK_MS) return `Valid till ${fmtDate(p.validUntil)}`;
  const d = Math.floor(Math.abs(diff) / 864e5), h = Math.floor(Math.abs(diff) / 3600e3);
  const span = d >= 1 ? `${d}d` : `${Math.max(1, h)}h`;
  return diff > 0 ? `Lapses in ${span}` : `Lapsed ${span} ago`;
}

export default function ProposalsList() {
  const router = useRouter();
  const params = useLocalSearchParams<{ leadId?: string }>();
  const [leadId, setLeadId] = React.useState<string | null>(typeof params.leadId === "string" && params.leadId ? params.leadId : null);
  const { data, isLoading, isError, isRefetching, refetch } = useProposals();
  const { data: me } = useMe();
  const team = useTeam();
  const refresh = useRefreshProposals();
  const [view, setView] = React.useState<"list" | "board">("list");
  const [tab, setTab] = React.useState("draft");
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("created_desc");
  const [sortOpen, setSortOpen] = React.useState(false);
  const [pdfFor, setPdfFor] = React.useState<string | null>(null);
  const canRenew = hasCap(me?.capabilities, "proposal.write");
  const canCreate = canRenew;

  const names = React.useMemo(() => new Map((team.data?.rows ?? []).map((u) => [u.id, u.name ?? ""])), [team.data]);
  const preparedBy = (id: string | null) => (id ? names.get(id) || null : null);

  const term = q.trim().toLowerCase();
  const current = (data ?? []).filter((p) => p.status !== "superseded")
    .filter((p) => !leadId || p.leadId === leadId)
    .filter((p) => !term || [p.proposalNumber, p.title, p.recipientName].some((s) => String(s ?? "").toLowerCase().includes(term)));
  const counts = Object.fromEntries(TABS.map((t) => [t.key, current.filter(t.match).length])) as Record<string, number>;
  const active = TABS.find((t) => t.key === tab)!;
  const leadName = leadId ? current.find((p) => p.recipientName)?.recipientName ?? "this lead" : null;
  // One lead's proposals have usually gone out: open on the first tab holding any.
  const tabPicked = React.useRef(false);
  React.useEffect(() => {
    if (!leadId || tabPicked.current || !data) return;
    tabPicked.current = true;
    if (!counts[tab]) { const first = TABS.find((t) => counts[t.key] > 0); if (first) setTab(first.key); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, data]);
  const rows = current.filter(active.match).sort((a, b) =>
    sort === "created_asc" ? +new Date(a.createdAt) - +new Date(b.createdAt)
      : sort === "invest_desc" ? num(b.totalInvestment) - num(a.totalInvestment)
        : sort === "invest_asc" ? num(a.totalInvestment) - num(b.totalInvestment)
          : +new Date(b.createdAt) - +new Date(a.createdAt));
  const boardRows = current.filter((p) => !["rejected", "expired"].includes(p.status));
  const bt = boardTotals(boardRows);
  const anyProposal = (data ?? []).some((p) => p.status !== "superseded");

  const renew = (p: Proposal) => {
    const d = new Date(Date.now() + RENEW_DAYS * 864e5);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // The expiry job stored "expired"; give it back the state it lapsed from.
    const back = p.status === "expired" ? (p.viewedAt ? "viewed" : p.sentAt ? "sent" : "ready") : null;
    Alert.alert("Renew this proposal?", `${p.proposalNumber} will be valid till ${fmtDate(day)}, ${RENEW_DAYS} days from today.${p.sentAt ? " The copy the client has still shows the old date; send it again from the proposal if they need the new one." : ""}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Renew",
        onPress: () => api.patch(`/api/proposals/${p.id}`, { validUntil: new Date(`${day}T23:59:59+05:30`).toISOString(), ...(back ? { status: back } : {}) })
          .then(() => { toast.success(`${p.proposalNumber} is valid till ${fmtDate(day)}.`); refresh(); })
          .catch((e: any) => toast.error(e?.message ?? "Could not renew the proposal.")),
      },
    ]);
  };
  const pdf = async (p: Proposal) => {
    setPdfFor(p.id);
    try { await downloadProposalPdf(p.id, p.proposalNumber); } catch (e: any) { toast.error(e?.message ?? "Couldn't download the PDF"); } finally { setPdfFor(null); }
  };
  const open = (p: Proposal) => router.push(`/m/proposals/${p.id}` as any);

  const controls = (
    <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
      <Segmented options={[{ key: "list", label: "List" }, { key: "board", label: "Pipeline" }]} value={view} onChange={(v) => setView(v as "list" | "board")} />
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
        <View style={{ flex: 1 }}><SearchBar value={q} onChangeText={setQ} placeholder="Search by number, title, recipient…" /></View>
        {view === "list" ? (
          <Pressable onPress={() => setSortOpen(true)} style={styles.sortBtn} accessibilityRole="button" accessibilityLabel={`Sort: ${SORTS.find((s) => s.key === sort)!.label}`}>
            <Feather name="bar-chart-2" size={18} color={sort === "created_desc" ? palette.muted : palette.brand} style={{ transform: [{ rotate: "90deg" }] }} />
          </Pressable>
        ) : null}
      </View>
      {leadId ? (
        <Pressable onPress={() => setLeadId(null)} style={[styles.tab, { alignSelf: "flex-start" }]} accessibilityRole="button" accessibilityLabel="Show every proposal">
          <Text variant="label" style={{ color: palette.ink70, fontWeight: fontWeight.semibold }}>For {leadName}</Text>
          <Feather name="x" size={14} color={palette.muted} />
        </Pressable>
      ) : null}
      {view === "list" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {TABS.map((t) => {
            const on = tab === t.key;
            const n = counts[t.key] ?? 0;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text variant="label" style={{ color: on ? palette.white : palette.ink70, fontWeight: fontWeight.semibold }}>{t.label}</Text>
                <Text variant="label" style={{ color: on ? palette.white : t.key === "expired" && n > 0 ? palette.danger : palette.muted, fontWeight: t.key === "expired" && n > 0 ? fontWeight.bold : fontWeight.medium }}>{n}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <Text variant="caption" tone="muted">
          {bt.count} proposal{bt.count === 1 ? "" : "s"} sent · {bt.proposed > 0 ? lakhs(bt.proposed) : "₹0"} proposed · <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{bt.executed > 0 ? lakhs(bt.executed) : "₹0"} executed</Text> (first-year values: a year of SIPs plus one-time money)
        </Text>
      )}
    </View>
  );

  const empty = !anyProposal ? (
    <View style={{ alignItems: "center", marginTop: spacing["2xl"], paddingHorizontal: spacing.lg }}>
      <Feather name="file-text" size={28} color={palette.faint} />
      <Text variant="body" style={{ marginTop: spacing.sm, fontWeight: fontWeight.semibold, color: palette.ink }}>No proposals yet.</Text>
      {canCreate ? <Text variant="caption" tone="muted" center style={{ marginTop: spacing.xs }}>Tap New proposal to build a branded MF / Insurance / PMS / AIF proposal you can download as a PDF and send to a client.</Text> : null}
    </View>
  ) : (
    <Text variant="body" tone="muted" center style={{ marginTop: spacing["2xl"] }}>No {active.label.toLowerCase()} proposals{term ? " match this search" : ""}.</Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Proposals" />
      {isLoading ? (
        <View style={{ padding: spacing.lg }}>{controls}<Skeleton width="100%" height={88} /><Skeleton width="100%" height={88} style={{ marginTop: spacing.sm }} /></View>
      ) : isError ? (
        <ErrorState message="Couldn't load proposals." onRetry={() => refetch()} />
      ) : view === "board" ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
          {controls}
          <ProposalsBoard rows={boardRows} preparedBy={preparedBy} onOpen={open} />
        </ScrollView>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={controls}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={empty}
          renderItem={({ item }) => (
            <Row p={item} by={preparedBy(item.preparedByUserId)} canRenew={canRenew} pdfBusy={pdfFor === item.id}
              onPress={() => open(item)} onPdf={() => pdf(item)} onRenew={() => renew(item)} />
          )}
        />
      )}
      {canCreate ? <FAB icon="plus" label="New proposal" onPress={() => router.push("/m/proposals/new" as any)} /> : null}

      <BottomSheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort">
        {SORTS.map((s) => (
          <Pressable key={s.key} style={styles.sortRow} onPress={() => { setSort(s.key); setSortOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: sort === s.key }}>
            <Text variant="body" style={{ color: sort === s.key ? palette.brandDark : palette.ink }}>{s.label}</Text>
            {sort === s.key ? <Feather name="check" size={18} color={palette.brand} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
}

function Row({ p, by, canRenew, pdfBusy, onPress, onPdf, onRenew }: {
  p: Proposal; by: string | null; canRenew: boolean; pdfBusy: boolean; onPress: () => void; onPdf: () => void; onRenew: () => void;
}) {
  const invest = num(p.totalInvestment);
  const corpus = num(p.expectedCorpus);
  const expired = isExpired(p);
  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text variant="label" style={{ flex: 1, color: palette.brandDark, fontWeight: fontWeight.bold }} numberOfLines={1}>{p.proposalNumber}{(p.version ?? 1) > 1 ? ` · v${p.version}` : ""}</Text>
        {expired ? <StatusPill label="Expired" tone="danger" size="sm" /> : <StatusPill label={STATUS_LABEL[p.status] ?? titleCase(p.status)} tone={STATUS_TONE[p.status] ?? "neutral"} size="sm" />}
        <Pressable onPress={onPdf} hitSlop={8} style={styles.pdf} accessibilityRole="button" accessibilityLabel={`Download ${p.proposalNumber} PDF`} disabled={pdfBusy}>
          {pdfBusy ? <ActivityIndicator size="small" color={palette.muted} /> : <Feather name="download" size={17} color={palette.muted} />}
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 }}>
        <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.semibold, flexShrink: 1 }} numberOfLines={1}>{p.recipientName}</Text>
        <View style={styles.kind}><Text variant="caption" style={{ fontSize: 11, color: palette.ink70 }}>{RECIPIENT_LABEL[p.recipientType] ?? "Client"}</Text></View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm }}>
        <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>{TYPE_LABEL[p.type] ?? titleCase(p.type)}</Text>
        <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{invest > 0 ? inr(invest) : "—"}</Text>
        {corpus > 0 ? <Text variant="caption" style={{ color: palette.success, fontWeight: fontWeight.semibold }}>→ {inr(corpus)}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 }}>
        <Text variant="caption" tone={expired ? "danger" : "faint"} style={{ flex: 1 }} numberOfLines={1}>{[validTill(p), by ? `by ${by}` : null].filter(Boolean).join(" · ")}</Text>
        {expired && canRenew ? (
          <Pressable onPress={onRenew} hitSlop={8} style={styles.renew} accessibilityRole="button" accessibilityLabel={`Renew ${p.proposalNumber}`}>
            <Feather name="rotate-ccw" size={13} color={palette.brandDark} />
            <Text variant="caption" style={{ color: palette.brandDark, fontWeight: fontWeight.semibold }}>Renew</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, minHeight: 36, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  tabOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  sortBtn: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  sortRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm },
  kind: { backgroundColor: palette.surfaceSunken, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  pdf: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  renew: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28, paddingHorizontal: 4 },
});
