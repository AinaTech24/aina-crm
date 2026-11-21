/**
 * The client page's Opportunities section — the CRM's OpportunitiesPanel:
 * this client's open opportunities (then the recently closed, folded), and
 * "New opportunity". Several can be open for one product (a second SIP, a
 * top-up, another policy — the firm's request of 2026-11-07): the sheet marks
 * a product "one already open" but still lets it be picked. The server never
 * makes the same click twice — the same person's opportunity for this client
 * and product within a minute comes back instead of a new one.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { Segmented } from "../../components/ui/Segmented";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { DateField } from "../../components/form/DateField";
import { Section, Empty } from "../investors/detail/primitives";
import { toast } from "../../lib/toast";
import { fmtDate } from "../../lib/format";
import { palette, spacing } from "../../theme/tokens";
import { OpportunityCard } from "./OpportunityCard";
import { useClientOpportunities, useCreateOpportunity, assigneeList, istDay, OPPORTUNITY_PRODUCTS, type Staff } from "./api";

export function ClientOpportunities({ investorId, startWith }: {
  investorId: string;
  /** Open New opportunity at once ("" = no product chosen yet). */
  startWith?: string;
}) {
  const q = useClientOpportunities(investorId);
  const [creating, setCreating] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (startWith !== undefined && q.data?.canWork && !started.current) { started.current = true; setCreating(true); }
  }, [startWith, q.data?.canWork]);
  const [showClosed, setShowClosed] = useState(false);
  const items = q.data?.items ?? [];
  const openOnes = items.filter((o) => o.status === "open");
  const closed = items.filter((o) => o.status !== "open");
  const canWork = !!q.data?.canWork;
  const staff: Staff[] = q.data?.staff ?? [];

  return (
    <Section
      title="Opportunities"
      icon="crosshair"
      right={canWork ? <Text variant="caption" tone="brand" onPress={() => setCreating(true)}>New</Text> : undefined}
    >
      {q.isLoading ? <Text variant="caption" tone="muted">Loading…</Text> : openOnes.length === 0 ? <Empty text="No open opportunities." /> : null}
      {openOnes.map((o) => <OpportunityCard key={o.id} o={o} canWork={canWork} staff={staff} />)}
      {closed.length > 0 ? (
        <Pressable onPress={() => setShowClosed((v) => !v)} style={styles.toggle} accessibilityRole="button">
          <Feather name={showClosed ? "chevron-up" : "chevron-down"} size={14} color={palette.muted} />
          <Text variant="caption" tone="muted">{showClosed ? "Hide" : "Show"} closed ({closed.length})</Text>
        </Pressable>
      ) : null}
      {showClosed ? closed.map((o) => <OpportunityCard key={o.id} o={o} canWork={false} staff={staff} />) : null}
      {canWork ? (
        <NewOpportunitySheet investorId={investorId} visible={creating} onClose={() => setCreating(false)} initialProduct={startWith || undefined}
          assignees={assigneeList(q.data?.assignees)} me={q.data?.me} openProducts={openOnes.map((o) => o.product)} />
      ) : null}
    </Section>
  );
}

/** Start an opportunity: the product, roughly how much, who owns it, and
 *  Now (the first follow-up date) or Later (the client wants it, not yet). */
export function NewOpportunitySheet({ investorId, visible, onClose, assignees, me, onCreated, initialProduct, openProducts = [] }: {
  investorId: string;
  visible: boolean;
  onClose: () => void;
  assignees: Staff[];
  me?: string;
  onCreated?: (id: string) => void;
  initialProduct?: string;
  /** Products this client already has open — marked, still pickable. */
  openProducts?: string[];
}) {
  const create = useCreateOpportunity(investorId);
  const [product, setProduct] = useState<string | null>(initialProduct ?? null);
  useEffect(() => { if (visible && initialProduct) setProduct(initialProduct); }, [visible, initialProduct]);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"sip" | "lumpsum">("sip");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [followUpOn, setFollowUpOn] = useState(istDay(2));
  const [revisitOn, setRevisitOn] = useState(istDay(90));
  const [reason, setReason] = useState("");
  const isMf = OPPORTUNITY_PRODUCTS.find((p) => p.key === product)?.pipeline === "mf";

  const reset = () => { setProduct(null); setValue(""); setMode("sip"); setOwnerId(null); setWhen("now"); setFollowUpOn(istDay(2)); setRevisitOn(istDay(90)); setReason(""); };
  const save = async () => {
    if (create.isPending) return;
    if (!product) return toast.error("Pick the product.");
    if (when === "now" && (!followUpOn || followUpOn < istDay())) return toast.error("Pick a follow-up date from today on.");
    if (when === "later" && (!revisitOn || revisitOn <= istDay())) return toast.error("Pick a revisit date after today.");
    const amount = Number(value);
    try {
      const r = await create.mutateAsync({
        product,
        expectedValue: amount > 0 ? amount : null,
        investmentMode: isMf ? mode : null,
        ownerId: ownerId ?? undefined,
        source: "manual",
        ...(when === "now" ? { followUpOn } : { later: { revisitOn, reason: reason.trim() } }),
      });
      toast.success(r.created ? "Opportunity started" : `Already started a moment ago — opened that ${r.opportunity.productLabel} opportunity`);
      reset();
      onClose();
      onCreated?.(r.opportunity.id);
    } catch { /* global toast */ }
  };

  const ownerOptions = assignees.map((s) => ({ value: s.id, label: s.id === me ? `${s.name} (me)` : s.name }));
  return (
    <BottomSheet visible={visible} onClose={onClose} title="New opportunity">
      <SelectField label="Product" required value={product} placeholder="Pick a product" options={OPPORTUNITY_PRODUCTS.map((p) => ({ value: p.key, label: openProducts.includes(p.key) ? `${p.label} · one already open` : p.label }))} onChange={setProduct} />
      {isMf ? (
        <View style={{ marginBottom: spacing.md }}>
          <Segmented<"sip" | "lumpsum"> options={[{ key: "sip", label: "SIP" }, { key: "lumpsum", label: "Lumpsum" }]} value={mode} onChange={setMode} />
        </View>
      ) : null}
      <TextField label={isMf && mode === "sip" ? "Monthly SIP (₹, optional)" : "Expected value (₹, optional)"} value={value} onChangeText={(v) => setValue(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
      {ownerOptions.length ? <SelectField label="Assign to" value={ownerId} placeholder="Me" options={ownerOptions} onChange={setOwnerId} /> : null}
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>When</Text>
      <Segmented<"now" | "later"> options={[{ key: "now", label: "Now" }, { key: "later", label: "Client wants it later" }]} value={when} onChange={setWhen} />
      <View style={{ height: spacing.md }} />
      {when === "now" ? (
        <DateField label="First follow-up" value={followUpOn} onChange={setFollowUpOn} />
      ) : (
        <>
          <DateField label="Revisit on" value={revisitOn} onChange={setRevisitOn} />
          <TextField label="What the client said" value={reason} onChangeText={setReason} placeholder="e.g. After Diwali" />
          <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>You'll be reminded {OPPORTUNITY_PRODUCTS.find((p) => p.key === product)?.pipeline === "insurance" ? 15 : 7} days before {fmtDate(revisitOn)}.</Text>
        </>
      )}
      <Button label="Start opportunity" full loading={create.isPending} onPress={save} style={{ marginTop: spacing.sm }} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.sm, minHeight: 36 },
});

