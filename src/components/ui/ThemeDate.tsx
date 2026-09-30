"use client";

/**
 * Value-driven date / date-time field: `onChange` receives the new value
 * string rather than an event.
 *
 * Date and date-time now render the CRM's own picker (DatePicker /
 * DateTimeField) instead of a restyled native input, so every date field in
 * the product opens the same calendar with month and year dropdowns. `time`
 * and `month` keep the native control.
 */

import type { InputHTMLAttributes } from "react";
import { Calendar, Clock } from "lucide-react";
import { DatePicker } from "./DatePicker";
import { DateTimeField } from "./DateTimeField";
import { layoutClasses } from "./DateField";

export function ThemeDate({
  value,
  onChange,
  type = "date",
  className = "",
  wrapperClassName = "",
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  type?: "date" | "datetime-local" | "time" | "month";
  className?: string;
  wrapperClassName?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  // Layout (width, margins) may come on either prop; the picker owns the look.
  const layout = [wrapperClassName, layoutClasses(className)].filter(Boolean).join(" ") || "w-full";
  if (type === "date") {
    return (
      <DatePicker
        value={value ?? ""}
        onChange={onChange}
        className={layout}
        min={typeof rest.min === "string" ? rest.min : undefined}
        max={typeof rest.max === "string" ? rest.max : undefined}
        disabled={rest.disabled}
        id={rest.id}
        name={rest.name}
        required={rest.required}
        placeholder={rest.placeholder}
        ariaLabel={rest["aria-label"]}
      />
    );
  }
  if (type === "datetime-local") {
    return (
      <DateTimeField
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={layout}
        min={typeof rest.min === "string" ? rest.min : undefined}
        max={typeof rest.max === "string" ? rest.max : undefined}
        disabled={rest.disabled}
        id={rest.id}
        name={rest.name}
        required={rest.required}
        aria-label={rest["aria-label"]}
      />
    );
  }

  const Icon = type === "time" ? Clock : Calendar;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input-base pr-9
          [&::-webkit-calendar-picker-indicator]:absolute
          [&::-webkit-calendar-picker-indicator]:right-0
          [&::-webkit-calendar-picker-indicator]:top-0
          [&::-webkit-calendar-picker-indicator]:h-full
          [&::-webkit-calendar-picker-indicator]:w-9
          [&::-webkit-calendar-picker-indicator]:cursor-pointer
          [&::-webkit-calendar-picker-indicator]:opacity-0 ${className}`}
        {...rest}
      />
      <Icon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
    </div>
  );
}
