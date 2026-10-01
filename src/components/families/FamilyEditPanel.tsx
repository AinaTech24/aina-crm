"use client";

/**
 * Inline edit panel for the Family detail page.
 *
 * Edits the family-level fields: name, code, category, head of family (one of
 * its live members), RM, review frequency and dates, notes. Member CRUD lives
 * in the AddMemberDialog / the members table — out of scope here.
 *
 * Clearing the notes clears them (it used to send nothing, so they could never
 * be emptied). The head's name follows the member picked as head.
 *
 * Review frequency: changing it (or the first meeting date) moves "Next
 * review" to the date the cadence gives — the same rule the server applies
 * (lib/families/cadence nextFamilyReview). A next review typed by hand wins.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { SelectField } from "@/components/ui/SelectField";
import { DatePicker } from "@/components/ui/DatePicker";
import { FAMILY_REVIEW_FREQUENCIES, nextFamilyReview } from "@/lib/families/cadence";

export function FamilyEditPanel({
  family,
  members,
  rms,
}: {
  family: any;
  members: Array<{ id: string; name: string; pan: string }>;
  rms: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initial = () => ({
    familyName: family.familyName ?? family.headName ?? "",
    headName: family.headName ?? "",
    primaryInvestorId: family.primaryInvestorId ?? "",
    rmId: family.rmId ?? "",
    reviewFrequency: (family.reviewFrequency as string | null) ?? "",
    firstMeetingDate: family.firstMeetingDate ? String(family.firstMeetingDate).slice(0, 10) : "",
    lastReviewAt: family.lastReviewAt ? toDateInput(family.lastReviewAt) : "",
    nextReviewAt: family.nextReviewAt ? toDateInput(family.nextReviewAt) : "",
    notes: family.notes ?? "",
    familyCode: family.familyCode ?? "",
    familyCategory: (family.familyCategory as string | null) ?? "",
  });

  const [form, setForm] = useState(initial);
  /** The next review was typed by hand — the cadence no longer moves it. */
  const [nextTouched, setNextTouched] = useState(false);

  function set(k: keyof ReturnType<typeof initial>, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  /** A cadence input changed: move "Next review" to what the cadence gives. */
  function setCadence(k: "reviewFrequency" | "firstMeetingDate", v: string) {
    setForm((s) => {
      const next = { ...s, [k]: v };
      if (!nextTouched) {
        const d = nextFamilyReview({
          frequency: next.reviewFrequency || null,
          firstMeeting: next.firstMeetingDate || null,
          lastReview: next.lastReviewAt || null,
          since: family.createdAt ?? null,
        });
        if (d) next.nextReviewAt = toIsoDate(d);
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const head = members.find((m) => m.id === form.primaryInvestorId);
      const payload: any = {
        familyName: form.familyName.trim(),
        headName: head?.name ?? (form.headName || form.familyName),
        primaryInvestorId: form.primaryInvestorId || null,
        rmId: form.rmId || null,
        notes: form.notes.trim() ? form.notes : null,
        familyCode: form.familyCode.trim() || null,
        familyCategory: form.familyCategory || null,
      };
      if (form.lastReviewAt) payload.lastReviewAt = new Date(form.lastReviewAt).toISOString();
      // Cadence fields only when they changed — sending them unchanged would
      // make the server re-derive the next review on an unrelated edit.
      const init = initial();
      if (form.reviewFrequency !== init.reviewFrequency) payload.reviewFrequency = form.reviewFrequency || null;
      if (form.firstMeetingDate !== init.firstMeetingDate) payload.firstMeetingDate = form.firstMeetingDate || null;
      // A next review typed by hand is sent as is ("" clears it); otherwise
      // the server derives it from the cadence.
      if (nextTouched) payload.nextReviewAt = form.nextReviewAt ? new Date(form.nextReviewAt).toISOString() : "";

      const res = await fetch(`/api/families/${family.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setForm(initial());
    setNextTouched(false);
    setEditing(false);
    setErr(null);
  }

  if (!editing) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing(true)} className={buttonClass("secondary", "sm")}>
          <Pencil className="size-3.5" /> Edit details
        </button>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-3">
      <div className="flex items-center justify-between border-b pb-3">
        <h2 className="font-semibold">Edit family</h2>
        <div className="flex gap-2">
          <button type="button" onClick={cancel} disabled={busy} className={buttonClass("secondary", "sm")}>
            <X className="size-3.5" /> Cancel
          </button>
          <button type="button" onClick={save} disabled={busy || form.familyName.trim().length < 2} className={buttonClass("primary", "sm")}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {err && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">{err}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Family name">
          <input value={form.familyName} onChange={(e) => set("familyName", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Head of family">
          <SelectField
            value={form.primaryInvestorId}
            onChange={(e) => set("primaryInvestorId", e.target.value)}
            className="w-full"
            aria-label="Head of family"
          >
            <option value="">— Not set —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.pan ? ` · ${m.pan}` : ""}</option>
            ))}
          </SelectField>
        </Field>
        <Field label="Family code">
          <input
            value={form.familyCode}
            onChange={(e) => set("familyCode", e.target.value)}
            maxLength={60}
            placeholder="e.g. your back-office group code"
            className={inputCls}
          />
        </Field>
        <Field label="Category">
          <SelectField
            value={form.familyCategory}
            onChange={(e) => set("familyCategory", e.target.value)}
            className="w-full"
            aria-label="Family category"
          >
            <option value="">— Not set —</option>
            {FAMILY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </SelectField>
        </Field>
        <Field label="Family RM">
          <SelectField
            value={form.rmId}
            onChange={(e) => set("rmId", e.target.value)}
            className="w-full"
            aria-label="Family RM"
          >
            <option value="">— None assigned —</option>
            {rms.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </SelectField>
        </Field>
        <Field label="Review frequency">
          <SelectField
            value={form.reviewFrequency}
            onChange={(e) => setCadence("reviewFrequency", e.target.value)}
            className="w-full"
            aria-label="Review frequency"
          >
            <option value="">None</option>
            {FAMILY_REVIEW_FREQUENCIES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </SelectField>
        </Field>
        <Field label="First meeting date">
          <DatePicker value={form.firstMeetingDate} onChange={(iso) => setCadence("firstMeetingDate", iso)} className="w-full" ariaLabel="First meeting date" />
        </Field>
        <Field label="Last review">
          <DatePicker value={form.lastReviewAt} onChange={(iso) => set("lastReviewAt", iso)} className="w-full" ariaLabel="Last review date" />
        </Field>
        <Field label="Next review">
          <DatePicker
            value={form.nextReviewAt}
            onChange={(iso) => {
              setNextTouched(true);
              set("nextReviewAt", iso);
            }}
            className="w-full"
            ariaLabel="Next review date"
          />
        </Field>
      </div>
      {form.reviewFrequency && !nextTouched && (
        <p className="text-2xs text-muted-foreground">
          Next review follows the frequency — from the first meeting date, else the last review. Pick a date to set it yourself.
        </p>
      )}
      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          className={inputCls}
        />
      </Field>
    </div>
  );
}

const FAMILY_CATEGORIES = ["HNI", "Affluent", "Retail", "NRI", "Corporate"] as const;

const inputCls = "w-full border rounded-md px-2 py-1 text-sm bg-background";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}

/** yyyy-mm-dd for a local date. */
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDateInput(d: any): string {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
