"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import type { AdminLegalDoc } from "@/lib/legal/admin";

const KIND_LABEL = { terms: "Terms of Service", nda: "Non-Disclosure Agreement" } as const;

export function LegalDocsAdmin({ docs }: { docs: AdminLegalDoc[] }) {
  return (
    <div className="space-y-6">
      {(["terms", "nda"] as const).map((kind) => (
        <KindCard key={kind} kind={kind} docs={docs.filter((d) => d.kind === kind)} />
      ))}
    </div>
  );
}

function KindCard({ kind, docs }: { kind: "terms" | "nda"; docs: AdminLegalDoc[] }) {
  const router = useRouter();
  const current = docs.find((d) => d.status === "published");
  const draft = docs.find((d) => d.status === "draft");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function newVersion() {
    setBusy(true);
    try {
      const r = await fetch("/api/super-admin/legal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not start a draft");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not start a draft");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={KIND_LABEL[kind]}
        subtitle={current ? `In force: version ${current.version}, published ${formatDate(current.publishedAt)} · accepted by ${current.acceptances} firm${current.acceptances === 1 ? "" : "s"}` : "Nothing published yet."}
        action={!draft && <Button size="sm" onClick={newVersion} loading={busy}>New version</Button>}
      />
      <CardBody className="space-y-4">
        {current?.reviewNote && (
          <p className="rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm font-medium">{current.reviewNote}</p>
        )}
        {draft && <DraftEditor draft={draft} />}
        <ul className="divide-y divide-border">
          {docs.filter((d) => d.status === "published").map((d) => (
            <li key={d.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Version {d.version} · {formatDate(d.publishedAt)} · {d.acceptances} acceptance{d.acceptances === 1 ? "" : "s"}{" "}
                  {d.id === current?.id && <Badge tone="success" raw>Current</Badge>}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "Hide" : "Read"}</Button>
              </div>
              {d.bodySha256 && <div className="text-xs text-muted-foreground break-all">SHA-256 {d.bodySha256}</div>}
              {open === d.id && <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/70 p-3 text-xs">{d.body}</pre>}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function DraftEditor({ draft }: { draft: AdminLegalDoc }) {
  const router = useRouter();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [note, setNote] = useState(draft.reviewNote ?? "");
  const [busy, setBusy] = useState<"save" | "publish" | "delete" | null>(null);

  async function save(): Promise<boolean> {
    const r = await fetch(`/api/super-admin/legal/${draft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, body, reviewNote: note || null }) });
    if (!r.ok) {
      notify.error((await r.json().catch(() => ({}))).error ?? "Save failed");
      return false;
    }
    return true;
  }
  async function run(kind: "save" | "publish" | "delete") {
    if (kind === "publish") {
      const ok = await confirmDialog({
        title: `Publish version ${draft.version}?`,
        message: "It can never be changed afterwards. Every firm that accepted an earlier version must accept this one at its next sign-in.",
        confirmLabel: "Publish",
      });
      if (!ok) return;
    }
    if (kind === "delete" && !(await confirmDialog({ title: "Discard this draft?", tone: "danger", confirmLabel: "Discard" }))) return;
    setBusy(kind);
    try {
      if (kind === "delete") {
        await fetch(`/api/super-admin/legal/${draft.id}`, { method: "DELETE" });
      } else {
        if (!(await save())) return;
        if (kind === "publish") {
          const r = await fetch(`/api/super-admin/legal/${draft.id}/publish`, { method: "POST" });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Publish failed");
          notify.success(`Version ${draft.version} published.`);
        } else notify.success("Draft saved.");
      }
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2"><Badge tone="warning" raw>Draft · version {draft.version}</Badge></div>
      <Field label="Title">{(id) => <input id={id} className="input-base" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Text" hint="Plain text. Start a heading with “## ” and a bullet with “- ”.">
        {(id, d) => <textarea id={id} aria-describedby={d} className="input-base font-mono text-xs" rows={18} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <Field label="Note shown to Aina admins" optional hint="e.g. Draft — have it reviewed by your lawyer before go-live">
        {(id, d) => <input id={id} aria-describedby={d} className="input-base" value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => run("delete")} loading={busy === "delete"}>Discard</Button>
        <Button onClick={() => run("save")} loading={busy === "save"}>Save draft</Button>
        <Button variant="primary" onClick={() => run("publish")} loading={busy === "publish"}>Publish</Button>
      </div>
    </div>
  );
}
