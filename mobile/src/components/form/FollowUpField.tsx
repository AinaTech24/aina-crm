import React, { useState } from "react";
import { View, Pressable, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { DateField } from "./DateField";
import { Text, TextField, BottomSheet, Button } from "../ui";
import { spacing } from "../../theme/tokens";

/** Local date/time input; conversion to an instant happens only on submission. */
export function FollowUpField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = value.split("T")[0], time = value.split("T")[1]?.slice(0, 5) || "09:00";
  const chooseDay = (days: number) => {
    const d = new Date(); d.setDate(d.getDate() + days);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${time}`);
  };
  const picker = <DateTimePicker value={new Date(`${date || "2026-01-01"}T${time}:00`)} mode="time" onChange={(event, d) => {
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "set" && d) onChange(`${date}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  }} />;
  return <View style={{ gap: spacing.sm }}>
    <View style={{ flexDirection: "row", gap: spacing.lg }}>
      {[{ label: "Today", days: 0 }, { label: "Tomorrow", days: 1 }, { label: "Next week", days: 7 }].map(p => <Pressable key={p.label} accessibilityRole="button" style={{ minHeight: 48, justifyContent: "center" }} onPress={() => chooseDay(p.days)}><Text tone="brand">{p.label}</Text></Pressable>)}
    </View>
    <DateField label="Next follow-up (optional)" value={date} onChange={day => onChange(day ? `${day}T${time}` : "")} />
    {date ? Platform.OS === "web" ? <TextField label="Time (HH:MM)" value={time} onChangeText={v => onChange(`${date}T${v}`)} /> : <Pressable accessibilityRole="button" style={{ minHeight: 48, justifyContent: "center" }} onPress={() => setOpen(true)}><Text tone="brand">Time: {time} · Change</Text></Pressable> : null}
    {open && Platform.OS === "android" ? picker : null}
    {Platform.OS === "ios" ? <BottomSheet visible={open} onClose={() => setOpen(false)} title="Follow-up time">{picker}<Button label="Done" onPress={() => setOpen(false)} /></BottomSheet> : null}
  </View>;
}
