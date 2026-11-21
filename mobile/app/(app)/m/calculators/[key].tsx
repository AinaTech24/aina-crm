/**
 * A single calculator, rendered entirely from its registry definition: inputs on
 * top, live results below, and a one-tap WhatsApp share of the result summary —
 * the whole point of a field calculator is to show a prospect and send it over.
 *
 * Fund Research calculators name the schemes they need (`navSchemes`); their
 * NAV histories load here and reach the pure compute as `ctx.nav`.
 *
 * Present opens the same result full screen for the client (presenter mode) —
 * every calculator but the firm's own AUM Opportunity (`present: false`).
 */

import React from "react";
import { View, Pressable, Linking, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { calcByKey } from "../../../../src/features/calculators/registry";
import { CalcInput, ResultBlockView, resultsToText } from "../../../../src/features/calculators/CalcUI";
import { useNavHistories } from "../../../../src/features/calculators/SchemeInput";
import type { CalcContext, CalculatorDef, ResultBlock } from "../../../../src/features/calculators/types";
import { useTenant } from "../../../../src/features/settings/api";
import { toast } from "../../../../src/lib/toast";
import { usePresenter } from "../../../../src/features/presenter/Presenter";
import { CalculatorPresentation } from "../../../../src/features/presenter/CalculatorPresentation";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

const seedValues = (def: CalculatorDef | undefined): Record<string, any> => {
  const seed: Record<string, any> = {};
  def?.inputs.forEach((i) => { seed[i.key] = i.default; });
  return seed;
};

export default function CalculatorScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const tenant = useTenant();
  const def = calcByKey(String(key));

  // Seed values from the definition's defaults (once).
  const [values, setValues] = React.useState<Record<string, any>>(() => seedValues(def));

  // NAV histories a Fund Research tool needs (none for every other calculator).
  const codes = React.useMemo(() => {
    if (!def?.navSchemes) return [];
    try { return Array.from(new Set(def.navSchemes(values).filter(Boolean))); } catch { return []; }
  }, [def, values]);
  const navs = useNavHistories(codes);
  const presenter = usePresenter();

  const loading = navs.filter((n) => n.status === "loading");
  const failed = navs.filter((n) => n.status === "error");
  const navKey = navs.map((n) => `${n.code}:${n.status}`).join("|");

  // Compute once per change of the values or of the loaded NAVs — rolling
  // returns over five long histories are not free on a phone.
  const result = React.useMemo((): { blocks: ResultBlock[]; error: boolean } => {
    if (!def || loading.length > 0) return { blocks: [], error: false };
    const ctx: CalcContext = { nav: Object.fromEntries(navs.filter((n) => n.series).map((n) => [n.code, n.series])) };
    try { return { blocks: def.compute(values, ctx), error: false }; } catch { return { blocks: [], error: true }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, values, navKey]);

  if (!def) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Calculator" />
        <View style={{ padding: spacing.xl }}><Text variant="body" tone="muted">This calculator doesn't exist.</Text></View>
      </View>
    );
  }

  const set = (k: string, v: any) => setValues((prev) => ({ ...prev, [k]: v }));
  const visibleInputs = def.inputs.filter((i) => !i.visibleIf || i.visibleIf(values));

  const { blocks, error: computeError } = result;
  /** The scheme a failed NAV load belongs to, by the name picked for it. */
  const schemeName = (code: string): string | null => {
    for (const v of Object.values(values)) if (v && typeof v === "object" && v.code === code && v.name) return String(v.name);
    return null;
  };

  const t = tenant.data?.tenant ?? tenant.data;
  const firm = t?.displayName || t?.legalName || "Your advisor";
  const share = () => {
    if (blocks.length === 0) { toast.error("Nothing to share yet"); return; }
    const text = resultsToText(def.name, firm, blocks);
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() => toast.error("Couldn't open WhatsApp"));
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader
        title={def.name}
        subtitle={def.desc}
        right={<Pressable accessibilityRole="button" accessibilityLabel="Share result" onPress={share} hitSlop={8} style={styles.shareBtn}><Feather name="share-2" size={16} color={palette.white} /></Pressable>}
      />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* Inputs */}
        <Card>
          {visibleInputs.map((spec) => (
            <CalcInput key={spec.key} spec={spec} value={values[spec.key]} onChange={(v) => set(spec.key, v)} />
          ))}
          <Pressable accessibilityRole="button" onPress={() => setValues(seedValues(def))} style={styles.reset} hitSlop={6}>
            <Feather name="rotate-ccw" size={13} color={palette.muted} />
            <Text variant="caption" tone="muted">Reset to defaults</Text>
          </Pressable>
        </Card>

        {/* Results */}
        <View style={{ marginTop: spacing.xl }}>
          {loading.length > 0 ? (
            <Card flat>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <ActivityIndicator color={palette.brand} />
                <Text variant="body" tone="muted">Loading NAV history…</Text>
              </View>
            </Card>
          ) : computeError ? (
            <Card flat><Text variant="body" tone="muted">Enter valid numbers to see the result.</Text></Card>
          ) : (
            <>
              {failed.map((f) => (
                <ResultBlockView key={f.code} block={{ type: "insight", tone: "danger", text: `${schemeName(f.code) ?? `Scheme ${f.code}`}: ${f.error ?? "Could not load the NAV history."}` }} />
              ))}
              {blocks.map((b, i) => <ResultBlockView key={i} block={b} />)}
            </>
          )}
        </View>

        {def.present !== false ? (
          <Pressable
            style={({ pressed }) => [styles.presentCta, (blocks.length === 0 || pressed) && { opacity: blocks.length === 0 ? 0.5 : 0.8 }]}
            onPress={presenter.open}
            disabled={blocks.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Present to the client"
          >
            <Feather name="maximize-2" size={16} color={palette.ink} />
            <Text style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>Present</Text>
          </Pressable>
        ) : null}

        {/* Share CTA */}
        <Pressable style={[styles.shareCta, def.present === false && { marginTop: spacing.xl }]} onPress={share}>
          <Feather name="message-circle" size={16} color={palette.white} />
          <Text style={{ color: palette.white, fontWeight: fontWeight.semibold }}>Share on WhatsApp</Text>
        </Pressable>
        <Text variant="caption" tone="faint" style={{ textAlign: "center", marginTop: spacing.md }}>
          Illustration only. Mutual fund investments are subject to market risks.
        </Text>
      </Screen>
      {def.present !== false ? (
        <CalculatorPresentation visible={presenter.visible} onClose={presenter.close} name={def.name} blocks={blocks} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shareBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.success, alignItems: "center", justifyContent: "center" },
  shareCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.success, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  presentCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xl, minHeight: 48 },
  reset: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", paddingVertical: 4, minHeight: 28 },
});
