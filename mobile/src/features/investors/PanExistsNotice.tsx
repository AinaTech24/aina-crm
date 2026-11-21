/**
 * Add client's live "this PAN is already a client" check — the CRM's rule of
 * 2026-10-15 ("Adding the same PAN again never makes a second client"). The
 * server answers a create with 409 + `existing`, and the web form then offers
 * Reactivate / Restore / Open; the app's form engine only shows the error
 * text, so this notice looks the PAN up while it is typed (GET /api/search,
 * the viewer's own scope) and offers the same way back before Save:
 *
 *   exited / closed → Reactivate (PATCH status active) and open the record
 *   anyone else     → Open the client
 *
 * A client in the Trash is not searchable; the 409 on Save still says so.
 * It only informs — the form still submits.
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { api } from "../../api/client";
import { toast } from "../../lib/toast";
import { useSearch } from "../search/api";
import { palette, radius, spacing } from "../../theme/tokens";
import type { FormValues } from "../forms/types";
import { clientKind, isPan } from "./client-types";

export function PanExistsNotice({ form, isEdit }: { form: FormValues; isEdit: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const pan = String(form.pan ?? "").trim().toUpperCase();
  // A minor is filed under MINOR:<PAN> keys; the server decides those on Save.
  const look = !isEdit && isPan(pan) && clientKind(form.investorCategory) !== "minor";
  const search = useSearch(look ? pan : "");
  if (!look || !search.data || search.isPlaceholderData) return null;
  // The PAN only ever reaches this screen masked: a hit must be that PAN's shape.
  const masked = `${pan.slice(0, 3)}••••${pan.slice(-2)}`;
  const hit = (search.data.investors ?? []).find((r: any) => !r.minor && r.pan_display === masked) as any;
  if (!hit) return null;
  const left = hit.status === "exited" || hit.status === "closed";

  const reactivate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/api/investors/${hit.id}`, { status: "active" });
      qc.invalidateQueries({ queryKey: ["investors"] });
      toast.success(`${hit.name} is Active again`);
      router.replace(`/m/investors/${hit.id}` as any);
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't go through");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
        <Feather name="alert-circle" size={15} color={palette.warning} style={{ marginTop: 1 }} />
        <Text variant="caption" style={{ flex: 1, color: palette.ink }}>
          {left
            ? `${hit.name} already has this PAN and is marked as exited. Reactivate them instead of adding them again.`
            : `A client with this PAN already exists: ${hit.name}.`}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        {left ? <Button label="Reactivate client" size="sm" loading={busy} onPress={reactivate} /> : null}
        <Button label={`Open ${hit.name}`} size="sm" variant="secondary" onPress={() => router.replace(`/m/investors/${hit.id}` as any)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: palette.warning + "66", backgroundColor: palette.warning + "10", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
});
