/**
 * The form engine's section rules — pure, so they are tested on their own.
 *
 *  - A long form (3+ titled sections and 12+ fields on screen) folds its
 *    sections; a short one stays one flat scroll.
 *  - A folded form opens only the first section and any section where
 *    something is missing (a required field empty, or an error); the others
 *    show one line ("3 of 5 filled"). The choice is made when a section first
 *    appears and never changes under the person's fingers — only a tap or an
 *    error opens or closes it after that.
 *  - An error (the form's own check or the server's) opens its section and
 *    scrolls to the first field with one, in field order.
 */

import type { FieldSpec, FormValues, SectionSpec } from "../../features/forms/types";

export const COLLAPSE_MIN_SECTIONS = 3;
export const COLLAPSE_MIN_FIELDS = 12;

/** Whether a field's value counts as filled in ("" / [] / a switch left off do not). */
export function isFilled(field: Pick<FieldSpec, "type">, value: unknown): boolean {
  if (field.type === "readonly") return false;
  if (field.type === "switch") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/** Whether a long-form layout applies: enough titled sections and fields on screen. */
export function shouldCollapse(titledSections: number, visibleFields: number, mode: "auto" | "always" | "never" = "auto"): boolean {
  if (mode === "never") return false;
  if (mode === "always") return titledSections >= 2;
  return titledSections >= COLLAPSE_MIN_SECTIONS && visibleFields >= COLLAPSE_MIN_FIELDS;
}

/** A section's fields that show for this form state. */
export function visibleFieldsOf(section: SectionSpec, form: FormValues, show: (f: FieldSpec) => boolean = () => true): FieldSpec[] {
  return section.fields.filter((f) => show(f) && (!f.visibleIf || f.visibleIf(form)));
}

/** "3 of 5 filled" (readonly lines don't count), or the spec's own summary. */
export function sectionSummary(section: SectionSpec, fields: FieldSpec[], form: FormValues): string {
  const own = section.summary?.(form);
  if (own != null) return own;
  const counted = fields.filter((f) => f.type !== "readonly");
  if (!counted.length) return "";
  const filled = counted.filter((f) => isFilled(f, form[f.key])).length;
  return `${filled} of ${counted.length} filled`;
}

/** Something to do here: an error on a field, or a required field left empty. */
export function needsAttention(fields: FieldSpec[], form: FormValues, errors: Record<string, string | undefined> | null | undefined): boolean {
  return fields.some((f) => !!errors?.[f.key] || (!!f.required && f.type !== "readonly" && !isFilled(f, form[f.key])));
}

/**
 * Open at first sight? The first section, a section marked defaultOpen, an
 * untitled one (it has no header to open it by), or one that needs attention.
 */
export function initiallyOpen(opts: { first: boolean; section: SectionSpec; attention: boolean }): boolean {
  if (opts.section.defaultOpen === false && !opts.attention) return false;
  return opts.first || !opts.section.title || !!opts.section.defaultOpen || opts.attention;
}

/** The first key (in field order) that has an error. */
export function firstErrorKey(orderedKeys: string[], errors: Record<string, string | undefined> | null | undefined): string | null {
  if (!errors) return null;
  return orderedKeys.find((k) => !!errors[k]) ?? null;
}

/**
 * The server's field errors, for the fields on this form: zod `issues`
 * (`path[0]` is the body key) or a flattened `details.fieldErrors`. Only keys
 * the form shows are kept — a body key the form names differently stays in
 * the banner only.
 */
export function serverFieldErrors(body: any, formKeys: string[]): Record<string, string> {
  const keys = new Set(formKeys);
  const out: Record<string, string> = {};
  const put = (k: unknown, msg: unknown) => {
    const key = typeof k === "string" ? k : typeof k === "number" ? String(k) : "";
    if (key && keys.has(key) && typeof msg === "string" && msg.trim() && !out[key]) out[key] = msg.trim();
  };
  if (Array.isArray(body?.issues)) for (const i of body.issues) if (Array.isArray(i?.path)) put(i.path[0], i.message);
  const fe = body?.details?.fieldErrors ?? body?.fieldErrors;
  if (fe && typeof fe === "object") for (const [k, v] of Object.entries(fe)) put(k, Array.isArray(v) ? v.find((m) => typeof m === "string") : v);
  if (typeof body?.field === "string") put(body.field, body.error);
  return out;
}

/** A section on screen: its place in the step and the fields that show. */
export interface ShownSection {
  section: SectionSpec;
  index: number;
  fields: FieldSpec[];
}

/** The sections a step shows for this form state (a section with no field showing is left out). */
export function shownSections(sections: SectionSpec[], form: FormValues, show: (f: FieldSpec) => boolean = (f) => !f.visibleIf || f.visibleIf(form)): ShownSection[] {
  return sections
    .map((section, index) => ({ section, index, fields: section.fields.filter(show) }))
    .filter(({ section, fields }) => (!section.visibleIf || section.visibleIf(form)) && fields.length > 0);
}

/** Whether these sections make a long (folded) form. */
export function isLongForm(shown: ShownSection[], mode: "auto" | "always" | "never" = "auto"): boolean {
  return shouldCollapse(shown.filter((x) => x.section.title).length, shown.reduce((n, x) => n + x.fields.length, 0), mode);
}

/** Open at first sight, per shown section, given the errors known now (the form's check + any shown). */
export function openAtFirstSight(shown: ShownSection[], form: FormValues, known: Record<string, string | undefined> | null): boolean[] {
  return shown.map(({ section, fields }, i) => initiallyOpen({ first: i === 0, section, attention: needsAttention(fields, form, known) }));
}
