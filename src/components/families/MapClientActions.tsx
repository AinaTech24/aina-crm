"use client";

/**
 * Row actions on the unmapped-clients queue.
 *
 * Two ways to map a client, both from the row — the point of the queue is that
 * an RM can clear it without navigating away and losing their place:
 *   • Start a household with this client as its head (one POST, then land on it)
 *   • Add them to a household that already exists (searched server-side)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Loader2, Plus, Search, Users, X } from "lucide-react";

type Family = { id: string; family_name: string | null; head_name: string | null; member_count?: number };

const FALLBACK_RELATIONSHIPS: [string, string][] = [
  ["spouse", "Spouse"],
  ["son", "Son"],
  ["daughter", "Daughter"],
  ["father", "Father"],
  ["mother", "Mother"],
  ["sibling", "Sibling"],
  ["huf_karta", "HUF Karta"],
  ["huf_coparcener", "HUF Co-parcener"],
  ["other", "Other"],
];

export function MapClientActions({
  investorId,
  investorName,
}: {
  investorId: string;
  investorName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"create" | "link" | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createHousehold() {
    setBusy("create");
    setErr(null);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headName: investorName, primaryInvestorId: investorId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(
          res.status === 403
            ? "You don’t have permission to create households — ask your admin for “Create households”."
            : (j?.error ?? `Could not create (HTTP ${res.status})`)
        );
        return;
      }
      if (j?.id) router.push(`/dashboard/families/${j.id}`);
      else router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {err && <span className="text-2xs text-rose-600 max-w-[16rem] text-right">{err}</span>}
      <button
        type="button"
        onClick={createHousehold}
        disabled={busy !== null}
        title="Start a household with this client as the head"
        className="btn-secondary text-2xs disabled:opacity-50"
      >
        {busy === "create" ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
        New household
      </button>
      <button
        type="button"
        onClick={() => { setErr(null); setOpen(true); }}
        title="Add this client to an existing household"
        className="btn-ghost text-2xs"
      >
        <Users className="size-3" /> Add to existing
      </button>

      {open && (
        <LinkToFamilyDialog
          investorId={investorId}
          investorName={investorName}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function LinkToFamilyDialog({
  investorId,
  investorName,
  onClose,
  onDone,
}: {
  investorId: string;
  investorName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Family[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Family | null>(null);
  const [role, setRole] = useState("spouse");
  const [relationships, setRelationships] = useState<[string, string][]>(FALLBACK_RELATIONSHIPS);

  // Firm-configured relationship master — same source as the family page.
  useEffect(() => {
    let dead = false;
    fetch("/api/families/relationship-types")
      .then((r) => r.json())
      .then((j) => {
        if (dead || !Array.isArray(j?.types) || !j.types.length) return;
        setRelationships(j.types.map((t: any) => [t.key, t.label] as [string, string]));
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Server-side search: a firm here can hold thousands of households, so the
  // list is queried rather than fetched once and filtered in the browser.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/families?limit=25${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`)
        .then((r) => r.json())
        .then((j) => { if (!cancelled) setRows(j.families ?? []); })
        .catch(() => { if (!cancelled) setRows([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q.trim() ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  async function link() {
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
        setErr(
          res.status === 403
            ? "You don’t have permission to edit households — ask your admin for “Edit households”."
            : (j?.error ?? `Could not link (HTTP ${res.status})`)
        );
        return;
      }
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[1px] grid place-items-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border bg-popover text-popover-foreground shadow-xl p-5 animate-scale-in"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-base">Add to a household</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{investorName}</p>
          </div>
          <button onClick={onClose} className="btn-icon size-8" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <label className="block mt-4">
          <div className="text-xs font-medium mb-1">Relationship to the household</div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input-base text-sm w-full">
            {relationships.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>

        <label className="block mt-3">
          <div className="text-xs font-medium mb-1">Pick a household</div>
          <div className="relative">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="Search by household or head name…"
              className="w-full pl-8 pr-3 py-2 text-sm border rounded-md bg-background"
            />
          </div>
        </label>

        <div className="border rounded-md max-h-56 overflow-y-auto mt-2">
          {loading ? (
            <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Searching…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              {q ? "No household matches that name." : "No households yet — use “New household” instead."}
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((f) => (
                <li
                  key={f.id}
                  onClick={() => setPicked(f)}
                  className={`px-3 py-2 cursor-pointer text-sm ${picked?.id === f.id ? "bg-accent" : "hover:bg-accent/40"}`}
                >
                  <div className="font-medium truncate">{f.family_name ?? f.head_name ?? "Household"}</div>
                  {f.head_name && <div className="text-2xs text-muted-foreground truncate">Head: {f.head_name}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {err && <p className="mt-3 text-xs text-rose-600">{err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button onClick={link} disabled={!picked || busy} className="btn-primary text-xs disabled:opacity-50">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Add to household
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
