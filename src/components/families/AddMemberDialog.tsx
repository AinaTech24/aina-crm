"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X, Search, Loader2, Check } from "lucide-react";
import { ThemeSelect } from "@/components/ui/ThemeSelect";

type Investor = {
  id: string;
  name: string;
  // PAN is genuinely optional — RTA mailback imports create folio-keyed
  // investors before a PAN is known (15 of VSN Financial Services' 86 clients
  // have none). Typing it as `string` let the search below call .toLowerCase()
  // on null, which threw and took the whole page down.
  pan?: string | null;
  segmentTag?: string | null;
  familyId?: string | null;
};

const RELATIONSHIPS = [
  { key: "self", label: "Self / Head" },
  { key: "spouse", label: "Spouse" },
  { key: "father", label: "Father" },
  { key: "mother", label: "Mother" },
  { key: "son", label: "Son" },
  { key: "daughter", label: "Daughter" },
  { key: "sibling", label: "Sibling" },
  { key: "huf_karta", label: "HUF Karta" },
  { key: "huf_coparcener", label: "HUF Co-parcener" },
  { key: "huf", label: "HUF Member" },
  { key: "other", label: "Other" },
];

export function AddMemberDialog({ familyId, familyName }: { familyId: string; familyName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"link" | "new">("link");
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Investor | null>(null);
  const [familyRole, setFamilyRole] = useState("spouse");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Search server-side. This used to pull the first 200 clients ONCE and
  // filter them in the browser — which quietly hid everyone else: firms on
  // this platform hold thousands of clients (10,341 at the largest), and the
  // API caps a page at 200, so a client outside that first page reported
  // “No investors match” however you spelled the name. Debounced so typing
  // doesn't fire a request per keystroke.
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const q = search.trim();
    setLoading(true);
    const t = setTimeout(() => {
      const url = `/api/investors?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}`;
      fetch(url)
        .then((r) => r.json())
        .then((j) => { if (!cancelled) setInvestors(j.rows ?? []); })
        .catch(() => { if (!cancelled) setInvestors([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, search]);

  // Only the already-in-this-family exclusion is left to do client-side.
  const filtered = useMemo(
    () => investors.filter((i) => i.familyId !== familyId),
    [investors, familyId]
  );

  async function linkInvestor() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/families/${familyId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: selected.id, familyRole }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Link failed");
        return;
      }
      reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function goCreateNew() {
    router.push(`/dashboard/investors/new?familyId=${familyId}&familyRole=${familyRole}`);
  }

  function reset() {
    setOpen(false);
    setSelected(null);
    setSearch("");
    setErr(null);
    setTab("link");
    setFamilyRole("spouse");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
      >
        <UserPlus className="size-4" /> Add member
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={reset}>
          <div
            className="bg-card rounded-lg shadow-lg max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-5 py-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Add member to {familyName}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Link an existing investor or create a new one.</p>
              </div>
              <button onClick={reset} className="rounded p-1 hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>

            <div className="border-b px-5 py-2 flex gap-1">
              <button
                onClick={() => setTab("link")}
                className={`text-sm px-3 py-1.5 rounded-md ${tab === "link" ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
              >
                Link existing investor
              </button>
              <button
                onClick={() => setTab("new")}
                className={`text-sm px-3 py-1.5 rounded-md ${tab === "new" ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
              >
                Add new investor
              </button>
            </div>

            {tab === "link" ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <label className="block">
                  <div className="text-xs font-medium mb-1">Relationship to family</div>
                  <ThemeSelect
                    value={familyRole}
                    onChange={setFamilyRole}
                    options={RELATIONSHIPS.map((r) => [r.key, r.label] as [string, string])}
                  />
                </label>

                <label className="block">
                  <div className="text-xs font-medium mb-1">Pick an investor</div>
                  <div className="relative">
                    <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name, PAN or phone…"
                      className="w-full pl-8 pr-3 py-2 text-sm border rounded-md bg-background"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Searches every client in your firm. Showing the closest 50 matches.
                  </p>
                </label>

                <div className="border rounded-md max-h-64 overflow-y-auto">
                  {loading ? (
                    <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" /> Searching…
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="p-6 text-center text-xs text-muted-foreground">
                      {search
                        ? "No client matches that name or PAN."
                        : "No clients yet. Add a new one instead."}
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {filtered.map((i) => (
                        <li
                          key={i.id}
                          onClick={() => setSelected(i)}
                          className={`px-3 py-2 cursor-pointer flex items-center justify-between text-sm ${
                            selected?.id === i.id ? "bg-accent" : "hover:bg-accent/40"
                          }`}
                        >
                          <div>
                            <div className="font-medium">{i.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {i.pan ?? "PAN not set"} {i.segmentTag && <span>· {i.segmentTag}</span>}
                              {i.familyId && <span className="ml-1 text-amber-600">· already in another family</span>}
                            </div>
                          </div>
                          {selected?.id === i.id && <Check className="size-4 text-primary" />}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {err && <div className="text-sm text-rose-600">{err}</div>}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <label className="block">
                  <div className="text-xs font-medium mb-1">Relationship to family</div>
                  <ThemeSelect
                    value={familyRole}
                    onChange={setFamilyRole}
                    options={RELATIONSHIPS.map((r) => [r.key, r.label] as [string, string])}
                  />
                </label>
                <p className="text-sm text-muted-foreground">
                  Continue to the new investor form — we'll pre-fill the family attachment for you.
                </p>
              </div>
            )}

            <div className="border-t px-5 py-3 flex justify-end gap-2">
              <button onClick={reset} className="rounded-md border px-3 py-1.5 text-sm">
                Cancel
              </button>
              {tab === "link" ? (
                <button
                  onClick={linkInvestor}
                  disabled={busy || !selected}
                  className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  Link {selected ? `· ${selected.name}` : ""}
                </button>
              ) : (
                <button
                  onClick={goCreateNew}
                  className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
                >
                  Continue to new investor form →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
