"use client";

/**
 * RecordAutomations — per-record "Run a macro" + "Enroll in a cadence" actions
 * (Zoho parity) for a lead/client detail. Fetches the active macros/cadences
 * for the subject type and fires them in one click.
 *
 * Two rows for a record's More menu. Each opens its list IN PLACE, under the
 * row, rather than as a second floating panel on top of the menu it sits in.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Repeat, Loader2, ChevronDown } from "lucide-react";
import { MENU_ITEM, MENU_ICON } from "@/components/ui/menu-item-class";

type Subject = { type: "lead" | "investor"; id: string };

export function RecordAutomations({ subject }: { subject: Subject }) {
  return (
    <>
      <Menu subject={subject} kind="macro" />
      <Menu subject={subject} kind="cadence" />
    </>
  );
}

function Menu({ subject, kind }: { subject: Subject; kind: "macro" | "cadence" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setOpen((o) => !o);
    if (items) return;
    const url = kind === "macro" ? `/api/macros?subjectType=${subject.type}` : `/api/cadences?subjectType=${subject.type}`;
    const res = await fetch(url);
    const j = await res.json().catch(() => ({}));
    setItems(((kind === "macro" ? j.macros : j.cadences) ?? []).filter((x: any) => x.is_active));
  }

  async function fire(id: string, name: string) {
    setBusy(id); setMsg(null);
    try {
      const url = kind === "macro" ? `/api/macros/${id}/run` : `/api/cadences/${id}/enroll`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subjectType: subject.type, subjectId: subject.id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Could not run it." }); return; }
      setMsg({ ok: true, text: kind === "macro" ? `Ran "${name}" (${j.ran} steps)` : `Enrolled in "${name}"` });
      setOpen(false); router.refresh();
      setTimeout(() => setMsg(null), 3000);
    } finally { setBusy(null); }
  }

  const Icon = kind === "macro" ? Zap : Repeat;
  return (
    <div>
      <button type="button" onClick={load} aria-expanded={open} className={MENU_ITEM}>
        <Icon className={MENU_ICON} />
        <span className="flex-1">{kind === "macro" ? "Run a macro" : "Enroll in a cadence"}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="mb-1 ml-8 mr-1 border-l border-border pl-1.5">
          {items == null ? (
            <div className="px-2 py-1.5"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No {kind === "macro" ? "macros" : "cadences"} set up yet.
            </div>
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => fire(it.id, it.name)}
                disabled={!!busy}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                <span className="truncate">{it.name}</span>
                {busy === it.id && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
              </button>
            ))
          )}
        </div>
      )}
      {msg && (
        <div className={`px-2.5 pb-1 text-2xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</div>
      )}
    </div>
  );
}
