"use client";

/**
 * Working a breach: keep the facts current, tick off the three things Rule 7
 * requires — tell the Board, send it the detailed report within 72 hours, tell
 * every affected person — and copy the two texts, which are rebuilt from the
 * facts on every save so nothing required is left out.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, FieldSection } from "@/components/ui/Field";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

type Breach = {
  id: string;
  title: string;
  description: string;
  dataAffected: string;
  cause: string;
  consequences: string;
  mitigation: string;
  personSteps: string;
  affectedCount: number | null;
  detectedAt: string;
  reportDueAt: string;
  boardIntimatedAt: string | null;
  boardReportAt: string | null;
  peopleNotifiedAt: string | null;
  peopleNotifiedCount: number | null;
};

const FIELDS: Array<{ key: keyof Breach; label: string; hint?: string }> = [
  { key: "description", label: "What happened", hint: "Nature, extent, timing and where it happened." },
  { key: "dataAffected", label: "Personal data involved", hint: "For example: names, PAN, phone numbers, folio statements." },
  { key: "cause", label: "Why it happened" },
  { key: "consequences", label: "What it could mean for the people affected" },
  { key: "mitigation", label: "What the firm has done and will do", hint: "To contain it, and to stop it happening again." },
  { key: "personSteps", label: "What the people affected can do", hint: "For example: watch for calls asking for an OTP; change a password." },
];

function CopyBox({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                notify.error("Could not copy — select the text and copy it.");
              }
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
          </Button>
        }
      />
      <pre className="mx-5 mb-5 whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-4 text-sm font-sans">{text}</pre>
    </Card>
  );
}

export function BreachWorkspace({ breach, canEdit, personText, boardText }: { breach: Breach; canEdit: boolean; personText: string; boardText: string }) {
  const router = useRouter();
  const start = Object.fromEntries(FIELDS.map((f) => [f.key, String(breach[f.key] ?? "")])) as Record<string, string>;
  const [values, setValues] = useState(start);
  const [count, setCount] = useState(breach.affectedCount == null ? "" : String(breach.affectedCount));
  const [saved, setSaved] = useState(JSON.stringify({ start, count }));
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = JSON.stringify({ start: values, count }) !== saved;

  async function patch(label: string, body: Record<string, unknown>, done: string) {
    setBusy(label);
    try {
      const res = await fetch(`/api/data-breaches/${breach.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      notify.success(done);
      router.refresh();
      return true;
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails() {
    const ok = await patch(
      "details",
      { action: "details", ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() || null])), affectedCount: count === "" ? null : Number(count) },
      "Saved — the texts below are updated."
    );
    if (ok) setSaved(JSON.stringify({ start: values, count }));
  }

  async function notified() {
    const answer = await promptDialog({ title: "How many people were told?", defaultValue: count || "", confirmLabel: "Save" });
    if (answer == null) return;
    const n = Number(answer.replace(/\D/g, ""));
    await patch("people", { action: "step", step: "people_notified", count: Number.isFinite(n) ? n : null }, "Recorded.");
  }

  const steps: Array<{ key: string; done: string | null; label: string; detail: string; act: () => void }> = [
    {
      key: "intimated", done: breach.boardIntimatedAt, label: "Tell the Data Protection Board",
      detail: "Without delay — the first short intimation.",
      act: () => patch("intimated", { action: "step", step: "board_intimated" }, "Recorded."),
    },
    {
      key: "report", done: breach.boardReportAt, label: "Send the Board the detailed report",
      detail: `Within 72 hours — by ${formatDate(breach.reportDueAt, "dateTime")}. Use the report text below.`,
      act: () => patch("report", { action: "step", step: "board_report" }, "Recorded."),
    },
    {
      key: "people", done: breach.peopleNotifiedAt, label: "Tell every person affected",
      detail: "By email, WhatsApp or letter, in plain words. Use the notice below.",
      act: notified,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="What Rule 7 requires" />
        <ul className="px-5 pb-5 space-y-3">
          {steps.map((s) => (
            <li key={s.key} className="flex flex-wrap items-start gap-3">
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${s.done ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                {s.done ? <Check className="size-3.5" /> : null}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{s.label}</div>
                <div className="text-muted-foreground">
                  {s.done
                    ? `Done ${formatDate(s.done, "dateTime")}${s.key === "people" && breach.peopleNotifiedCount != null ? ` · ${breach.peopleNotifiedCount} people` : ""}`
                    : s.detail}
                </div>
              </div>
              {!s.done && canEdit && (
                <Button variant="secondary" size="sm" onClick={s.act} disabled={!!busy}>
                  {busy === s.key ? "Saving…" : "Mark done"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <FieldSection title="The facts" description={`Became aware ${formatDate(breach.detectedAt, "dateTime")}. Fill these in as they become known — both texts below are built from them.`}>
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} optional className="sm:col-span-2">
            {(id, d) => (
              <textarea
                id={id}
                aria-describedby={d}
                rows={3}
                className="input-base w-full"
                maxLength={4000}
                disabled={!canEdit}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        <Field label="People affected" optional>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base w-full" disabled={!canEdit} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} />}
        </Field>
        {canEdit && (
          <div className="sm:col-span-2 flex justify-end">
            <Button variant="primary" onClick={saveDetails} disabled={!dirty || !!busy}>{busy === "details" ? "Saving…" : "Save the facts"}</Button>
          </div>
        )}
      </FieldSection>

      <CopyBox title="Notice to each person affected" text={personText} />
      <CopyBox title="Detailed report for the Data Protection Board" text={boardText} />

      {canEdit && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Close this breach?",
                message: breach.boardReportAt && breach.peopleNotifiedAt ? "The Board has its report and the people affected were told." : "The Board report or the notice to people is not marked done. Close only if it was not a personal-data breach after all.",
                confirmLabel: "Close",
              });
              if (ok) await patch("close", { action: "step", step: "close" }, "Breach closed.");
            }}
          >
            Close the breach
          </Button>
        </div>
      )}
    </div>
  );
}
