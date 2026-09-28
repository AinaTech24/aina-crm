"use client";

/**
 * Field — one labelled form control, wired correctly.
 *
 * The audit found 298 `<label>` elements across 123 files with neither
 * `htmlFor` nor a wrapped input — including Add client, New family, Document
 * upload and Accept invite. Clicking those labels does nothing and a screen
 * reader announces an unnamed box. Separately, only 4 files in the whole app
 * use `aria-invalid` or `role="alert"`, so validation errors are neither
 * announced nor rendered consistently.
 *
 * `<Field>` generates the id, wires `htmlFor`, marks required, renders helper
 * text in a place that survives focus, and owns the error slot:
 *
 *   <Field label="PAN card no" required hint="Ten characters, e.g. ABCDE1234F" error={errors.pan}>
 *     {(id, describedBy, invalid) => (
 *       <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="input-base" />
 *     )}
 *   </Field>
 *
 * The render-prop form is deliberate: the app has native inputs, custom
 * <Select>s, date pickers and file fields, and all of them need the same three
 * wires. A wrapper that cloned children would break on the ones that forward
 * refs.
 *
 * `hint` exists because the forms currently put guidance in placeholders
 * ("self / spouse / …", "last 4 digits only", "Same as mobile if blank"), which
 * vanish the moment the user starts typing — exactly when they are needed.
 */

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  children,
  hint,
  error,
  required = false,
  optional = false,
  className,
}: {
  label: ReactNode;
  /** (id, describedBy, invalid) → the control. */
  children: (id: string, describedBy: string | undefined, invalid: boolean) => ReactNode;
  /** Persistent guidance. Use instead of a placeholder that explains the field. */
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Say so explicitly on a mostly-required form; clearer than an absent asterisk. */
  optional?: boolean;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </label>

      {children(id, describedBy, invalid)}

      {hint && !invalid && (
        <p id={hintId} className="text-xs text-muted-foreground leading-relaxed">
          {hint}
        </p>
      )}
      {invalid && (
        <p id={errorId} role="alert" className="text-xs text-destructive leading-relaxed">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The section divider inside a long form. Previously an 11px all-caps grey
 * string, which read as fine print rather than structure.
 */
export function FieldSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card-surface p-5", className)}>
      <div className="mb-4">
        <h2 className="section-title">{title}</h2>
        {description && <p className="section-subtitle mt-0.5">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
