"use client";

/**
 * Add members to a family — pick one or several existing clients, or go to
 * the new-client form with the family pre-attached.
 *
 * Several at once: mapping a household used to mean opening this dialog once
 * per person. Ticked clients join in ONE request with the relationship chosen
 * above the list (change it per person afterwards in the members table).
 *
 * A client already in another family is shown with a warning, not hidden:
 * adding them MOVES them (the API clears that family's head if it was them),
 * which is sometimes exactly what the RM wants and should never be a surprise.
 *
 * Relationships are the firm's list (Settings → Family). "Self / Head" is not
 * offered here — the head is chosen in the members table or Edit details.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Search, Loader2, Check, AlertTriangle } from "lucide-react";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { useToast } from "@/components/ui/Toast";
import { useRelationshipOptions } from "./useRelationshipOptions";

type Investor = {
  id: string;
  name: string;
  // PAN is optional — RTA mailback imports create folio-keyed clients before a
  // PAN is known.
  pan?: string | null;
  segmentTag?: string | null;
  familyId?: string | null;
};

const MAX_PICK = 50;

export function AddMemberDialog({ familyId, familyName }: { familyId: string; familyName: string }) {
  const router = useRouter();
  const toast = useToast();
  const relationships = useRelationshipOptions();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"link" | "new">("link");
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Map<string, Investor>>(new Map());
  const [familyRole, setFamilyRole] = useState("spouse");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Set when the SEARCH itself failed — distinct from a search that found nothing. */
  const [searchErr, setSearchErr] = useState<string | null>(null);

  // Server-side search, debounced: firms hold thousands of clients, so the
  // list is queried rather than fetched once and filtered here.
  useEffect(() => {
    if (!open || tab !== "link") return;
    let cancelled = false;
    const q = search.trim();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/investors?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}`)
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error ?? `Search failed (${r.status})`);
          return j;
        })
        .then((j) => {
          if (cancelled) return;
          setInvestors(j.rows ?? []);
          setSearchErr(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setInvestors([]);
          setSearchErr(e?.message ?? "Could not search clients.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, tab, search]);

  const results = useMemo(() => investors.filter((i) => i.familyId !== familyId), [investors, familyId]);
  const movingCount = [...picked.values()].filter((i) => i.familyId && i.familyId !== familyId).length;

  function toggle(i: Investor) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(i.id)) next.delete(i.id);
      else if (next.size < MAX_PICK) next.set(i.id, i);
      return next;
    });
  }

  async function linkPicked() {
    if (picked.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/families/${familyId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorIds: [...picked.keys()], familyRole }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not add these clients.");
        return;
      }
      const n = Number(j.linked ?? picked.size);
      toast.success(`${n} member${n === 1 ? "" : "s"} added to ${familyName}`);
      close();
      router.refresh();
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function goCreateNew() {
    router.push(`/dashboard/investors/new?familyId=${familyId}&familyRole=${encodeURIComponent(familyRole)}`);
  }

  function close() {
    setOpen(false);
    setPicked(new Map());
    setSearch("");
    setErr(null);
    setTab("link");
    setFamilyRole("spouse");
  }

  const tabCls = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${on ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        <UserPlus className="size-4" /> Add members
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-xl">
          <DialogTitle>Add members to {familyName}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">
            Pick existing clients, or add someone who is not a client yet.
          </DialogDescription>

          <div className="mt-4 inline-flex rounded-lg bg-secondary p-1" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "link"} onClick={() => setTab("link")} className={tabCls(tab === "link")}>
              Existing clients
            </button>
            <button type="button" role="tab" aria-selected={tab === "new"} onClick={() => setTab("new")} className={tabCls(tab === "new")}>
              New client
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <label className="block">
              <div className="mb-1 text-xs font-medium">
                Relationship to the family{tab === "link" && picked.size > 1 ? " (for everyone picked)" : ""}
              </div>
              <ThemeSelect value={familyRole} onChange={setFamilyRole} options={relationships} />
            </label>

            {tab === "link" ? (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, PAN, mobile or email…"
                    aria-label="Search clients"
                    className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
                    autoFocus
                  />
                </div>

                <div className="max-h-72 overflow-y-auto rounded-md border">
                  {loading ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Searching…
                    </div>
                  ) : searchErr ? (
                    <div className="p-6 text-center text-xs text-destructive">
                      {searchErr}
                      <div className="mt-1 text-muted-foreground">The search failed — this is not about what you typed.</div>
                    </div>
                  ) : results.length === 0 ? (
                    <div className="p-6 text-center text-xs text-muted-foreground">
                      {search ? "No client matches that name, PAN, mobile or email." : "No clients to show."}
                    </div>
                  ) : (
                    <ul className="divide-y" role="listbox" aria-multiselectable>
                      {results.map((i) => {
                        const on = picked.has(i.id);
                        return (
                          <li key={i.id} role="option" aria-selected={on}>
                            <button
                              type="button"
                              onClick={() => toggle(i)}
                              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${on ? "bg-accent" : "hover:bg-accent/50"}`}
                            >
                              <span
                                aria-hidden
                                className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                              >
                                {on && <Check className="size-3" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{i.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {i.pan ? <span className="font-mono">{i.pan}</span> : "No PAN"}
                                  {i.segmentTag ? ` · ${i.segmentTag}` : ""}
                                  {i.familyId ? " · in another family" : ""}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {movingCount > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                    {movingCount === 1 ? "One client you picked is" : `${movingCount} clients you picked are`} in another
                    family and will move to this one.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Opens the new-client form with this family and relationship already filled in.
              </p>
            )}

            {err && (
              <div role="alert" className="text-sm text-destructive">
                {err}
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {tab === "link" && picked.size > 0 && (
              <span className="mr-auto text-xs text-muted-foreground">{picked.size} picked</span>
            )}
            <button type="button" onClick={close} className={buttonClass("secondary")}>
              Cancel
            </button>
            {tab === "link" ? (
              <button type="button" onClick={linkPicked} disabled={busy || picked.size === 0} className={buttonClass("primary")}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {picked.size > 1 ? `Add ${picked.size} members` : "Add member"}
              </button>
            ) : (
              <button type="button" onClick={goCreateNew} className={buttonClass("primary")}>
                Continue to new client form
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
