"use client";

/**
 * "Update a field" for the selected clients: pick a field, give the value (or
 * clear it), see exactly what will happen, confirm. POSTs action "field" to
 * /api/investors/bulk; the field list is the shared registry in
 * lib/investors/bulk-fields, so nothing here can offer a field the server
 * would refuse.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, PencilLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { BULK_FIELDS, BULK_FIELD_BY_KEY, BULK_TEXT_MAX } from "@/lib/investors/bulk-fields";
import { DateField } from "@/components/ui/DateField";
import { formatDateLabel } from "@/lib/dates/typed-date";

export type MassUpdateOptions = {
  branches: Array<{ value: string; label: string }>;
  /** Active people in the firm who can hold a client book. */
  rms: Array<{ value: string; label: string }>;
  occupations: string[];
  incomeRanges: string[];
};

const GROUPS = ["Relationship", "Classification", "Service", "Profile", "Address", "Tags"] as const;

export function MassUpdateDialog({
  open,
  onOpenChange,
  count,
  options,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  options: MassUpdateOptions;
  /** Resolves with an error message, or null on success. */
  onApply: (field: string, value: string | null) => Promise<string | null>;
}) {
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fresh form every time it opens.
  useEffect(() => {
    if (open) {
      setField("");
      setValue("");
      setClear(false);
      setErr(null);
    }
  }, [open]);

  const def = field ? BULK_FIELD_BY_KEY.get(field) : undefined;
  const choices = useMemo(() => {
    if (!def) return [];
    if (def.kind === "branch") return options.branches;
    if (def.kind === "rm") return options.rms;
    return def.options ?? [];
  }, [def, options.branches, options.rms]);
  const suggestions = def?.master === "occupation" ? options.occupations : def?.master === "income_range" ? options.incomeRanges : [];

  const clients = `${count.toLocaleString("en-IN")} ${count === 1 ? "client" : "clients"}`;
  const shown = clear ? null : value.trim();
  const shownLabel =
    shown == null ? null : def?.kind === "date" ? formatDateLabel(shown) || shown : (choices.find((c) => c.value === shown)?.label ?? shown);
  const ready = !!def && (clear || !!value.trim());

  const sentence = !def
    ? null
    : def.key === "tagAdd"
      ? `Add the tag “${shownLabel ?? "…"}” to ${clients}.`
      : def.key === "tagRemove"
        ? `Remove the tag “${shownLabel ?? "…"}” from ${clients}.`
        : def.key === "rm"
          ? clear
            ? `Remove the relationship manager from ${clients} — they will have no RM.`
            : `Move ${clients} to ${shownLabel ?? "…"}'s book.`
          : clear
          ? `Clear ${def.label.toLowerCase()} for ${clients}.`
          : `Set ${def.label.toLowerCase()} to “${shownLabel ?? "…"}” for ${clients}.`;

  async function submit() {
    if (!def || !ready) return;
    setBusy(true);
    setErr(null);
    const e = await onApply(def.key, clear ? null : value.trim());
    setBusy(false);
    if (e) setErr(e);
    else onOpenChange(false);
  }

  const inputId = "mass-update-value";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md" showClose={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine className="size-4 text-muted-foreground" aria-hidden /> Update a field
          </DialogTitle>
          <DialogDescription>Set one field to the same value for all {clients} you selected.</DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <label htmlFor="mass-update-field" className="mb-1 block text-xs font-medium text-foreground">
              Field
            </label>
            <select
              id="mass-update-field"
              value={field}
              onChange={(e) => {
                setField(e.target.value);
                setValue("");
                setClear(false);
                setErr(null);
              }}
              className="input-base w-full"
            >
              <option value="">Choose a field…</option>
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {BULK_FIELDS.filter((f) => f.group === g).map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {def && (
            <div>
              <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-foreground">
                {def.kind === "tag" ? "Tag" : "New value"}
              </label>
              {def.kind === "enum" || def.kind === "branch" || def.kind === "rm" ? (
                <select
                  id={inputId}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={clear}
                  className="input-base w-full"
                >
                  <option value="">Choose…</option>
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : def.kind === "date" ? (
                <DateField id={inputId} value={value} onChange={(e) => setValue(e.target.value)} disabled={clear} className="input-base w-full" />
              ) : (
                <>
                  <input
                    id={inputId}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={clear}
                    maxLength={BULK_TEXT_MAX}
                    list={suggestions.length ? `${inputId}-list` : undefined}
                    placeholder={def.kind === "tag" ? "e.g. Diwali 2026" : undefined}
                    className="input-base w-full"
                  />
                  {suggestions.length > 0 && (
                    <datalist id={`${inputId}-list`}>
                      {suggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
              {def.kind === "branch" && choices.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">No branches set up yet (Settings → Branches).</p>
              )}
              {def.kind === "rm" && choices.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">No active team members to assign.</p>
              )}
              {def.nullable && def.kind !== "tag" && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} className="size-4 rounded" />
                  Clear this field instead (leave it empty)
                </label>
              )}
              {def.hint && <p className="mt-1.5 text-xs text-muted-foreground">{def.hint}</p>}
            </div>
          )}

          {sentence && (
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">
              <p className="font-medium text-foreground">{sentence}</p>
              <p className="mt-1 text-muted-foreground">
                Every client&apos;s previous value is kept in the audit log. Automations are not triggered by this change.
              </p>
            </div>
          )}

          {err && <p className="text-sm text-rose-700">{err}</p>}
        </div>

        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy} className={buttonClass("secondary")}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!ready || busy} className={buttonClass("primary")}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Update {clients}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
