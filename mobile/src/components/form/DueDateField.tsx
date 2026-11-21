/**
 * DueDateField — a due / follow-up / meeting date with quick chips: "Today
 * 5 pm" (until 5 pm), "Tomorrow 10 am", any the form adds, and the calendar.
 *
 * The value is a due value (./due.ts): a bare day from the calendar, or a day
 * and an India time from a chip or the time picker. `showTime={false}` for a
 * form whose time is its own field (the meeting's time slot); `alwaysTime`
 * keeps a time on every value (FollowUpField's local "YYYY-MM-DDTHH:MM").
 * Plain dates (date of birth …) stay DateField.
 */

import React, { useState } from "react";
import { View, Platform, StyleSheet } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { DateField } from "./DateField";
import { Chip } from "../ui/Chip";
import { TextField } from "../ui/TextField";
import { BottomSheet } from "../ui/BottomSheet";
import { Button } from "../ui/Button";
import { spacing } from "../../theme/tokens";
import { chipSelected, dueChips, joinDue, splitDue, timeLabel, type ExtraDueChip } from "./due";

const pad = (n: number) => String(n).padStart(2, "0");

export function DueDateField({
  label,
  value,
  onChange,
  required,
  error,
  help,
  placeholder,
  min,
  showTime = true,
  alwaysTime,
  defaultTime = "10:00",
  extraChips,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  help?: string;
  placeholder?: string;
  min?: string;
  /** Offer "Add time" / the picked time after the chips. */
  showTime?: boolean;
  /** Every value carries a time (a picked day takes the current or default time). */
  alwaysTime?: boolean;
  /** The time a day is sent at when none is picked (shown as the picker's start). */
  defaultTime?: string;
  /** Day-only chips after the two quick times (e.g. "3 days", "1 week"). */
  extraChips?: ExtraDueChip[];
}) {
  const [timeOpen, setTimeOpen] = useState(false);
  const [webTime, setWebTime] = useState("");
  const { day, time } = splitDue(value);
  const chips = dueChips(Date.now(), extraChips);

  const set = (d: string, t?: string) => onChange(joinDue(d, alwaysTime ? t || time || defaultTime : t));
  const pickChip = (v: string) => {
    const c = splitDue(v);
    // A day-only chip keeps the time already chosen.
    set(c.day, c.time || time || undefined);
  };
  const shownTime = time;
  const pickerDate = (() => {
    const [h, m] = (time || defaultTime).split(":").map(Number);
    const d = new Date();
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  })();

  return (
    <View>
      <DateField
        label={label}
        value={day}
        onChange={(d) => (d ? set(d, time || undefined) : onChange(""))}
        required={required}
        error={error}
        help={help}
        min={min}
        placeholder={placeholder}
      />
      <View style={styles.chips}>
        {chips.map((c) => (
          <Chip key={c.key} label={c.label} selected={chipSelected(c, value, true)} onPress={() => pickChip(c.value)} />
        ))}
        {showTime && day ? (
          <Chip label={shownTime ? timeLabel(shownTime) : "Add time"} selected={false} onPress={() => { setWebTime(time || defaultTime); setTimeOpen(true); }} />
        ) : null}
      </View>

      {timeOpen && Platform.OS === "android" ? (
        <DateTimePicker
          value={pickerDate}
          mode="time"
          display="default"
          onChange={(e, d) => {
            setTimeOpen(false);
            if (e.type === "set" && d) set(day, `${pad(d.getHours())}:${pad(d.getMinutes())}`);
          }}
        />
      ) : null}
      {Platform.OS !== "android" ? (
        <BottomSheet visible={timeOpen} onClose={() => setTimeOpen(false)} title="Time">
          {Platform.OS === "web" ? (
            <TextField label="Time (HH:MM)" value={webTime} onChangeText={setWebTime} />
          ) : (
            <DateTimePicker
              value={pickerDate}
              mode="time"
              display="spinner"
              onChange={(_e, d) => d && set(day, `${pad(d.getHours())}:${pad(d.getMinutes())}`)}
              style={{ alignSelf: "center" }}
            />
          )}
          <Button
            label="Done"
            full
            onPress={() => {
              if (Platform.OS === "web" && /^([01]\d|2[0-3]):[0-5]\d$/.test(webTime)) set(day, webTime);
              setTimeOpen(false);
            }}
          />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: -spacing.sm, marginBottom: spacing.lg },
});
