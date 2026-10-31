"use client";

/**
 * The firm's DPDP privacy notice (lib/privacy/notice.ts). The standard text
 * already fits an MFD practice; here the firm names its privacy contact and
 * adds what is particular to it. Saving a change publishes a new version.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, FieldSection } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { AI_RECIPIENT, STANDARD_PURPOSES, STANDARD_RECIPIENTS, type StoredPrivacyNotice } from "@/lib/privacy/notice";

type Contact = { name: string; email: string; phone: string };

const toLines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function PrivacyNoticeForm({
  initial,
  initialContact,
  noticeHref,
}: {
  initial: StoredPrivacyNotice;
  initialContact: Contact;
  noticeHref: string;
}) {
  const router = useRouter();
  const start = useMemo(
    () => ({
      contact: initialContact,
      purposes: initial.extraPurposes.join("\n"),
      recipients: initial.extraRecipients.join("\n"),
      mentionsAi: initial.mentionsAi,
    }),
    [initial, initialContact]
  );
  const [contact, setContact] = useState<Contact>(start.contact);
  const [purposes, setPurposes] = useState(start.purposes);
  const [recipients, setRecipients] = useState(start.recipients);
  const [mentionsAi, setMentionsAi] = useState(start.mentionsAi);
  const [saved, setSaved] = useState(JSON.stringify(start));
  const [meta, setMeta] = useState({ version: initial.version, publishedAt: initial.publishedAt });
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify({ contact, purposes, recipients, mentionsAi }) !== saved;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/privacy-notice", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact, extraPurposes: toLines(purposes), extraRecipients: toLines(recipients), mentionsAi }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      setSaved(JSON.stringify({ contact, purposes, recipients, mentionsAi }));
      setMeta({ version: j.notice.version, publishedAt: j.notice.publishedAt });
      notify.success("Saved — the notice is updated everywhere it is linked.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const contactInput = (key: keyof Contact, label: string, type = "text") => (
    <Field label={label} optional>
      {(id, describedBy) => (
        <input
          id={id}
          aria-describedby={describedBy}
          type={type}
          className="input-base w-full"
          maxLength={key === "phone" ? 30 : 120}
          value={contact[key]}
          onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
        />
      )}
    </Field>
  );

  return (
    <div className="space-y-6">
      <div className="card-surface rounded-xl border p-4 flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="font-medium">Version {meta.version}</span>
          <span className="text-muted-foreground">
            {meta.publishedAt ? ` · updated ${formatDate(meta.publishedAt)}` : " · the standard notice"}
          </span>
        </div>
        <a href={noticeHref} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          View the notice <ExternalLink className="size-3.5" />
        </a>
      </div>

      <FieldSection
        title="Privacy contact"
        description="Who answers clients' privacy questions and requests — your data protection officer. Shown on the notice and in every email footer. Left blank, the firm's own email and phone are shown."
      >
        {contactInput("name", "Name")}
        {contactInput("email", "Email", "email")}
        {contactInput("phone", "Phone", "tel")}
      </FieldSection>

      <FieldSection title="Why you use personal data" description="The notice already lists these. Add any purpose of your own, one per line.">
        <ul className="sm:col-span-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {STANDARD_PURPOSES.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <Field label="Your own purposes" optional className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea id={id} aria-describedby={describedBy} rows={3} className="input-base w-full" value={purposes} onChange={(e) => setPurposes(e.target.value)} />
          )}
        </Field>
      </FieldSection>

      <FieldSection title="Who you share it with" description="The notice already lists these. Add anyone else you share client data with, one per line.">
        <ul className="sm:col-span-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {STANDARD_RECIPIENTS.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <label className="sm:col-span-2 flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={mentionsAi} onChange={(e) => setMentionsAi(e.target.checked)} />
          <span>
            Include AI assistance
            <span className="block text-muted-foreground">{AI_RECIPIENT}.</span>
          </span>
        </label>
        <Field label="Others you share with" optional className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea id={id} aria-describedby={describedBy} rows={3} className="input-base w-full" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
          )}
        </Field>
      </FieldSection>

      <FormActions className="card-surface rounded-xl border" status={dirty ? "Unsaved changes" : "All changes saved"}>
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save and publish"}
        </Button>
      </FormActions>
    </div>
  );
}
