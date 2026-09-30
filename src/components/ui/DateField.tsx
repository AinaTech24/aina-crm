"use client";

/**
 * Drop-in replacement for <input type="date">, rendering the CRM's
 * <DatePicker>. Same call-site shape — `value` (ISO yyyy-mm-dd) and
 * `onChange(e)` reading `e.target.value` — so a conversion is a tag rename:
 *
 *   <input type="date" …/>  →  <DateField …/>
 *
 * Also works uncontrolled, the way plain GET/POST forms use a native input:
 * `defaultValue` + `name` posts the ISO value through a hidden input.
 *
 * Only layout classes (width, flex, margin, grid span) are taken from
 * `className` — the look comes from the picker. A compact native input
 * (`h-7`, `h-8`, `text-xs`, `text-2xs`) becomes the small size.
 */

import { useState } from "react";
import { DatePicker } from "./DatePicker";

const LAYOUT = /^(!?w-|min-w-|max-w-|flex$|flex-|grow|shrink|basis-|col-span-|row-span-|order-|self-|justify-self-|m-|mt-|mb-|ml-|mr-|mx-|my-|sm:|md:|lg:)/;

export function layoutClasses(cn?: string): string {
  if (!cn) return "";
  return cn.split(/\s+/).filter((c) => LAYOUT.test(c) && !/^(sm|md|lg):(h-|text-|p[xy]?-|border|rounded)/.test(c)).join(" ");
}

export function sizeFromClasses(cn?: string): "sm" | "md" {
  return cn && /(^|\s)(h-7|h-8|text-xs|text-2xs)(\s|$)/.test(cn) ? "sm" : "md";
}

/** The event shape native inputs hand to onChange, as far as callers read it. */
export type DateChangeEvent = {
  target: { value: string; name?: string };
  currentTarget: { value: string; name?: string };
  stopPropagation(): void;
  preventDefault(): void;
};

export function dateEvent(value: string, name?: string): DateChangeEvent {
  return {
    target: { value, name },
    currentTarget: { value, name },
    stopPropagation() {},
    preventDefault() {},
  };
}

export function DateField({
  value,
  defaultValue,
  onChange,
  className,
  disabled,
  min,
  max,
  id,
  name,
  required,
  placeholder,
  size,
  "aria-label": ariaLabel,
}: {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (e: DateChangeEvent) => void;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  name?: string;
  required?: boolean;
  placeholder?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
  // tolerated leftovers from a mechanical conversion
  title?: string;
  autoFocus?: boolean;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState((defaultValue ?? "").slice(0, 10));
  const current = controlled ? (value ?? "").slice(0, 10) : inner;

  return (
    <DatePicker
      value={current}
      onChange={(iso) => {
        if (!controlled) setInner(iso);
        onChange?.(dateEvent(iso, name));
      }}
      className={layoutClasses(className) || "w-full"}
      disabled={disabled}
      min={min}
      max={max}
      id={id}
      name={name}
      required={required}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      size={size ?? sizeFromClasses(className)}
    />
  );
}
