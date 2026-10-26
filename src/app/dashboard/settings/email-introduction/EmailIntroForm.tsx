"use client";

/**
 * The firm's email introduction (lib/firm/email-intro.ts). Each field shows the
 * merge field that prints it, so a template author can copy it; a field left
 * blank simply drops out of the email.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, FieldSection } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { notify } from "@/components/ui/Toast";
import {
  FIRM_INTRO_FIELDS,
  MAX_CUSTOM_FIELDS,
  customFieldKey,
  type FirmEmailIntro,
  type FirmIntroFieldKey,
} from "@/lib/firm/email-intro";

type Row = { label: string; value: string };

function Token({ k }: { k: string }) {
  return (
    <code className="text-2xs font-mono text-muted-foreground bg-secondary/70 rounded px-1.5 py-0.5">{`{{firm.${k}}}`}</code>
  );
}

export function EmailIntroForm({ initial }: { initial: FirmEmailIntro }) {
  const router = useRouter();
  const start = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of FIRM_INTRO_FIELDS) v[f.key] = initial[f.key] ?? "";
    return {
      values: v,
      custom: (initial.custom ?? []).map((c) => ({
        label: c.label,
        value: c.value,
      })),
    };
  }, [initial]);
  const [values, setValues] = useState<Record<string, string>>(start.values);
  const [custom, setCustom] = useState<Row[]>(start.custom);
  const [saved, setSaved] = useState(JSON.stringify(start));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify({ values, custom }) !== saved;
  const set = (k: FirmIntroFieldKey, v: string) =>
    setValues((s) => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/firm-intro", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, custom }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      const keep = custom.filter((r) => r.label.trim() || r.value.trim());
      setCustom(keep);
      setSaved(JSON.stringify({ values, custom: keep }));
      notify.success("Saved — your emails use it from the next send.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/"))
      return notify.error("Please choose an image file.");
    if (file.size > 2 * 1024 * 1024)
      return notify.error("The photo must be under 2 MB.");
    setUploading(true);
    try {
      const presign = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // "general" files are publicly readable — a mail client must load it.
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/jpeg",
          kind: "general",
          docType: "founder-photo",
        }),
      });
      const pj = await presign.json();
      if (!presign.ok)
        throw new Error(pj.error ?? "Could not start the upload");
      const put = await fetch(pj.url, {
        method: "PUT",
        headers: { "content-type": file.type || "image/jpeg" },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");
      set("founder_photo_url", `/api/upload-local/${pj.key}`);
      notify.success("Photo uploaded — save to use it.");
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const field = (key: FirmIntroFieldKey) =>
    FIRM_INTRO_FIELDS.find((f) => f.key === key)!;
  const textInput = (
    key: FirmIntroFieldKey,
    opts: {
      rows?: number;
      hint?: string;
      placeholder?: string;
      wide?: boolean;
    } = {},
  ) => {
    const f = field(key);
    return (
      <Field
        className={opts.wide ? "sm:col-span-2" : undefined}
        label={
          <span className="inline-flex flex-wrap items-center gap-2">
            {f.label} <Token k={key} />
          </span>
        }
        hint={opts.hint}
      >
        {(id, describedBy) =>
          opts.rows ? (
            <textarea
              id={id}
              aria-describedby={describedBy}
              rows={opts.rows}
              className="input-base w-full"
              maxLength={2000}
              placeholder={opts.placeholder}
              value={values[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          ) : (
            <input
              id={id}
              aria-describedby={describedBy}
              className="input-base w-full"
              maxLength={200}
              placeholder={opts.placeholder}
              value={values[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          )
        }
      </Field>
    );
  };

  const photo = values.founder_photo_url;
  const taken = new Set<string>(FIRM_INTRO_FIELDS.map((f) => f.key));

  return (
    <div className="space-y-6">
      <FieldSection title="About the firm">
        {textInput("company_intro", { rows: 4, wide: true })}
        {textInput("services", {
          rows: 5,
          hint: "One service per line — the email lists them as bullets.",
        })}
        {textInput("mission", { rows: 5 })}
        {textInput("office_timing", {
          placeholder: "Monday to Saturday, 10:00 am – 6:30 pm",
          wide: true,
        })}
      </FieldSection>

      <FieldSection title="Founder">
        {textInput("founder_name")}
        {textInput("founder_designation", {
          placeholder: "Founder & Principal Distributor",
        })}
        <Field
          className="sm:col-span-2"
          label={
            <span className="inline-flex flex-wrap items-center gap-2">
              Founder photo <Token k="founder_photo_url" />
            </span>
          }
          hint="A square photo works best. Under 2 MB."
        >
          {(id) => (
            <div className="flex flex-wrap items-center gap-4">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo}
                  alt="Founder"
                  className="size-20 rounded-lg object-cover border border-border"
                />
              ) : (
                <div className="size-20 rounded-lg bg-secondary grid place-items-center text-muted-foreground">
                  <ImagePlus className="size-6" />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  id={id}
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickPhoto}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {photo ? "Change photo" : "Upload photo"}
                </Button>
                {photo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => set("founder_photo_url", "")}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          )}
        </Field>
        {textInput("founder_intro", { rows: 4, wide: true })}
      </FieldSection>

      <FieldSection title="Your own fields">
        <div className="space-y-3 sm:col-span-2">
          {custom.map((r, i) => {
            const key = customFieldKey(r.label);
            const clash =
              key &&
              (taken.has(key) ||
                custom.some(
                  (o, j) => j < i && customFieldKey(o.label) === key,
                ));
            return (
              <div key={i} className="rounded-lg bg-secondary/40 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <Field
                      label="Field name"
                      error={
                        clash ? "Another field already has this name" : null
                      }
                    >
                      {(id, describedBy, invalid) => (
                        <input
                          id={id}
                          aria-describedby={describedBy}
                          aria-invalid={invalid}
                          className="input-base w-full"
                          maxLength={60}
                          placeholder="Awards"
                          value={r.label}
                          onChange={(e) =>
                            setCustom((c) =>
                              c.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      )}
                    </Field>
                  </div>
                  <button
                    type="button"
                    className="btn-icon mt-6"
                    aria-label="Remove this field"
                    onClick={() =>
                      setCustom((c) => c.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <Field
                  label={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      Value {key ? <Token k={key} /> : null}
                    </span>
                  }
                >
                  {(id, describedBy) => (
                    <textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={2}
                      className="input-base w-full"
                      maxLength={2000}
                      value={r.value}
                      onChange={(e) =>
                        setCustom((c) =>
                          c.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
              </div>
            );
          })}
          {custom.length < MAX_CUSTOM_FIELDS && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCustom((c) => [...c, { label: "", value: "" }])}
            >
              <Plus className="size-4" /> Add a field
            </Button>
          )}
        </div>
      </FieldSection>
      <FormActions
        className="card-surface rounded-xl border"
        status={dirty ? "Unsaved changes" : "All changes saved"}
      >
        <Button
          variant="primary"
          onClick={save}
          loading={saving}
          disabled={!dirty || saving || uploading}
        >
          Save
        </Button>
      </FormActions>
    </div>
  );
}
