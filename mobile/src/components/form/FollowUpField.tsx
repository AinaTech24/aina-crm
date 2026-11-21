import React from "react";
import { DueDateField } from "./DueDateField";

/**
 * A follow-up date AND time ("YYYY-MM-DDTHH:MM", the India wall-clock time the
 * person picked — send it with istToIso from ./due). Quick chips: Today 5 pm,
 * Tomorrow 10 am, Next week; a day from the calendar keeps the time already
 * chosen (09:00 to start).
 */
export function FollowUpField({ value, onChange, label = "Next follow-up (optional)" }: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <DueDateField
      label={label}
      value={value}
      onChange={onChange}
      alwaysTime
      defaultTime="09:00"
      extraChips={[{ label: "Next week", days: 7 }]}
    />
  );
}
