/**
 * One fixed deposit — its terms, the maturity figures, and what happens to it
 * next — the web's FdActions: an Applied FD gets "Receipt issued" or Cancel; an
 * Active one Mark matured or Close early; Active or Matured can be renewed (a
 * new deposit carrying its terms; this one becomes Renewed). Edit and Delete
 * always. Every change re-syncs the maturity follow-up on the server, which
 * also dates a closed deposit (a matured one on its maturity date).
 */

import React from "react";
import { View, ScrollView, RefreshControl, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { FieldRow } from "../../../../src/features/investors/detail/primitives";
import { useFd, useUpdateFd, useDeleteFd } from "../../../../src/features/fixed-deposits/api";
import {
  ISSUER_TYPE_LABELS, PAYOUT_LABELS, COMPOUNDING_LABELS, HOLDING_LABELS, TAX_FORM_LABELS, STATUS_LABELS,
  computeMaturity, tenureLabel, tenureBetween, indiaToday, daysBetween, isLive,
} from "../../../../src/features/fixed-deposits/terms";
import { confirmDelete } from "../../../../src/lib/confirm";
import { toast } from "../../../../src/lib/toast";
import { inr, fmtDate } from "../../../../src/lib/format";
import { palette, spacing, fontWeight } from "../../../../src/theme/tokens";

export default function FixedDepositDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const { data: fd, isLoading, isError, refetch, isRefetching } = useFd(id);
  const update = useUpdateFd(id!);
  const del = useDeleteFd();

  if (isLoading) return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}><ScreenHeader title="Fixed deposit" /><LoadingState /></View>;
  if (isError || !fd) return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}><ScreenHeader title="Fixed deposit" /><ErrorState onRetry={refetch} /></View>;

  const principal = Number(fd.principal), rate = Number(fd.interestRate);
  const maturityAmount = fd.maturityAmount != null ? Number(fd.maturityAmount) : null;
  const figs = computeMaturity({ principal, rate, depositDate: String(fd.depositDate), maturityDate: String(fd.maturityDate), payout: fd.payout, compounding: fd.compounding });
  const live = isLive(fd.status);
  const left = daysBetween(indiaToday(), String(fd.maturityDate));
  const tenure = tenureBetween(String(fd.depositDate).slice(0, 10), String(fd.maturityDate).slice(0, 10));
  const payoutOn = fd.interestPayoutDate
    ? fmtDate(fd.interestPayoutDate)
    : fd.payout === "cumulative" ? `${fmtDate(fd.maturityDate)} (on maturity)` : null;

  // Only the status is sent (as the web): the server dates the close itself —
  // a matured FD on its maturity date, an early close today.
  const setStatus = (status: string, title: string, confirmLabel: string, done: string, message?: string) => {
    if (update.isPending) return;
    Alert.alert(title, message, [
      { text: "Not now", style: "cancel" },
      { text: confirmLabel, style: status === "cancelled" ? "destructive" : "default", onPress: () => update.mutate({ status }, { onSuccess: () => toast.success(done) }) },
    ]);
  };
  const renew = () => {
    const p = new URLSearchParams({
      renew: fd.id, investorId: fd.investorId, ...(name ? { name } : {}),
      issuer: fd.issuer, issuerType: fd.issuerType, ...(fd.schemeName ? { schemeName: fd.schemeName } : {}),
      // The new deposit starts on this one's maturity, with what it pays out.
      depositDate: String(fd.maturityDate).slice(0, 10),
      principal: String(fd.payout === "cumulative" && maturityAmount ? maturityAmount : principal),
      interestRate: String(rate), payout: fd.payout, compounding: fd.compounding,
      // The same tenure, read from its dates (the web's renewal).
      tenureMonths: String(tenure.months), tenureDays: String(tenure.days),
      holding: fd.holding, ...(fd.jointHolders ? { jointHolders: fd.jointHolders } : {}), ...(fd.nomineeName ? { nomineeName: fd.nomineeName } : {}),
      taxForm: fd.taxForm, seniorCitizen: fd.seniorCitizen ? "1" : "0", autoRenew: fd.autoRenew ? "1" : "0",
    });
    router.push(`/m/fixed-deposits/new?${p.toString()}` as any);
  };
  const remove = () => confirmDelete(
    { title: "Delete this fixed deposit?", message: "Removes it from the client and the FD list, and cancels its maturity reminder. Use it for a record entered by mistake.", confirmLabel: "Delete" },
    () => del.mutate(fd.id, { onSuccess: () => { toast.success("Deleted"); router.back(); } }),
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={fd.issuer} subtitle={name || undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text variant="title" style={{ flex: 1 }}>{inr(principal)}</Text>
            <StatusPill label={STATUS_LABELS[fd.status] ?? fd.status} tone={live ? "success" : fd.status === "cancelled" ? "danger" : "neutral"} />
          </View>
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{rate}% a year · {tenureLabel(fd.tenureMonths, fd.tenureDays)}</Text>
          {live ? (
            <Text variant="caption" style={{ marginTop: spacing.sm, fontWeight: fontWeight.semibold, color: left < 0 ? palette.danger : left <= 30 ? palette.warning : palette.ink }}>
              {left < 0 ? `Matured ${fmtDate(fd.maturityDate)} — update its status` : `Matures ${fmtDate(fd.maturityDate)} (${left} day${left === 1 ? "" : "s"})`}
            </Text>
          ) : null}
          <Text variant="caption" tone="brand" style={{ marginTop: spacing.sm }} onPress={() => router.push(`/m/investors/${fd.investorId}` as any)}>{name || "Open client"} →</Text>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <FieldRow label="Issuer type" value={ISSUER_TYPE_LABELS[fd.issuerType] ?? fd.issuerType} />
          <FieldRow label="Scheme" value={fd.schemeName} />
          <FieldRow label="FD number" value={fd.fdNumber} />
          <FieldRow label="Deposited" value={fmtDate(fd.depositDate)} />
          <FieldRow label="Maturity date" value={fmtDate(fd.maturityDate)} />
          <FieldRow label="Interest" value={PAYOUT_LABELS[fd.payout] ?? fd.payout} />
          <FieldRow label="Interest payout date" value={payoutOn} />
          {fd.payout === "cumulative" ? <FieldRow label="Compounding" value={COMPOUNDING_LABELS[fd.compounding] ?? fd.compounding} /> : null}
          <FieldRow label="At maturity" value={maturityAmount != null ? `${inr(maturityAmount)}${fd.maturityAmountEntered ? " (from the receipt)" : ""}` : null} />
          {figs ? <FieldRow label="Interest over the term" value={inr(figs.interest)} /> : null}
          {figs?.periodicInterest ? <FieldRow label="Each payout" value={inr(figs.periodicInterest)} /> : null}
          <FieldRow label="Holding" value={HOLDING_LABELS[fd.holding] ?? fd.holding} />
          {fd.jointHolders ? <FieldRow label="Joint holders" value={fd.jointHolders} /> : null}
          <FieldRow label="Nominee" value={fd.nomineeName} />
          <FieldRow label="Senior citizen" value={fd.seniorCitizen ? "Yes" : "No"} />
          <FieldRow label="Form 15G / 15H" value={TAX_FORM_LABELS[fd.taxForm] ?? fd.taxForm} />
          <FieldRow label="Auto-renews" value={fd.autoRenew ? "Yes" : "No"} />
          {fd.closedOn ? <FieldRow label="Closed on" value={fmtDate(fd.closedOn)} /> : null}
          {fd.remarks ? <FieldRow label="Remarks" value={fd.remarks} /> : null}
        </Card>

        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {fd.status === "applied" ? <Button label="Receipt issued" icon={<Feather name="check-circle" size={15} color="#fff" />} loading={update.isPending} onPress={() => setStatus("active", "Receipt issued?", "Receipt issued", "Receipt issued — FD is active")} full /> : null}
          {fd.status === "active" ? <Button label="Mark matured" icon={<Feather name="check-circle" size={15} color="#fff" />} loading={update.isPending} onPress={() => setStatus("matured", "Mark matured?", "Mark matured", "Marked matured")} full /> : null}
          {fd.status === "active" || fd.status === "matured" ? <Button label="Renew" variant="secondary" icon={<Feather name="refresh-cw" size={15} color={palette.ink} />} onPress={renew} full /> : null}
          {fd.status === "active" ? <Button label="Close early" variant="secondary" loading={update.isPending} onPress={() => setStatus("closed_early", "Close this FD early?", "Close early", "Marked closed early", "Use this when the client broke the deposit before maturity. The maturity reminder is cancelled.")} full /> : null}
          {fd.status === "applied" ? <Button label="Cancel application" variant="secondary" loading={update.isPending} onPress={() => setStatus("cancelled", "Cancel this application?", "Cancel application", "Application cancelled", "The deposit was never placed.")} full /> : null}
          <Button label="Edit" variant="secondary" icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => router.push(`/m/fixed-deposits/new?editId=${fd.id}` as any)} full />
          <Button label="Delete" variant="danger" loading={del.isPending} icon={<Feather name="trash-2" size={15} color="#fff" />} onPress={remove} full />
        </View>
      </ScrollView>
    </View>
  );
}
