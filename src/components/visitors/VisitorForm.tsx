"use client";

/** Add or edit a visit. Checked here with the same rules the API applies. */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClass } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Field, FieldSection } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import {
  EXIT_BEFORE_ENTRY, VISITOR_LABELS, VISITOR_LIMITS, VisitorCreateBody, exitBeforeEntry, type VisitorField,
} from "@/lib/visitors/entry";

export type VisitorFormValues = Record<VisitorField, string>;

type Errors = Partial<Record<VisitorField, string>>;

export function VisitorForm({
  id,
  initial,
  users,
  cancelHref,
}: {
  /** The visit being edited; absent when adding one. */
  id?: string;
  initial: VisitorFormValues;
  users: { id: string; name: string }[];
  cancelHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<VisitorFormValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const set = (field: VisitorField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = VisitorCreateBody.safeParse(values);
    const found: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) found[issue.path[0] as VisitorField] ??= issue.message;
    } else if (exitBeforeEntry(parsed.data.entryTime, parsed.data.exitTime)) {
      found.exitTime = EXIT_BEFORE_ENTRY;
    }
    setErrors(found);
    if (!parsed.success || Object.keys(found).length) return;

    setSaving(true);
    try {
      const res = await fetch(id ? `/api/visitors/${id}` : "/api/visitors", {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the visit.");
      toast.success(id ? "Visit updated." : "Visit recorded.");
      router.push(`/dashboard/visitors/${body.visitor.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the visit.");
      setSaving(false);
    }
  };

  const text = (field: VisitorField, type: "text" | "email" | "tel" | "time", opts: { required?: boolean; maxLength?: number } = {}) => (
    <Field label={VISITOR_LABELS[field]} required={opts.required} error={errors[field]}>
      {(inputId, describedBy, invalid) => (
        <input
          id={inputId}
          type={type}
          value={values[field]}
          onChange={(e) => set(field, e.target.value)}
          maxLength={opts.maxLength}
          required={opts.required}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className="input-base w-full"
        />
      )}
    </Field>
  );

  const area = (field: VisitorField) => (
    <Field label={VISITOR_LABELS[field]} error={errors[field]} className="sm:col-span-2">
      {(inputId, describedBy, invalid) => (
        <textarea
          id={inputId}
          rows={3}
          value={values[field]}
          onChange={(e) => set(field, e.target.value)}
          maxLength={VISITOR_LIMITS.text}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className="input-base w-full h-auto py-2"
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <FieldSection title="Visitor">
        {text("visitorName", "text", { required: true, maxLength: VISITOR_LIMITS.line })}
        {text("email", "email", { maxLength: VISITOR_LIMITS.line })}
        {text("mobile", "tel", { maxLength: VISITOR_LIMITS.mobile })}
        {text("companyName", "text", { maxLength: VISITOR_LIMITS.line })}
      </FieldSection>

      <FieldSection title="Visit">
        <Field label={VISITOR_LABELS.visitDate} required error={errors.visitDate} className="sm:col-span-2 sm:max-w-xs">
          {(inputId) => <DateField id={inputId} value={values.visitDate} onChange={(e) => set("visitDate", e.target.value)} className="w-full" />}
        </Field>
        {text("entryTime", "time")}
        {text("exitTime", "time")}
        {area("purpose")}
        <Field label={VISITOR_LABELS.meetingWithUserId} error={errors.meetingWithUserId} className="sm:col-span-2 sm:max-w-sm">
          {(inputId) => (
            <SelectField id={inputId} value={values.meetingWithUserId} onChange={(e) => set("meetingWithUserId", e.target.value)} searchable searchPlaceholder="Search team members">
              <option value="">Not specified</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </SelectField>
          )}
        </Field>
        {area("remarks")}
      </FieldSection>

      <FormActions>
        <Link href={cancelHref} className={buttonClass("ghost")}>Cancel</Link>
        <Button type="submit" variant="primary" loading={saving}>{id ? "Save changes" : "Save visit"}</Button>
      </FormActions>
    </form>
  );
}
