/**
 * Suggest risk profiles from age — the web's "Bulk assign by age", over the
 * firm's saved age bands (edited on the web). Three steps the user can stop at:
 * preview (who would be labelled, who is skipped and why; nothing written),
 * assign (in the server's batches until done), then email exactly the clients
 * just labelled their confirm-or-change link.
 *
 * Everything written here is PROVISIONAL: a suggestion awaiting the client's
 * own questionnaire, never a signed profile.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, ScrollView, Switch, ActivityIndicator, StyleSheet, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { toast } from "../../lib/toast";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { applyAgeAssign, notifyProvisional, previewAgeAssign, useRiskRefresh, type AgePreview } from "./api";
import { bandLabel, categoryLabel } from "./rules";

export function SuggestByAgeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const refresh = useRiskRefresh();
  const [refreshProvisional, setRefreshProvisional] = useState(false);
  const [preview, setPreview] = useState<AgePreview | null>(null);
  const [assigned, setAssigned] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "assign" | "notify">(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback((refreshProv: boolean) => {
    const mine = ++request.current;
    setBusy("preview");
    setErr(null);
    setPreview(null);
    setAssigned(null);
    previewAgeAssign(refreshProv)
      .then((p) => { if (mine === request.current) setPreview(p); })
      .catch((e: any) => { if (mine === request.current) setErr(e?.message ?? "Could not build the preview"); })
      .finally(() => { if (mine === request.current) setBusy(null); });
  }, []);

  useEffect(() => {
    if (visible) { setRefreshProvisional(false); load(false); }
  }, [visible, load]);

  const close = () => {
    if (busy === "assign" || busy === "notify") return;
    request.current++;
    onClose();
  };

  async function assign() {
    if (!preview) return;
    setBusy("assign");
    setErr(null);
    // The route writes at most its limit per call; carry on until nothing is
    // left. Safe to repeat: a client already at the band's category is skipped.
    const all: string[] = [];
    try {
      let remaining = 0;
      for (let round = 0; round < 100; round++) {
        const j = await applyAgeAssign(preview.bands, refreshProvisional);
        all.push(...(j.assigned ?? []));
        remaining = j.remaining ?? 0;
        setAssigned([...all]);
        if (!remaining || !j.assignedCount) break;
        setProgress(all.length);
      }
      toast.success(`Suggested a profile for ${all.length} client${all.length === 1 ? "" : "s"}` + (remaining ? ` · ${remaining} could not be assigned` : ""));
    } catch (e: any) {
      const done = all.length ? ` ${all.length} were assigned before it stopped — press Assign again to continue.` : "";
      setErr((e?.message ?? "Assignment failed") + done);
    } finally {
      setProgress(null);
      setBusy(null);
      refresh();
    }
  }

  async function notify() {
    if (!assigned?.length) return;
    setBusy("notify");
    setErr(null);
    try {
      // The route sends at most 300 per call — each slice a different set of clients.
      const j = { sent: 0, skipped: 0, noEmail: 0, failed: 0 };
      for (let i = 0; i < assigned.length; i += 300) {
        try {
          const r = await notifyProvisional(assigned.slice(i, i + 300));
          j.sent += r.sent ?? 0;
          j.skipped += r.skipped ?? 0;
          j.noEmail += r.noEmail ?? 0;
          j.failed += Array.isArray(r.failed) ? r.failed.length : 0;
        } catch (e: any) {
          throw new Error((e?.message ?? "Send failed") + (j.sent ? ` (${j.sent} already sent)` : ""));
        }
      }
      const bits = [`${j.sent} email${j.sent === 1 ? "" : "s"} sent`];
      if (j.skipped) bits.push(`${j.skipped} skipped (consent / compliance)`);
      if (j.noEmail) bits.push(`${j.noEmail} have no email`);
      if (j.failed) bits.push(`${j.failed} failed`);
      toast.success(bits.join(" · "));
      request.current++;
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Could not send the emails");
    } finally {
      setBusy(null);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={close} title="Suggest risk profiles from age">
      <ScrollView style={{ maxHeight: height * 0.64 }}>
        <Text variant="caption" tone="muted">
          Age stands in for investment horizon, not for risk appetite — so these are saved as suggestions, marked provisional, and replaced the moment the client answers their own questionnaire.
        </Text>

        {preview ? (
          <View style={styles.bands}>
            {preview.bands.map((b, i) => (
              <View key={i} style={styles.bandRow}>
                <Text variant="caption" tone="muted" style={{ width: 64 }}>{bandLabel(preview.bands, i)}</Text>
                <Feather name="chevron-right" size={13} color={palette.faint} />
                <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{categoryLabel(b.category)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {!assigned ? (
          <View style={styles.toggle}>
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>Also re-derive clients who already have a suggested profile</Text>
            <Switch
              value={refreshProvisional}
              disabled={!!busy}
              onValueChange={(v) => { setRefreshProvisional(v); load(v); }}
              accessibilityLabel="Also re-derive clients who already have a suggested profile"
            />
          </View>
        ) : null}

        {busy === "preview" ? (
          <View style={styles.row}><ActivityIndicator size="small" color={palette.brand} /><Text variant="caption" tone="muted">Working out who would be labelled…</Text></View>
        ) : null}
        {err ? <View style={[styles.box, { backgroundColor: palette.dangerBg }]}><Text variant="caption" tone="danger">{err}</Text></View> : null}

        {preview && !assigned ? (
          <View style={styles.box}>
            <Text variant="body" style={{ fontWeight: fontWeight.semibold, color: palette.ink }}>
              {preview.counts.assign} of {preview.counts.active} clients would get a suggested profile
            </Text>
            {preview.counts.assign > 0 ? (
              <View style={styles.chips}>
                {Object.entries(preview.byCategory).map(([cat, count]) => (
                  <View key={cat} style={styles.chip}><Text variant="caption" style={{ color: palette.ink70 }}>{categoryLabel(cat)}: <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.bold }}>{count}</Text></Text></View>
                ))}
              </View>
            ) : null}
            {preview.counts.already_profiled > 0 ? <Text variant="caption" tone="muted">• {preview.counts.already_profiled} already answered their own questionnaire — left untouched</Text> : null}
            {preview.counts.no_dob > 0 ? (
              <Text variant="caption" tone="muted">
                • {preview.counts.no_dob} have no date of birth — skipped
                {preview.noDobSample.length > 0 ? ` (${preview.noDobSample.slice(0, 3).join(", ")}${preview.counts.no_dob > 3 ? "…" : ""})` : ""}
              </Text>
            ) : null}
            {preview.counts.unchanged > 0 ? <Text variant="caption" tone="muted">• {preview.counts.unchanged} already carry this category — nothing to change</Text> : null}
            {preview.sample.length > 0 ? (
              <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
                e.g. {preview.sample.slice(0, 3).map((s) => `${s.name} (${s.age ?? "?"}) → ${categoryLabel(s.next)}`).join(" · ")}
              </Text>
            ) : null}
          </View>
        ) : null}

        {busy === "assign" && progress != null ? <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Assigned {progress} so far…</Text> : null}

        {assigned ? (
          <View style={[styles.box, { backgroundColor: palette.successBg }]}>
            <Text variant="body" style={{ fontWeight: fontWeight.semibold, color: palette.success }}>
              {assigned.length} client{assigned.length === 1 ? "" : "s"} now have a suggested profile
            </Text>
            <Text variant="caption" tone="muted">Next, email them: each gets their own confirm-or-change link. Clients with no email address are reported and skipped.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button label={assigned ? "Done" : "Cancel"} variant="secondary" onPress={close} disabled={busy === "assign" || busy === "notify"} full />
        </View>
        <View style={{ flex: 1 }}>
          {assigned ? (
            <Button label={`Email ${assigned.length}`} onPress={notify} loading={busy === "notify"} disabled={!assigned.length || !!busy} full />
          ) : (
            <Button label="Assign" onPress={assign} loading={busy === "assign"} disabled={!preview || preview.counts.assign === 0 || !!busy} full />
          )}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  bands: { marginTop: spacing.md, gap: 4 },
  bandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  box: { backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md, gap: 4, marginTop: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginVertical: 4 },
  chip: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
});
