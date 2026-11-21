/**
 * GrowthChart — a small value-over-time chart for a calculator result
 * (react-native-svg, no chart library): invested as a dashed neutral line, the
 * value line(s) in colour with the first one filled, the y axis in Indian
 * rupees (₹ L / ₹ Cr) and every line's final value labelled at its end.
 *
 * It draws a ChartSpec and nothing else — the spec comes from the compute's
 * own rows (chart.ts chartBlock), so the chart can never show a figure the
 * tables do not. Width follows its container; the axes and text take the
 * theme's colours so it reads on a light or a dark card.
 */

import React from "react";
import { View, StyleSheet, type LayoutChangeEvent } from "react-native";
import Svg, { Path, Line, Circle, Text as SvgText, Defs, LinearGradient, Stop } from "react-native-svg";
import { Text } from "../../components/ui/Text";
import { useTheme } from "../../theme";
import { spacing, radius } from "../../theme/tokens";
import type { ChartSpec } from "./types";
import { axisInr, chartSummary, fmtX, lineColors, niceTicks, spreadLabels, xTickIndexes } from "./chart";

/** `large`: the presenter's size (taller, bigger type). `bare`: no card around it. */
export function GrowthChart({ spec, large = false, bare = false }: { spec: ChartSpec; large?: boolean; bare?: boolean }) {
  const { color } = useTheme();
  const [width, setWidth] = React.useState(0);
  const gradId = `gc${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  const height = large ? 280 : 200;
  const fs = large ? 13 : 10.5; // axis text
  const endFs = large ? 14 : 11; // end labels
  const colors = lineColors(spec.lines);

  const all = spec.lines.flatMap((l) => l.values);
  const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map(axisInr);
  const endLabels = spec.lines.map((l) => axisInr(l.values[l.values.length - 1]));

  // Text widths are estimated (no measuring pass): ~0.6em a character.
  const textW = (s: string, size: number) => s.length * size * 0.6;
  const padL = Math.ceil(Math.max(textW(spec.xLabel, fs), ...tickLabels.map((s) => textW(s, fs)))) + 8;
  const padR = Math.ceil(Math.max(...endLabels.map((s) => textW(s, endFs)))) + 14;
  const padT = 10;
  const padB = fs + 12;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = height - padT - padB;

  const x0 = spec.x[0];
  const x1 = spec.x[spec.x.length - 1];
  const sx = (xv: number) => padL + (x1 === x0 ? 0 : ((xv - x0) / (x1 - x0)) * plotW);
  const sy = (yv: number) => padT + plotH - ((yv - yMin) / (yMax - yMin || 1)) * plotH;

  const pathOf = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${sx(spec.x[i]).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const firstValue = spec.lines.findIndex((l) => l.role !== "invested");
  const baseY = sy(Math.max(yMin, Math.min(0, yMax)));

  const endY = spreadLabels(
    spec.lines.map((l) => sy(l.values[l.values.length - 1])),
    endFs + 3,
    padT + endFs * 0.5,
    padT + plotH,
  );
  const xIdx = xTickIndexes(spec.x.length, large ? 6 : 5);

  return (
    <View
      style={[styles.wrap, !bare && { borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, padding: spacing.md }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={chartSummary(spec)}
    >
      <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height} importantForAccessibility="no-hide-descendants">
          <Defs>
            {firstValue >= 0 ? (
              <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors[firstValue]} stopOpacity={0.28} />
                <Stop offset="1" stopColor={colors[firstValue]} stopOpacity={0.03} />
              </LinearGradient>
            ) : null}
          </Defs>

          {/* Gridlines + y labels */}
          {ticks.map((t, i) => (
            <React.Fragment key={`t${i}`}>
              <Line x1={padL} x2={padL + plotW} y1={sy(t)} y2={sy(t)} stroke={color.line} strokeWidth={t === 0 ? 1.2 : 0.8} />
              <SvgText x={padL - 6} y={sy(t) + fs * 0.35} fontSize={fs} fill={color.muted} textAnchor="end">{tickLabels[i]}</SvgText>
            </React.Fragment>
          ))}

          {/* X labels; the axis caption sits under the y labels */}
          {xIdx.map((i) => (
            <SvgText key={`x${i}`} x={sx(spec.x[i])} y={height - 4} fontSize={fs} fill={color.muted}
              textAnchor={i === 0 ? "start" : i === spec.x.length - 1 ? "end" : "middle"}>
              {fmtX(spec.x[i])}
            </SvgText>
          ))}
          <SvgText x={padL - 6} y={height - 4} fontSize={fs} fill={color.muted} textAnchor="end">{spec.xLabel}</SvgText>

          {/* The first value line's fill, under every line */}
          {firstValue >= 0 ? (
            <Path
              d={`${pathOf(spec.lines[firstValue].values)} L${sx(x1).toFixed(1)},${baseY.toFixed(1)} L${sx(x0).toFixed(1)},${baseY.toFixed(1)} Z`}
              fill={`url(#${gradId})`}
            />
          ) : null}

          {spec.lines.map((l, i) => (
            <Path
              key={`l${i}`}
              d={pathOf(l.values)}
              fill="none"
              stroke={colors[i]}
              strokeWidth={l.role === "invested" ? (large ? 2 : 1.5) : large ? 3 : 2.2}
              strokeDasharray={l.role === "invested" ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* End dots and the final values */}
          {spec.lines.map((l, i) => {
            const ex = sx(x1);
            const ey = sy(l.values[l.values.length - 1]);
            return (
              <React.Fragment key={`e${i}`}>
                <Circle cx={ex} cy={ey} r={large ? 4 : 3} fill={colors[i]} stroke={color.surface} strokeWidth={1.5} />
                <SvgText x={ex + 7} y={endY[i] + endFs * 0.35} fontSize={endFs} fontWeight="700" fill={colors[i]} textAnchor="start">
                  {endLabels[i]}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      </View>

      <View style={styles.legend}>
        {spec.lines.map((l, i) => (
          <View key={i} style={styles.legendItem}>
            <Svg width={16} height={4}>
              <Line x1={1} x2={15} y1={2} y2={2} stroke={colors[i]} strokeWidth={l.role === "invested" ? 2 : 3}
                strokeDasharray={l.role === "invested" ? "3 2" : undefined} strokeLinecap="round" />
            </Svg>
            <Text variant="caption" tone="muted" style={large ? { fontSize: 15 } : undefined}>{l.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm, borderRadius: radius.md },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xs, paddingHorizontal: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
});
