"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Check, UserPlus, Link as LinkIcon, HeartHandshake } from "lucide-react";
import { formatINR } from "@/lib/utils";

type Suggestion = {
  type: "add_to_family" | "create_family";
  investor: {
    id: string;
    name: string;
    pan: string;
    aum: number;
    activeSipAmount: number;
  };
  targetFamily?: {
    id: string;
    name: string;
  };
  potentialPartners?: Array<{
    id: string;
    name: string;
    pan: string;
    aum: number;
    activeSipAmount: number;
  }>;
  reason: string;
  confidence: "high" | "medium";
};

const RELATIONSHIPS = [
  { key: "spouse", label: "Spouse" },
  { key: "son", label: "Son" },
  { key: "daughter", label: "Daughter" },
  { key: "father", label: "Father" },
  { key: "mother", label: "Mother" },
  { key: "sibling", label: "Sibling" },
  { key: "huf_coparcener", label: "HUF Co-parcener" },
  { key: "other", label: "Other" },
];

export function FamilySuggestionsPanel() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({}); // investorId -> role

  useEffect(() => {
    fetchSuggestions();
  }, []);

  async function fetchSuggestions() {
    try {
      const res = await fetch("/api/families/suggestions");
      if (res.ok) {
        const j = await res.json();
        setSuggestions(j.suggestions ?? []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleLinkToFamily(s: Suggestion) {
    if (!s.targetFamily) return;
    const role = roles[s.investor.id] || "spouse";
    setBusyId(s.investor.id);
    try {
      const res = await fetch(`/api/families/${s.targetFamily.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: s.investor.id, familyRole: role }),
      });
      if (res.ok) {
        // Remove from list
        setSuggestions((prev) => prev.filter((item) => item.investor.id !== s.investor.id));
        router.refresh();
      } else {
        const err = await res.json();
        alert(err.error ?? "Failed to link member");
      }
    } catch (e) {
      alert("An error occurred while linking");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateFamily(s: Suggestion) {
    setBusyId(s.investor.id);
    try {
      // 1. Create family
      const lastName = s.investor.name.split(" ").slice(-1)[0] || "Client";
      const familyName = `${lastName} Family Group`;
      const resCreate = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headName: s.investor.name, familyName }),
      });
      if (!resCreate.ok) {
        const err = await resCreate.json();
        alert(err.error ?? "Failed to create family");
        setBusyId(null);
        return;
      }
      const { id: familyId } = await resCreate.json();

      // 2. Link head investor
      await fetch(`/api/families/${familyId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: s.investor.id, familyRole: "self" }),
      });

      // 3. Link partners
      if (s.potentialPartners) {
        for (const partner of s.potentialPartners) {
          const role = roles[partner.id] || "spouse";
          await fetch(`/api/families/${familyId}/members`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ investorId: partner.id, familyRole: role }),
          });
        }
      }

      // Remove from list
      setSuggestions((prev) => prev.filter((item) => item.investor.id !== s.investor.id));
      router.refresh();
    } catch (e) {
      alert("An error occurred while grouping");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="border rounded-lg bg-card p-6 flex flex-col items-center justify-center gap-2">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Scanning pairing opportunities...</span>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="border rounded-lg bg-card p-6 text-center">
        <HeartHandshake className="size-6 text-muted-foreground/40 mx-auto mb-2" />
        <h3 className="text-xs font-semibold text-muted-foreground">No pending pairings</h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          All unlinked investors appear to be independent clients.
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="border-b px-4 py-3 bg-muted/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-violet-500 fill-violet-100" />
          <h2 className="font-semibold text-sm">AI Pairing Suggestions</h2>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium">
          {suggestions.length} matches
        </span>
      </div>

      <div className="divide-y max-h-[500px] overflow-y-auto">
        {suggestions.map((s) => {
          const isBusy = busyId === s.investor.id;
          return (
            <div key={s.investor.id} className="p-4 space-y-3 hover:bg-accent/10 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-sm">{s.investor.name}</h3>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    PAN: {s.investor.pan} · AUM: {formatINR(s.investor.aum)}
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase px-1.5 py-0.5 rounded-full font-bold border ${
                    s.confidence === "high"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}
                >
                  {s.confidence} Match
                </span>
              </div>

              <div className="text-xs bg-muted/40 text-muted-foreground p-2 rounded border border-border/40 leading-relaxed">
                💡 {s.reason}
              </div>

              {s.type === "add_to_family" && s.targetFamily && (
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">As:</span>
                    <select
                      value={roles[s.investor.id] || "spouse"}
                      onChange={(e) =>
                        setRoles((prev) => ({ ...prev, [s.investor.id]: e.target.value }))
                      }
                      className="text-xs border rounded px-2 py-1 bg-background flex-1"
                    >
                      {RELATIONSHIPS.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    disabled={isBusy}
                    onClick={() => handleLinkToFamily(s)}
                    className="btn-primary text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium hover:opacity-90 flex items-center gap-1"
                  >
                    {isBusy ? <Loader2 className="size-3 animate-spin" /> : <LinkIcon className="size-3" />}
                    Link to {s.targetFamily.name}
                  </button>
                </div>
              )}

              {s.type === "create_family" && s.potentialPartners && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Potential Family Partners:</div>
                    <ul className="space-y-1">
                      {s.potentialPartners.map((p) => (
                        <li key={p.id} className="flex items-center justify-between text-xs border rounded p-1.5 bg-background">
                          <div>
                            <span className="font-semibold">{p.name}</span>
                            <span className="text-muted-foreground font-mono text-[10px] ml-1.5">({p.pan})</span>
                          </div>
                          <select
                            value={roles[p.id] || "spouse"}
                            onChange={(e) =>
                              setRoles((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            className="text-[10px] border rounded px-1.5 py-0.5 bg-background"
                          >
                            {RELATIONSHIPS.map((r) => (
                              <option key={r.key} value={r.key}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    disabled={isBusy}
                    onClick={() => handleCreateFamily(s)}
                    className="w-full btn-primary text-xs px-3 py-1.5 rounded bg-violet-600 text-white font-medium hover:bg-violet-700 flex items-center justify-center gap-1.5"
                  >
                    {isBusy ? <Loader2 className="size-3 animate-spin" /> : <UserPlus className="size-3.5" />}
                    Create Family & Link Members
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
