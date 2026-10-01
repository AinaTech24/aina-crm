"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, Link as LinkIcon, HeartHandshake } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/button-class";
import { InlineEmpty } from "@/components/common/EmptyState";
import { useRelationshipOptions } from "./useRelationshipOptions";

type Person = { id: string; name: string; pan: string; aum: number; activeSipAmount: number };

type Suggestion = {
  type: "add_to_family" | "create_family";
  investor: Person;
  targetFamily?: { id: string; name: string };
  potentialPartners?: Person[];
  reason: string;
  confidence: "high" | "medium";
};

async function errorOf(res: Response, fallback: string) {
  const j = await res.json().catch(() => ({}));
  return (j?.error as string) || fallback;
}

/**
 * Renders the pairing list only — no card chrome or header. It lives inside
 * FamiliesMoreMenu's dialog, which supplies the title and the frame.
 * `onCountChange` keeps the launcher's badge in step as suggestions are
 * consumed, so the count never disagrees with the list behind it.
 *
 * Creating a family names it with the firm's own naming pattern (the API
 * applies it) and makes the suggested person its head in the same call; the
 * rest join in ONE request, and a failure is reported rather than swallowed —
 * the old loop fired a request per partner and announced success regardless.
 */
export function FamilySuggestionsPanel({ onCountChange }: { onCountChange?: (n: number) => void } = {}) {
  const router = useRouter();
  const toast = useToast();
  const relationships = useRelationshipOptions();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({}); // investorId -> role

  useEffect(() => {
    fetch("/api/families/suggestions")
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorOf(res, "Could not load suggestions"));
        const j = await res.json();
        setSuggestions(j.suggestions ?? []);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Report upward on every change, so a link/create that removes a row also
  // decrements the badge — not just the initial load.
  useEffect(() => {
    if (!loading) onCountChange?.(suggestions.length);
  }, [suggestions.length, loading, onCountChange]);

  const roleOf = (id: string) => roles[id] || "spouse";
  const drop = (s: Suggestion) => setSuggestions((prev) => prev.filter((item) => item.investor.id !== s.investor.id));

  async function handleLinkToFamily(s: Suggestion) {
    if (!s.targetFamily) return;
    setBusyId(s.investor.id);
    try {
      const res = await fetch(`/api/families/${s.targetFamily.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: s.investor.id, familyRole: roleOf(s.investor.id) }),
      });
      if (!res.ok) {
        toast.error(await errorOf(res, "Could not add this client to the family."), "Not linked");
        return;
      }
      toast.success(`${s.investor.name} added to ${s.targetFamily.name}`);
      drop(s);
      router.refresh();
    } catch {
      toast.error("Could not reach the server. Try again.", "Not linked");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateFamily(s: Suggestion) {
    setBusyId(s.investor.id);
    try {
      const resCreate = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headName: s.investor.name, primaryInvestorId: s.investor.id }),
      });
      if (!resCreate.ok) {
        toast.error(await errorOf(resCreate, "Could not create the family."), "Not created");
        return;
      }
      const { id: familyId } = await resCreate.json();

      // Members join one relationship at a time (the API takes one role per
      // call), but each call is checked.
      const partners = s.potentialPartners ?? [];
      const byRole = new Map<string, string[]>();
      for (const p of partners) byRole.set(roleOf(p.id), [...(byRole.get(roleOf(p.id)) ?? []), p.id]);
      let failedLinks = 0;
      for (const [familyRole, investorIds] of byRole) {
        const res = await fetch(`/api/families/${familyId}/members`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ investorIds, familyRole }),
        });
        if (!res.ok) failedLinks += investorIds.length;
      }

      drop(s);
      router.refresh();
      if (failedLinks > 0) {
        toast.error(
          `The family was created with ${s.investor.name} as head, but ${failedLinks} member(s) could not be added. Open the family to add them.`,
          "Partly done",
        );
      } else {
        toast.success(`Family created with ${partners.length + 1} members`);
      }
      router.push(`/dashboard/families/${familyId}`);
    } catch {
      toast.error("Could not reach the server. Try again.", "Not created");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Looking for clients who belong together…</span>
      </div>
    );
  }

  if (failed) {
    return <InlineEmpty icon={HeartHandshake} message="Suggestions could not be loaded. Close this and try again." />;
  }

  if (suggestions.length === 0) {
    return (
      <InlineEmpty
        icon={HeartHandshake}
        message="No suggestions — none of your unmapped clients share a mobile, email, address or RTA family head."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-[62vh] divide-y overflow-y-auto">
        {suggestions.map((s) => {
          const isBusy = busyId === s.investor.id;
          return (
            <div key={s.investor.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/dashboard/investors/${s.investor.id}`} className="truncate text-sm font-semibold hover:underline">
                    {s.investor.name}
                  </Link>
                  <div className="mt-0.5 text-2xs text-muted-foreground">
                    {s.investor.pan ? <span className="font-mono">{s.investor.pan}</span> : "No PAN"} · AUM {formatINR(s.investor.aum)}
                  </div>
                </div>
                <Badge raw tone={s.confidence === "high" ? "info" : "neutral"}>
                  {s.confidence === "high" ? "Strong match" : "Possible match"}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">{s.reason}</p>

              {s.type === "add_to_family" && s.targetFamily && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Add as</span>
                  <ThemeSelect
                    value={roleOf(s.investor.id)}
                    onChange={(v) => setRoles((prev) => ({ ...prev, [s.investor.id]: v }))}
                    options={relationships}
                    wrapperClassName="min-w-36"
                    className="py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleLinkToFamily(s)}
                    className={buttonClass("secondary", "sm", "ml-auto")}
                  >
                    {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <LinkIcon className="size-3.5" />}
                    <span className="max-w-56 truncate">Add to {s.targetFamily.name}</span>
                  </button>
                </div>
              )}

              {s.type === "create_family" && s.potentialPartners && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    New family, {s.investor.name} as head, with:
                  </div>
                  <ul className="space-y-1">
                    {s.potentialPartners.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 rounded border bg-background p-1.5 text-xs">
                        <div className="min-w-0">
                          <span className="font-semibold">{p.name}</span>
                          {p.pan && <span className="ml-1.5 font-mono text-2xs text-muted-foreground">{p.pan}</span>}
                        </div>
                        <ThemeSelect
                          value={roleOf(p.id)}
                          onChange={(v) => setRoles((prev) => ({ ...prev, [p.id]: v }))}
                          options={relationships}
                          wrapperClassName="flex-shrink-0"
                          className="py-0.5 pr-7 text-2xs"
                        />
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleCreateFamily(s)}
                    className={buttonClass("secondary", "sm", "w-full")}
                  >
                    {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
                    Create family
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
