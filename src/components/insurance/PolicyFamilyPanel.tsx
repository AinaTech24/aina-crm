"use client";

/**
 * The family panel on a new policy.
 *
 * One person often holds, insures and nominates the rest of a household. This
 * lets the policy be started from the FAMILY: find a household, pick the
 * member who holds the policy, and from then on every other member is one tap
 * away as the life assured or a nominee, with name, gender, date of birth and
 * age already filled. Members come from the CRM's family mapping
 * (GET /api/families/lookup) and only those the viewer may open.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, Users } from "lucide-react";
import type { FamilyLite, FamilyMemberLite } from "@/lib/families/lookup";
import { ageFromDob, relationToHolder, roleLabel } from "@/lib/insurance/family-panel";

export function PolicyFamilyPanel({
  holderId,
  onPickHolder,
  onAddInsured,
  onAddNominee,
  insuredNames,
  nomineeNames,
  canInsured,
  canNominee,
  insuredLabel,
}: {
  holderId: string | null;
  onPickHolder: (id: string, name: string) => void;
  onAddInsured: (m: FamilyMemberLite, relation: string) => void;
  onAddNominee: (m: FamilyMemberLite, relation: string) => void;
  /** Names already in the insured / nominee tables, so a member is not added twice. */
  insuredNames: string[];
  nomineeNames: string[];
  canInsured: boolean;
  canNominee: boolean;
  /** "life assured" · "traveller" · "insured member"… */
  insuredLabel: string;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FamilyLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [family, setFamily] = useState<FamilyLite | null>(null);
  const [loadingFamily, setLoadingFamily] = useState(false);
  const seq = useRef(0);

  // The household of the chosen policyholder.
  useEffect(() => {
    if (!holderId) { setFamily(null); return; }
    const my = ++seq.current;
    setLoadingFamily(true);
    fetch(`/api/families/lookup?investorId=${encodeURIComponent(holderId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { family: null }))
      .then((j) => { if (my === seq.current) setFamily(j.family ?? null); })
      .catch(() => { if (my === seq.current) setFamily(null); })
      .finally(() => { if (my === seq.current) setLoadingFamily(false); });
  }, [holderId]);

  // Search households as the person types.
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/families/lookup?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
        const j = r.ok ? await r.json() : { families: [] };
        setFound(j.families ?? []);
      } catch { setFound([]); } finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const has = (names: string[], n: string) => names.some((x) => x.trim().toLowerCase() === n.trim().toLowerCase());
  const meta = (m: FamilyMemberLite) =>
    [m.isHead ? "Head" : roleLabel(m.familyRole), m.gender, m.dob && ageFromDob(m.dob) ? `${ageFromDob(m.dob)} yrs` : null, m.isMinor ? "Minor" : null]
      .filter(Boolean).join(" · ");

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Users className="size-4 text-muted-foreground" aria-hidden /> Family
        <span className="text-xs font-normal text-muted-foreground">
          — start from the household; each member can be the policyholder, the {insuredLabel} or a nominee
        </span>
      </div>

      {/* Find a family, then pick who holds the policy. */}
      {!holderId && (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a family — name, code or any member…"
              className="input-base pl-9"
              aria-label="Find a family"
            />
            {busy && <Loader2 className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {q.trim().length >= 2 && !busy && found.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">No family matches “{q}”. Search the client above instead.</p>
          )}
          {found.map((f) => (
            <div key={f.id} className="mt-2 rounded-md border border-border bg-card p-2.5">
              <div className="text-sm font-medium">{f.name}{f.code && <span className="ml-2 text-xs font-normal text-muted-foreground">{f.code}</span>}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {f.members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { onPickHolder(m.id, m.name); setQ(""); setFound([]); }}
                    className="rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-secondary"
                    title="Make this member the policyholder"
                  >
                    {m.name}{m.isHead ? " (head)" : ""}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {holderId && loadingFamily && <p className="text-xs text-muted-foreground">Looking up the family…</p>}
      {holderId && !loadingFamily && !family && (
        <p className="text-xs text-muted-foreground">This client is not in a mapped family. Map them under Families to bring their household in here.</p>
      )}

      {holderId && family && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            {family.name}{family.code ? ` · ${family.code}` : ""} — {family.members.length} member{family.members.length === 1 ? "" : "s"}
          </div>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {family.members.map((m) => {
              const rel = relationToHolder(m, holderId, family);
              const isHolder = m.id === holderId;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.name}{isHolder && <span className="ml-2 text-xs font-normal text-muted-foreground">policyholder</span>}</div>
                    <div className="truncate text-xs text-muted-foreground">{meta(m) || "—"}</div>
                  </div>
                  {!isHolder && (
                    <button type="button" onClick={() => onPickHolder(m.id, m.name)} className="btn-ghost text-xs" title="Make this member the policyholder">
                      Policyholder
                    </button>
                  )}
                  {canInsured && (
                    <button type="button" disabled={has(insuredNames, m.name)} onClick={() => onAddInsured(m, rel)}
                      className="btn-ghost inline-flex items-center gap-1 text-xs disabled:opacity-50" title={`Add as the ${insuredLabel}`}>
                      <Plus className="size-3" aria-hidden /> {has(insuredNames, m.name) ? "Added" : insuredLabel.charAt(0).toUpperCase() + insuredLabel.slice(1)}
                    </button>
                  )}
                  {canNominee && !isHolder && (
                    <button type="button" disabled={has(nomineeNames, m.name)} onClick={() => onAddNominee(m, rel)}
                      className="btn-ghost inline-flex items-center gap-1 text-xs disabled:opacity-50" title="Add as a nominee">
                      <Plus className="size-3" aria-hidden /> {has(nomineeNames, m.name) ? "Added" : "Nominee"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
