"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PrivacyConsentCheckbox } from "@/components/privacy/PrivacyConsentCheckbox";
import { CheckCircle2, FileText, Loader2, Upload, X, PenLine, ImageUp, Save, Check, ArrowLeft, ArrowRight, ScanText } from "lucide-react";
import { isFieldVisible, validateNomineeAllocations, type KycField } from "@/lib/onboarding/kyc-fields";
import { DateField } from "@/components/ui/DateField";

type RequiredDoc = { key: string; label: string; required?: boolean };

export function PublicDocsForm({
  tokenId,
  recipientName,
  requiredDocs,
  requiredFields = [],
  tenantId,
  firmName,
}: {
  tokenId: string;
  recipientName: string;
  /** The firm whose privacy notice the consent tick refers to. */
  tenantId: string;
  firmName: string;
  requiredDocs: RequiredDoc[];
  requiredFields?: KycField[];
}) {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [extraNotes, setExtraNotes] = useState("");
  const [signature, setSignature] = useState("");
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  // Documents first (2026-11-27): the client uploads, we read the details off
  // the documents (/api/public/docs/extract — no AI, nothing stored), and the
  // second step asks only for what the documents did not show.
  const [step, setStep] = useState<"docs" | "details">("docs");
  const [reading, setReading] = useState<Record<string, "reading" | "read" | "none">>({});
  const [readNote, setReadNote] = useState<Record<string, string>>({});
  /** Field key → the document it was read from ("PAN card"). */
  const [fromDoc, setFromDoc] = useState<Record<string, string>>({});
  /** Live copies for readDocument, which can finish for two files at once. */
  const autoRef = useRef<Record<string, { label: string; rank: number }>>({});
  const valuesRef = useRef<Record<string, string>>({});

  // ── Save-draft persistence ────────────────────────────────────────────────
  // The form is long (KYC fields + several uploads) and the link needs no login,
  // so a client can fill what they have now, close the tab, and come back to the
  // SAME link later to finish. We persist the text answers (fields, notes, typed
  // signature) to this browser's localStorage. Files are NOT persisted — the
  // browser can't safely re-create a File from storage, so uploads must be
  // re-attached (we tell the user this).
  const DRAFT_KEY = `mfd_docdraft_${tokenId}`;

  // Restore any saved draft once, on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { fieldValues?: Record<string, string>; fromDoc?: Record<string, string>; extraNotes?: string; signature?: string; savedAt?: number };
      if (d.fieldValues && typeof d.fieldValues === "object") setFieldValues(d.fieldValues);
      if (d.fromDoc && typeof d.fromDoc === "object") setFromDoc(d.fromDoc);
      if (typeof d.extraNotes === "string") setExtraNotes(d.extraNotes);
      if (typeof d.signature === "string") setSignature(d.signature);
      if (d.savedAt) {
        setDraftSavedAt(d.savedAt);
        setDraftNotice(`We restored your saved answers from ${fmtWhen(d.savedAt)}. Please re-attach any documents.`);
      }
    } catch {
      /* corrupt/unavailable storage — ignore, start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save (debounced) whenever the text answers change and there's content.
  useEffect(() => {
    const hasContent = signature.trim() || extraNotes.trim() || Object.values(fieldValues).some((v) => v && v.trim());
    if (!hasContent) return;
    const t = setTimeout(() => {
      try {
        const savedAt = Date.now();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ fieldValues, fromDoc, extraNotes, signature, savedAt }));
        setDraftSavedAt(savedAt);
      } catch {
        /* storage full / disabled — silent */
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldValues, fromDoc, extraNotes, signature]);

  function saveDraftNow() {
    try {
      const savedAt = Date.now();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ fieldValues, fromDoc, extraNotes, signature, savedAt }));
      setDraftSavedAt(savedAt);
      setDraftNotice("Saved on this device. You can close this page and return to the same link on this browser to finish.");
    } catch {
      setDraftNotice("Couldn't save a draft on this browser (private mode?). Please complete the form in one go.");
    }
  }

  function setFile(key: string, file: File | null) {
    setFiles((p) => ({ ...p, [key]: file }));
    if (file) void readDocument(key, file);
    else {
      setReading((p) => ({ ...p, [key]: undefined as never }));
      setReadNote((p) => ({ ...p, [key]: "" }));
    }
  }

  /** The fields this link asks for — a document can only fill these. */
  const askedKeys = useMemo(() => new Set(requiredFields.map((f) => f.key)), [requiredFields]);

  /** Read the details off one uploaded document and fill the empty fields with them. */
  async function readDocument(docKey: string, file: File) {
    if (!/^(application\/pdf|image\/(png|jpe?g))$/.test(file.type) || file.size > 10 * 1024 * 1024) return;
    setReading((p) => ({ ...p, [docKey]: "reading" }));
    setReadNote((p) => ({ ...p, [docKey]: "" }));
    try {
      const fd = new FormData();
      fd.append("tokenId", tokenId);
      fd.append("docKey", docKey);
      fd.append("file", file);
      const r = await fetch("/api/public/docs/extract", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { kind?: string | null; label?: string | null; fields?: Record<string, string> };
      const label = j.label ?? null;
      // A PAN beats an Aadhaar for the name and date of birth; anything the
      // client typed themselves is never overwritten.
      const rank = j.kind === "pan" ? 3 : j.kind === "aadhaar" ? 2 : 1;
      const got = Object.entries(j.fields ?? {}).filter(([k, v]) => askedKeys.has(k) && v);
      const decided: Array<[string, string]> = [];
      if (label) {
        for (const [k, v] of got) {
          const cur = autoRef.current[k];
          if ((valuesRef.current[k] ?? "").trim() && !cur) continue;
          if (cur && cur.rank > rank) continue;
          autoRef.current[k] = { label, rank };
          decided.push([k, v]);
        }
      }
      if (decided.length) {
        setFieldValues((prev) => ({ ...prev, ...Object.fromEntries(decided) }));
        setFromDoc((prev) => ({ ...prev, ...Object.fromEntries(decided.map(([k]) => [k, label!])) }));
      }
      const names = decided.map(([k]) => requiredFields.find((f) => f.key === k)?.label.replace(/\s*\(.*\)\s*$/, "") ?? k);
      setReading((p) => ({ ...p, [docKey]: got.length ? "read" : "none" }));
      setReadNote((p) => ({
        ...p,
        [docKey]: decided.length
          ? `Read from your ${label}: ${names.join(", ")}`
          : got.length
            ? `Read your ${label} — its details match what we already have.`
            : "We couldn't read details from this file — you can type them in the next step.",
      }));
    } catch {
      setReading((p) => ({ ...p, [docKey]: "none" }));
      setReadNote((p) => ({ ...p, [docKey]: "We couldn't read details from this file — you can type them in the next step." }));
    }
  }
  function setField(key: string, value: string) {
    setFieldValues((p) => ({ ...p, [key]: value }));
    // The client's own correction wins over any document read later.
    delete autoRef.current[key];
  }

  useEffect(() => {
    valuesRef.current = fieldValues;
  }, [fieldValues]);
  // A restored draft's document-filled fields stay replaceable by a better document.
  useEffect(() => {
    for (const [k, label] of Object.entries(fromDoc)) if (!autoRef.current[k]) autoRef.current[k] = { label, rank: 1 };
  }, [fromDoc]);

  const docsReady = requiredDocs.every((d) => !d.required || !!files[d.key]);
  const stillReading = Object.values(reading).includes("reading");

  // Group VISIBLE fields by section (showIf-driven conditionals collapse as
  // the user fills the form). Recomputes when values change.
  const { readFields, sections } = useMemo(() => {
    const map = new Map<string, KycField[]>();
    const read: KycField[] = [];
    for (const f of requiredFields) {
      if (!isFieldVisible(f, fieldValues)) continue;
      if (fromDoc[f.key]) {
        read.push(f);
        continue;
      }
      if (!map.has(f.section)) map.set(f.section, []);
      map.get(f.section)!.push(f);
    }
    return { readFields: read, sections: Array.from(map.entries()) };
  }, [requiredFields, fieldValues, fromDoc]);

  function firstMissingField(): KycField | null {
    for (const f of requiredFields) {
      if (!isFieldVisible(f, fieldValues)) continue; // a hidden field can't be required
      if (f.required && !(fieldValues[f.key] ?? "").trim()) return f;
    }
    return null;
  }

  function canSubmit() {
    if (!signature.trim()) return false;
    if (!consent) return false;
    if (firstMissingField()) return false;
    return requiredDocs.every((d) => !d.required || !!files[d.key]);
  }

  async function submit() {
    // Surface the first unfilled required field instead of a silent disabled button.
    const miss = firstMissingField();
    if (miss) {
      setError(`Please fill: ${miss.label}`);
      return;
    }
    // Multiple nominees must add up to 100%.
    const allocErr = validateNomineeAllocations(fieldValues);
    if (allocErr) {
      setError(allocErr);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Visible KYC field values to send.
      const fields: Record<string, string> = {};
      for (const f of requiredFields) {
        if (!isFieldVisible(f, fieldValues)) continue;
        const val = (fieldValues[f.key] ?? "").trim();
        if (val) fields[f.key] = val;
      }
      // The files the client attached.
      const chosen = requiredDocs
        .map((d) => ({ docKey: d.key, label: d.label, file: files[d.key] }))
        .filter((x): x is { docKey: string; label: string; file: File } => !!x.file);
      // Wet-signature photo (signed on blank paper) rides the same upload
      // pipeline — stored as a compliance document tagged "signature_image".
      if (signatureFile) {
        chosen.push({ docKey: "signature_image", label: "Signature (on paper)", file: signatureFile });
      }

      // ── Preferred path: presign → upload each file DIRECT to S3 → submit keys.
      // Keeps large files out of our server. Falls back to the legacy multipart
      // submit if presign isn't available (e.g. older deploy).
      let usedPresigned = false;
      if (chosen.length > 0) {
        try {
          const presignRes = await fetch("/api/public/docs/presign", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tokenId, files: chosen.map((c) => ({ docKey: c.docKey, filename: c.file.name, contentType: c.file.type })) }),
          });
          if (!presignRes.ok) {
            // 404 = an older deploy without the endpoint; the multipart
            // fallback below is the correct path there. Anything else is a real
            // failure (bad token, storage down, rejected file) and must be
            // shown — falling through hid it behind a FormData parse error.
            if (presignRes.status !== 404) {
              const pj = await presignRes.json().catch(() => ({}));
              throw new Error(pj?.error ?? `Could not prepare the upload (HTTP ${presignRes.status})`);
            }
          }
          if (presignRes.ok) {
            const { uploads } = (await presignRes.json()) as { uploads: Array<{ docKey: string; key: string; url: string }> };
            const byKey = new Map(uploads.map((u) => [u.docKey, u]));
            const filePayload: Array<{ docKey: string; label: string; name: string; mimeType: string; storageKey: string; sizeBytes: number }> = [];
            for (const c of chosen) {
              const u = byKey.get(c.docKey);
              if (!u) throw new Error(`Could not prepare upload for ${c.label}`);
              const put = await fetch(u.url, { method: "PUT", headers: { "content-type": c.file.type }, body: c.file });
              if (!put.ok) throw new Error(`Upload failed for ${c.label}`);
              filePayload.push({ docKey: c.docKey, label: c.label, name: c.file.name, mimeType: c.file.type, storageKey: u.key, sizeBytes: c.file.size });
            }
            const r = await fetch("/api/public/docs/submit", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tokenId, signatureName: signature.trim(), extraNotes, fields, files: filePayload, privacyConsent: consent }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
            usedPresigned = true;
          }
        } catch (presignErr: any) {
          // If the direct-upload path errored mid-way, surface it rather than
          // silently double-submitting via multipart.
          throw presignErr;
        }
      }

      // ── Fallback path: presign unavailable (no files, or endpoint missing) →
      // legacy multipart submit through the server.
      if (!usedPresigned) {
        const fd = new FormData();
        fd.append("tokenId", tokenId);
        fd.append("signatureName", signature.trim());
        fd.append("extraNotes", extraNotes);
        fd.append("privacyConsent", consent ? "true" : "false");
        for (const [k, v] of Object.entries(fields)) fd.append(`field_${k}`, v);
        for (const c of chosen) {
          fd.append(`file_${c.docKey}`, c.file);
          fd.append(`label_${c.docKey}`, c.label);
        }
        const r = await fetch("/api/public/docs/submit", { method: "POST", body: fd });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      }

      // Submitted successfully — drop the local draft so a stale copy can't
      // resurface if they reopen the (now-used) link.
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold mt-3">Details received!</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Thank you{recipientName ? `, ${recipientName.split(" ")[0]}` : ""}. Our back-office team will start your
          KYC and account-opening process shortly. You'll receive your portal login details via email once we're done.
        </p>
      </div>
    );
  }

  if (step === "docs") {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Step 1 of 2</div>
          <h1 className="page-title mt-1">Start with your documents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hi{recipientName ? ` ${recipientName}` : ""} — upload your documents first. We&apos;ll read your details from
            them, so in the next step you only check them and answer what they don&apos;t show.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">Upload your documents</h2>
            <p className="text-2xs text-muted-foreground mt-0.5">PDF, JPG or PNG up to 10 MB each. A clear, straight photo reads best.</p>
          </div>
          {requiredDocs.map((d) => (
            <DocRow
              key={d.key}
              doc={d}
              value={files[d.key] ?? null}
              onChange={(f) => setFile(d.key, f)}
              status={reading[d.key]}
              note={readNote[d.key]}
            />
          ))}

          {draftNotice && (
            <div className="text-2xs text-sky-800 bg-sky-50 border border-sky-200 rounded-md p-2 flex items-start gap-1.5">
              <Save className="size-3.5 mt-0.5 shrink-0" />
              <span>{draftNotice}</span>
            </div>
          )}

          {!docsReady && <p className="text-2xs text-muted-foreground">Upload the documents marked * to continue.</p>}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep("details");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            disabled={!docsReady || stillReading}
            className="w-full rounded-md bg-brand-cyan text-white px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {stillReading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {stillReading ? "Reading your documents…" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Step 2 of 2</div>
        <h1 className="page-title mt-1">Check your details</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {readFields.length
            ? "We filled in what your documents show — please check it, then answer the rest."
            : "We couldn't read details from your documents, so please fill them in below."}
        </p>
        <button type="button" onClick={() => setStep("docs")} className="mt-3 text-xs font-medium text-brand-cyan inline-flex items-center gap-1 hover:underline">
          <ArrowLeft className="size-3.5" /> Back to documents
        </button>
      </div>

      {/* ─── Read from the documents ─────────────────────────────────── */}
      {readFields.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <ScanText className="size-4 text-brand-cyan" /> From your documents — please check
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {readFields.map((f) => (
              <FieldRow key={f.key} field={f} value={fieldValues[f.key] ?? ""} onChange={(val) => setField(f.key, val)} source={fromDoc[f.key]} />
            ))}
          </div>
        </div>
      )}

      {/* ─── What the documents don't show ───────────────────────────── */}
      {sections.length > 0 && readFields.length > 0 && (
        <h2 className="px-1 text-sm font-bold text-foreground">A few more details</h2>
      )}
      {sections.map(([section, fields]) => (
        <div key={section} className="bg-white rounded-xl shadow p-6 space-y-3">
          <h2 className="text-sm font-bold text-foreground">{section}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <FieldRow key={f.key} field={f} value={fieldValues[f.key] ?? ""} onChange={(val) => setField(f.key, val)} />
            ))}
          </div>
        </div>
      ))}

      <div className="bg-white rounded-xl shadow p-6 space-y-3">
        <label className="block">
          <div className="text-xs font-semibold mb-1">Anything else (optional)</div>
          <textarea
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            rows={2}
            placeholder="Anything else you'd like to share with the back-office team"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>

        <div className="border-t pt-3 mt-1">
          <div className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <PenLine className="size-4 text-brand-cyan" /> Your signature
          </div>

          <div className="mt-2">
            <div className="text-xs font-semibold mb-1">Type your full name</div>
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="e.g. Rajesh Sharma"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="mt-3">
            <div className="text-xs font-semibold mb-1 flex items-center gap-1.5">
              <ImageUp className="size-3.5 text-brand-cyan" /> Upload your signature on blank paper
              <span className="font-normal text-muted-foreground">(recommended)</span>
            </div>
            <p className="text-2xs text-muted-foreground mb-1.5">
              Sign on a plain white sheet, take a clear photo, and upload it (JPG or PNG). This is your wet signature for our records.
            </p>
            <SignatureUpload value={signatureFile} onChange={setSignatureFile} />
          </div>

          <div className="text-2xs text-muted-foreground mt-2">
            By signing, you confirm that the details and documents you've provided are genuine and belong to you. They
            will be used solely for the purpose of opening your mutual fund investment account.
          </div>
        </div>

        {draftNotice && (
          <div className="text-2xs text-sky-800 bg-sky-50 border border-sky-200 rounded-md p-2 flex items-start gap-1.5">
            <Save className="size-3.5 mt-0.5 shrink-0" />
            <span>{draftNotice}</span>
          </div>
        )}

        <PrivacyConsentCheckbox tenantId={tenantId} firmName={firmName} source="docs_form" checked={consent} onChange={setConsent} />

        {error && <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2">{error}</div>}

        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <button
            type="button"
            onClick={saveDraftNow}
            className="sm:w-auto rounded-md border border-brand-cyan text-brand-cyan px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-brand-cyan/5"
          >
            <Save className="size-4" /> Save &amp; finish later
          </button>
          <button
            onClick={submit}
            disabled={busy || !canSubmit()}
            className="flex-1 rounded-md bg-brand-cyan text-white px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {busy ? "Submitting…" : "Submit details & documents"}
          </button>
        </div>
        {draftSavedAt && (
          <div className="text-2xs text-muted-foreground text-center flex items-center justify-center gap-1">
            <Check className="size-3 text-emerald-600" /> Progress saved on this device at {fmtWhen(draftSavedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Friendly "21 Jun, 6:42 pm" for the saved-draft timestamp. */
function fmtWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "earlier";
  }
}

/** Signature-photo uploader — image only, with an inline preview thumbnail. */
function SignatureUpload({ value, onChange }: { value: File | null; onChange: (f: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  if (value) {
    return (
      <div className="border rounded-lg p-3 flex items-center gap-3 bg-secondary">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Signature preview" className="h-12 w-auto max-w-[160px] object-contain border rounded bg-white" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{value.name}</div>
          <div className="text-2xs text-muted-foreground">{(value.size / 1024).toFixed(0)} KB</div>
        </div>
        <button onClick={() => onChange(null)} className="text-rose-600 hover:bg-rose-50 rounded p-1" aria-label="Remove signature photo">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <label className="cursor-pointer border border-dashed rounded-lg p-3 flex items-center justify-center gap-2 text-sm text-brand-cyan hover:bg-brand-cyan/5">
      <ImageUp className="size-4" /> Upload signature photo
      <input
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
    </label>
  );
}

function FieldRow({ field, value, onChange, source }: { field: KycField; value: string; onChange: (v: string) => void; source?: string }) {
  const labelEl = (
    <div className="text-xs font-medium text-foreground mb-1">
      {field.label}
      {field.required && <span className="text-rose-600 ml-1">*</span>}
    </div>
  );
  const cls = "w-full border rounded-lg px-3 py-2 text-sm";
  return (
    <label className="block">
      {labelEl}
      {field.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">— select —</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "date" ? (
        <DateField value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={field.type === "tel" ? "tel" : field.type === "email" ? "email" : field.type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          className={cls}
        />
      )}
      {source ? (
        <div className="text-2xs text-muted-foreground mt-1">From your {source} — correct it if it&apos;s wrong.</div>
      ) : (
        field.helpText && <div className="text-2xs text-muted-foreground mt-1">{field.helpText}</div>
      )}
    </label>
  );
}

function DocRow({
  doc,
  value,
  onChange,
  status,
  note,
}: {
  doc: RequiredDoc;
  value: File | null;
  onChange: (f: File | null) => void;
  status?: "reading" | "read" | "none";
  note?: string;
}) {
  return (
    <div className="border rounded-lg p-3 flex items-center gap-3">
      <FileText className="size-5 text-brand-cyan" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">
          {doc.label}
          {doc.required && <span className="text-rose-600 ml-1">*</span>}
        </div>
        {value && <div className="text-2xs text-muted-foreground truncate">{value.name} · {(value.size / 1024).toFixed(0)} KB</div>}
        {value && status === "reading" && (
          <div className="text-2xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Loader2 className="size-3 animate-spin" /> Reading your details…
          </div>
        )}
        {value && status && status !== "reading" && note && (
          <div className={`text-2xs mt-0.5 ${status === "read" ? "text-emerald-700" : "text-muted-foreground"}`}>{note}</div>
        )}
      </div>
      {value ? (
        <button onClick={() => onChange(null)} className="text-rose-600 hover:bg-rose-50 rounded p-1">
          <X className="size-4" />
        </button>
      ) : (
        <label className="cursor-pointer text-xs rounded-md border px-3 py-1.5 hover:bg-secondary inline-flex items-center gap-1">
          <Upload className="size-3.5" /> Upload
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}
