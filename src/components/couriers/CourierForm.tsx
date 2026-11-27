"use client";

/**
 * Add or edit a courier. The Courier Type decides which details are asked
 * (sender or recipient) and which statuses are offered. Checked here with the
 * same rules the API applies.
 */

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
  COURIER_CATEGORIES, COURIER_LABELS, COURIER_LIMITS, COURIER_STATUSES, COURIER_TYPES, CourierBody, DEFAULT_STATUS,
  PAYMENT_MODES, optionLabel, type CourierField, type CourierType, type Option,
} from "@/lib/couriers/entry";

export type CourierFormValues = Record<CourierField, string>;

type Errors = Partial<Record<CourierField, string>>;

export function CourierForm({
  id,
  initial,
  cancelHref,
}: {
  /** The courier being edited; absent when adding one. */
  id?: string;
  initial: CourierFormValues;
  cancelHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<CourierFormValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const type = values.courierType as CourierType;
  const inward = type === "inward";

  const set = (field: CourierField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  /** A status the new type does not have becomes that type's starting one. */
  const setType = (next: CourierType) => {
    setValues((v) => ({
      ...v,
      courierType: next,
      status: COURIER_STATUSES[next].some((s) => s.value === v.status) ? v.status : DEFAULT_STATUS[next],
    }));
    setErrors({});
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = CourierBody.safeParse(values);
    const found: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) found[issue.path[0] as CourierField] ??= issue.message;
    }
    setErrors(found);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(id ? `/api/couriers/${id}` : "/api/couriers", {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the courier.");
      toast.success(id ? "Courier updated." : "Courier recorded.");
      router.push(`/dashboard/couriers/${body.courier.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the courier.");
      setSaving(false);
    }
  };

  const text = (field: CourierField, kind: "text" | "email" | "tel" = "text", opts: { required?: boolean; maxLength?: number; inputMode?: "decimal" } = {}) => (
    <Field label={COURIER_LABELS[field]} required={opts.required} error={errors[field]}>
      {(inputId, describedBy, invalid) => (
        <input
          id={inputId}
          type={kind}
          inputMode={opts.inputMode}
          value={values[field]}
          onChange={(e) => set(field, e.target.value)}
          maxLength={opts.maxLength ?? COURIER_LIMITS.line}
          required={opts.required}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className="input-base w-full"
        />
      )}
    </Field>
  );

  const area = (field: CourierField) => (
    <Field label={COURIER_LABELS[field]} error={errors[field]} className="sm:col-span-2">
      {(inputId, describedBy, invalid) => (
        <textarea
          id={inputId}
          rows={3}
          value={values[field]}
          onChange={(e) => set(field, e.target.value)}
          maxLength={COURIER_LIMITS.text}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className="input-base w-full h-auto py-2"
        />
      )}
    </Field>
  );

  const day = (field: CourierField, required = false) => (
    <Field label={COURIER_LABELS[field]} required={required} error={errors[field]}>
      {(inputId) => <DateField id={inputId} value={values[field]} onChange={(e) => set(field, e.target.value)} className="w-full" />}
    </Field>
  );

  const pick = (field: CourierField, options: Option[], blank?: string, required = false) => (
    <Field label={COURIER_LABELS[field]} required={required} error={errors[field]}>
      {(inputId) => (
        <SelectField id={inputId} value={values[field]} onChange={(e) => set(field, e.target.value)}>
          {blank !== undefined && <option value="">{blank}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectField>
      )}
    </Field>
  );

  const initialType = initial.courierType as CourierType;

  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <FieldSection title="Courier Information">
        <Field
          label={COURIER_LABELS.courierType}
          required
          error={errors.courierType}
          hint={id && type !== initialType
            ? `Saving removes the ${optionLabel(COURIER_TYPES, initialType)?.toLowerCase()} details entered earlier.`
            : undefined}
        >
          {(inputId) => (
            <SelectField id={inputId} value={type} onChange={(e) => setType(e.target.value as CourierType)}>
              {COURIER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectField>
          )}
        </Field>
        {day("courierDate", true)}
        {text("courierCompany")}
        {text("trackingNumber")}
        {pick("status", COURIER_STATUSES[type], undefined, true)}
        {pick("category", COURIER_CATEGORIES, "Not specified")}
        {values.category === "other" && text("categoryOther", "text", { required: true })}
        {area("description")}
        {area("remarks")}
      </FieldSection>

      {inward ? (
        <FieldSection title="Sender Details">
          {text("senderName")}
          {text("senderCompany")}
          {text("senderMobile", "tel", { maxLength: COURIER_LIMITS.mobile })}
          {text("senderEmail", "email")}
          {area("senderAddress")}
          {day("receivedDate")}
        </FieldSection>
      ) : (
        <FieldSection title="Recipient Details">
          {text("recipientName")}
          {text("recipientCompany")}
          {text("recipientMobile", "tel", { maxLength: COURIER_LIMITS.mobile })}
          {text("recipientEmail", "email")}
          {area("recipientAddress")}
          {day("dispatchDate")}
          {day("deliveredDate")}
          {text("courierCharges", "text", { inputMode: "decimal", maxLength: 16 })}
          {pick("paymentMode", PAYMENT_MODES, "Not specified")}
        </FieldSection>
      )}

      <FormActions>
        <Link href={cancelHref} className={buttonClass("ghost")}>Cancel</Link>
        <Button type="submit" variant="primary" loading={saving}>{id ? "Save changes" : "Save courier"}</Button>
      </FormActions>
    </form>
  );
}
