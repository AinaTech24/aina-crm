"use client";

/**
 * Who the proposal is for: an existing client, a family (optionally one
 * member of it), or a lead. Moved unchanged in behaviour from the old
 * one-page proposal form into the builder's first step.
 */

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { roleLabel } from "@/lib/families/roles";

export type Recipient = { type: "investor" | "lead" | "family"; id: string; name: string };
type Mode = Recipient["type"];

const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function RecipientPicker({
  value,
  onChange,
  familyMemberId,
  onFamilyMember,
  locked,
}: {
  value: Recipient | null;
  onChange: (r: Recipient | null) => void;
  familyMemberId: string | null;
  onFamilyMember: (id: string | null) => void;
  /** Editing an existing proposal: the recipient is fixed. */
  locked?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(value?.type ?? "investor");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<any[]>([]);
  const [familyOptions, setFamilyOptions] = useState<any[]>([]);
  const [familyQuery, setFamilyQuery] = useState("");
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);

  // Follow a recipient set from outside (a ?investorId= prefill, an edit load).
  useEffect(() => {
    if (value?.type) setMode(value.type);
  }, [value?.type]);

  useEffect(() => {
    if (mode !== "lead" || leadQuery.trim().length < 2) {
      setLeadResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(leadQuery)}`);
      const j = await r.json().catch(() => ({}));
      setLeadResults(j.leads ?? []);
    }, 220);
    return () => clearTimeout(t);
  }, [leadQuery, mode]);

  // Families are few per firm; load them all when the family mode opens.
  useEffect(() => {
    if (mode !== "family") return;
    let dead = false;
    fetch("/api/families")
      .then((r) => r.json())
      .then((j) => {
        if (!dead) setFamilyOptions(j.families ?? []);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [mode]);

  // A picked family loads its members for the optional "address to" choice.
  useEffect(() => {
    if (value?.type !== "family") {
      setFamilyMembers([]);
      return;
    }
    let dead = false;
    fetch(`/api/families/${value.id}/full`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((j) => {
        if (!dead) setFamilyMembers(j.members ?? []);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [value?.type, value?.id]);

  const filteredFamilies = familyOptions.filter((f) => {
    const q = familyQuery.trim().toLowerCase();
    return !q || (f.familyName ?? f.headName ?? "").toLowerCase().includes(q);
  });

  const switchMode = (m: Mode) => {
    setMode(m);
    onChange(null);
    onFamilyMember(null);
  };

  if (locked && value) {
    return (
      <Picked
        name={value.name}
        sub={value.type === "lead" ? "Lead" : value.type === "family" ? "Family group" : "Client"}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {(
          [
            ["investor", "Existing client"],
            ["family", "Family / Family head"],
            ["lead", "Lead (prospect)"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            aria-pressed={mode === m}
            className={`rounded-lg border p-3 text-sm font-medium transition ${
              mode === m ? "border-brand-cyan bg-brand-cyan-light/40 text-brand-cyan-deep" : "border-border hover:bg-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "investor" ? (
        <InvestorLookup
          value={value?.type === "investor" ? value.id : null}
          displayName={value?.type === "investor" ? value.name : null}
          onSelect={(id, name) => onChange({ type: "investor", id, name })}
          onClear={() => onChange(null)}
          placeholder="Search client by name, PAN, mobile, or email…"
        />
      ) : mode === "family" ? (
        value?.type === "family" ? (
          <div className="space-y-3">
            <Picked name={value.name} sub="Family group · contact resolves to the head" onClear={() => { onChange(null); onFamilyMember(null); }} />
            {familyMembers.length > 0 && (
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Address proposal to (optional)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <MemberButton active={!familyMemberId} onClick={() => onFamilyMember(null)} title="Whole family" sub="Default · contact = head" />
                  {familyMembers.map((m: any) => (
                    <MemberButton
                      key={m.id}
                      active={familyMemberId === m.id}
                      onClick={() => onFamilyMember(m.id)}
                      title={m.name}
                      sub={`${m.familyRole || m.family_role ? roleLabel(m.familyRole ?? m.family_role) : "Member"}${m.isPrimary || m.is_primary ? " · Head" : ""}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <input
              value={familyQuery}
              onChange={(e) => setFamilyQuery(e.target.value)}
              placeholder="Search families by family name or head name…"
              className="input-base"
              aria-label="Search families"
            />
            {familyOptions.length === 0 ? (
              <p className="text-2xs text-muted-foreground mt-1">Loading families…</p>
            ) : (
              <ul className="mt-1 card-elevated max-h-72 overflow-y-auto scrollbar-thin">
                {filteredFamilies.slice(0, 30).map((f: any) => {
                  const display = f.familyName ?? (f.headName ? `${f.headName} Family` : "Family");
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => onChange({ type: "family", id: f.id, name: display })}
                        className="w-full text-left px-3 py-2 hover:bg-brand-cyan-light/40 flex items-center gap-2"
                      >
                        <Avatar name={display} />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm truncate">{display}</div>
                          <div className="text-2xs text-muted-foreground">Head · {f.headName ?? "—"}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {filteredFamilies.length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground text-center">No families match “{familyQuery}”.</li>
                )}
              </ul>
            )}
          </div>
        )
      ) : value?.type === "lead" ? (
        <Picked name={value.name} sub="Lead" onClear={() => onChange(null)} />
      ) : (
        <div className="relative">
          <input
            value={leadQuery}
            onChange={(e) => setLeadQuery(e.target.value)}
            placeholder="Search leads by name, phone, or email…"
            className="input-base"
            aria-label="Search leads"
          />
          {leadResults.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-60 overflow-y-auto scrollbar-thin">
              <ul className="py-1.5">
                {leadResults.map((l: any) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ type: "lead", id: l.id, name: l.name });
                        setLeadQuery("");
                        setLeadResults([]);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-brand-cyan-light/40"
                    >
                      <div className="font-semibold text-sm">{l.name}</div>
                      <div className="text-2xs text-muted-foreground">
                        {l.phone ?? "—"} · {l.stage} · {l.source}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-2xs font-bold flex-shrink-0 shadow-sm">
      {initials(name)}
    </div>
  );
}

function Picked({ name, sub, onClear }: { name: string; sub: string; onClear?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2 min-w-0">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{name}</div>
          <div className="text-2xs text-muted-foreground">{sub}</div>
        </div>
      </div>
      {onClear && (
        <button type="button" onClick={onClear} className="btn-icon" title="Change recipient" aria-label="Change recipient">
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function MemberButton({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-md border px-2.5 py-1.5 text-xs transition ${
        active ? "border-brand-cyan bg-brand-cyan-light/30" : "border-border hover:bg-secondary"
      }`}
    >
      <div className="font-semibold truncate">{title}</div>
      <div className="text-2xs text-muted-foreground">{sub}</div>
    </button>
  );
}
