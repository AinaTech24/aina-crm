/**
 * The New lead form's live duplicate scan (web /dashboard/leads/new): once
 * the phone or email looks complete, POST /api/leads/check-duplicate.
 *
 *  - An EXISTING CLIENT with that phone / email wants another product: that is
 *    an opportunity on their record, not a new lead (a lead would duplicate
 *    the person and fail at conversion on the PAN) — "Start opportunity".
 *    A client outside the viewer's book is reported only as "already a
 *    client", with no name or RM.
 *  - An existing LEAD: open it instead of re-creating it.
 *
 * It only informs; the form still submits.
 */

import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { api } from "../../api/client";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import type { FormValues } from "../forms/types";

type LeadMatch = { id: string; name: string; stage: string | null; source: string | null; matchedOn: string[] | string };
type ClientMatch =
  | { id: string; name: string; rmName: string | null; matchedOn: string[]; openOpportunities: number; outsideBook?: undefined }
  | { outsideBook: true; matchedOn: string[] };

/** The opportunity product a lead's first "product of interest" points at. */
function productFor(interest?: string): string | null {
  if (!interest) return null;
  if (/MF|SIP|Lumpsum|ELSS|Index/i.test(interest)) return "mutual_funds";
  if (/Insurance/i.test(interest)) return "life_insurance";
  if (/NPS/i.test(interest)) return "nps";
  if (/FD|Bond/i.test(interest)) return "fd_bonds_ncd";
  if (/PMS/i.test(interest)) return "pms";
  return "other";
}

const joined = (m: string[] | string) => (Array.isArray(m) ? m.join(", ") : m);

export function LeadDuplicateNotice({ form, isEdit }: { form: FormValues; isEdit: boolean }) {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadMatch[]>([]);
  const [clients, setClients] = useState<ClientMatch[]>([]);
  const phone = String(form.phone ?? "");
  const email = String(form.email ?? "").trim();

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (isEdit || (digits.length < 10 && email.length < 5)) { setLeads([]); setClients([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.post<{ matches?: LeadMatch[]; clients?: ClientMatch[] }>("/api/leads/check-duplicate", {
        phone: digits.length >= 10 ? phone : undefined,
        email: email.length >= 5 ? email : undefined,
      }).then((j) => {
        if (!alive) return;
        setLeads(j.matches ?? []);
        setClients(j.clients ?? []);
      }).catch(() => { /* best-effort warning */ });
    }, 450);
    return () => { alive = false; clearTimeout(t); };
  }, [phone, email, isEdit]);

  if (!leads.length && !clients.length) return null;
  const product = productFor(Array.isArray(form.interestProducts) ? form.interestProducts[0] : undefined);

  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      {clients.length ? (
        <View style={[styles.box, { borderColor: palette.brand + "55", backgroundColor: palette.brandLight }]}>
          <Text style={{ fontWeight: fontWeight.semibold }}>{clients.length === 1 ? "This person is already a client" : "These people are already clients"}</Text>
          <Text variant="caption" tone="muted">For another product, start an opportunity on their client record instead of a new lead.</Text>
          {clients.map((m, i) => m.outsideBook ? (
            <Text key={`out-${i}`} variant="caption" tone="muted" style={styles.row}>
              A client in another RM's book matches on {joined(m.matchedOn)}. Ask the branch to start the opportunity on that record.
            </Text>
          ) : (
            <View key={m.id} style={[styles.row, { flexDirection: "row", alignItems: "center", gap: spacing.sm }]}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" style={{ fontWeight: fontWeight.semibold }} numberOfLines={1}>{m.name}</Text>
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {m.rmName ? `RM ${m.rmName} · ` : ""}matched on {joined(m.matchedOn)}
                  {m.openOpportunities > 0 ? ` · ${m.openOpportunities} open opportunit${m.openOpportunities === 1 ? "y" : "ies"}` : ""}
                </Text>
              </View>
              <Button label="Start opportunity" size="sm"
                onPress={() => router.push(`/m/investors/${m.id}?opportunity=new${product ? `&product=${product}` : ""}` as any)} />
            </View>
          ))}
        </View>
      ) : null}
      {leads.length ? (
        <View style={[styles.box, { borderColor: palette.warning + "66", backgroundColor: palette.warning + "12" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Feather name="alert-triangle" size={14} color={palette.warning} />
            <Text style={{ fontWeight: fontWeight.semibold }}>{leads.length} possible duplicate{leads.length === 1 ? "" : "s"}</Text>
          </View>
          {leads.map((m) => (
            <Pressable key={m.id} style={styles.row} onPress={() => router.push(`/m/leads/${m.id}` as any)} accessibilityRole="button">
              <Text variant="caption" style={{ fontWeight: fontWeight.semibold }} numberOfLines={1}>{m.name}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>matched on {joined(m.matchedOn)}{m.stage ? ` · ${m.stage.replace(/_/g, " ")}` : ""} · Open</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  row: { backgroundColor: palette.surface, borderRadius: radius.sm, padding: spacing.sm },
});
