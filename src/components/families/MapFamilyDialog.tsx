"use client";

/**
 * "Map Family" on a client's onboarding journey (Transaction Successful).
 *
 * The step used to open "New family" every time. It now asks which: add the
 * client to a family that already exists (searched server-side, with how they
 * are related), or start a new family with the client as its head. Either
 * write completes the step on the server (lib/families/journey.ts), so the
 * journey refreshes onto Family Mapping straight after.
 *
 * `MapFamilyHost` listens for the journey's "blueprint:open-dialog" event
 * (kind "map_family") and opens the dialog for the client it is mounted on.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";
import { useRelationshipOptions } from "./useRelationshipOptions";

type Family = { id: string; family_name: string | null; head_name: string | null; member_count?: number | string };
type Mode = "existing" | "new";

export function MapFamilyHost({ investorId, investorName }: { investorId: string; investorName: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent).detail?.kind === "map_family") setOpen(true);
    };
    window.addEventListener("blueprint:open-dialog", onOpen);
    return () => window.removeEventListener("blueprint:open-dialog", onOpen);
  }, []);
  if (!open) return null;
  return <MapFamilyDialog investorId={investorId} investorName={investorName} onClose={() => setOpen(false)} />;
}

export function MapFamilyDialog({
  investorId,
  investorName,
  onClose,
}: {
  investorId: string;
  investorName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const relationships = useRelationshipOptions();
  const [mode, setMode] = useState<Mode>("existing");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Family[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Family | null>(null);
  const [role, setRole] = useState("spouse");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Server-side search: a firm can hold thousands of families.
  useEffect(() => {
    if (mode !== "existing") return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/families?limit=25${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`)
        .then((r) => r.json())
        .then((j) => { if (!cancelled) setRows(Array.isArray(j.families) ? j.families : []); })
        .catch(() => { if (!cancelled) setRows([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q.trim() ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, mode]);

  function done(message: string) {
    notify.success(message, "Family mapped");
    // The journey moved on the server; redraw it and the page.
    window.dispatchEvent(new CustomEvent("blueprint:refresh"));
    router.refresh();
    onClose();
  }

  async function addToExisting() {
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/families/${picked.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId, familyRole: role }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(res.status === 403 ? "You don’t have permission to edit families — ask your admin." : (j?.error ?? `Couldn't add to the family (${res.status})`));
        return;
      }
      done(`${investorName} added to ${picked.family_name ?? picked.head_name ?? "the family"}.`);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headName: investorName, primaryInvestorId: investorId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(res.status === 403 ? "You don’t have permission to create families — ask your admin." : (j?.error ?? `Couldn't create the family (${res.status})`));
        return;
      }
      done(`New family created with ${investorName} as head. Add the other members from the family page.`);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Map family</DialogTitle>
          <DialogDescription>Add {investorName} to a family that already exists, or start a new one.</DialogDescription>
        </DialogHeader>

        <div className="mt-4 inline-flex rounded-lg bg-secondary p-1" role="group" aria-label="How to map the family">
          {([["existing", "Existing family", Users], ["new", "New family", Plus]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => { setMode(key); setErr(null); }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mode === key ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Relationship to the family</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="input-base w-full text-sm">
                {relationships.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Family</span>
              <span className="relative block">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPicked(null); }}
                  autoFocus
                  placeholder="Search by family or head name…"
                  className="input-base w-full pl-8 text-sm"
                />
              </span>
            </label>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              {loading ? (
                <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Searching…
                </div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {q ? "No family matches that name." : "No families yet. Use “New family” instead."}
                </div>
              ) : (
                <ul className="divide-y divide-border" role="listbox" aria-label="Families">
                  {rows.map((f) => (
                    <li key={f.id} role="option" aria-selected={picked?.id === f.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(f)}
                        className={`w-full px-3 py-2 text-left text-sm ${picked?.id === f.id ? "bg-accent" : "hover:bg-accent/40"}`}
                      >
                        <span className="block truncate font-medium">{f.family_name ?? f.head_name ?? "Family"}</span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {[f.head_name ? `Head: ${f.head_name}` : null, f.member_count != null ? `${f.member_count} member${Number(f.member_count) === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-md bg-secondary/60 p-3 text-sm">
            A new family is created with <strong>{investorName}</strong> as its head. You can add the spouse, parents and
            children from the family page afterwards.
          </p>
        )}

        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

        <DialogFooter>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass("secondary", "md")}>Cancel</button>
          {mode === "existing" ? (
            <button type="button" onClick={addToExisting} disabled={!picked || busy} className={buttonClass("primary", "md", "gap-1.5")}>
              {busy && <Loader2 className="size-4 animate-spin" />} Add to family
            </button>
          ) : (
            <button type="button" onClick={createNew} disabled={busy} className={buttonClass("primary", "md", "gap-1.5")}>
              {busy && <Loader2 className="size-4 animate-spin" />} Create family
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
