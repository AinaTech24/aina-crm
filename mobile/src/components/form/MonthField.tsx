import React, { useState } from "react";
import { View } from "react-native";
import { Text, Button, BottomSheet, SelectField } from "../ui";
import { spacing } from "../../theme/tokens";

export function MonthField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [year, month] = value.split("-");
  const move = (delta: number) => { const d = new Date(Number(year), Number(month) - 1 + delta, 1); onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return <View style={{ gap: spacing.sm, marginVertical: spacing.md }}>
    <Text variant="label">Month</Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Button label="‹" accessibilityLabel="Previous month" variant="secondary" disabled={disabled} onPress={() => move(-1)} />
      <Button label={label} variant="secondary" disabled={disabled} onPress={() => setOpen(true)} style={{ flex: 1 }} />
      <Button label="›" accessibilityLabel="Next month" variant="secondary" disabled={disabled} onPress={() => move(1)} />
    </View>
    <BottomSheet visible={open} onClose={() => setOpen(false)} title="Choose month">
      <SelectField label="Year" value={year} options={Array.from({ length: 11 }, (_, i) => String(new Date().getFullYear() - 5 + i))} onChange={v => onChange(`${v}-${month}`)} />
      <SelectField label="Month" value={month} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1).padStart(2, "0"), label: new Date(2026, i, 1).toLocaleDateString("en-IN", { month: "long" }) }))} onChange={v => onChange(`${year}-${v}`)} />
      <Button label="Done" onPress={() => setOpen(false)} />
    </BottomSheet>
  </View>;
}
