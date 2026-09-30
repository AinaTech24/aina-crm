"use client";

/**
 * Share a dashboard (D8), Zoho-style: Only me · All users · Custom, where
 * Custom picks users, roles (optionally with the roles under them), branches
 * and teams. "Lock" lets others view and clone it but not edit it.
 *
 * A role dashboard (Owner, Branch Head, RM, Operations, Insurance Team,
 * Claims) shares differently: "Everyone in the roles it's for" (on by
 * default) plus any particular users, roles, branches or teams — or, with the
 * roles unticked, only those. It is always locked, and everyone it reaches
 * sees only the records their own access allows.
 *
 * A branch head (without "Manage dashboards") shares only inside their own
 * branch; the server enforces the same rule (lib/dashboards/platform.ts).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";

export type ShareRowDto = { shareType: "all" | "user" | "role" | "branch" | "team"; shareRef: string; includeSubordinates: boolean };
export type ShareNames = {
  users: Array<{ id: string; name: string; branchId: string | null }>;
  branches: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; branchId: string | null }>;
  roles: Array<{ key: string; label: string }>;
};

type Tab = "user" | "role" | "branch" | "team";

export function ShareDialog({
  dashboardId,
  name,
  shares,
  locked,
  names,
  onlyBranch,
  onClose,
  audience,
}: {
  dashboardId: string;
  name: string;
  shares: ShareRowDto[];
  locked: boolean;
  names: ShareNames;
  /** Set for a branch head: every choice is limited to this branch. */
  onlyBranch: string | null;
  onClose: () => void;
  /** A role dashboard: the roles it is for, in words. */
  audience?: string | null;
}) {
  const router = useRouter();
  const system = audience != null;
  const initialMode = shares.some((s) => s.shareType === "all") ? "all" : shares.length ? "custom" : "me";
  const [mode, setMode] = useState<"me" | "all" | "custom">(initialMode);
  const [roleAudience, setRoleAudience] = useState(shares.some((s) => s.shareType === "all"));
  const [picked, setPicked] = useState<ShareRowDto[]>(shares.filter((s) => s.shareType !== "all"));
  const [lock, setLock] = useState(locked);
  const [tab, setTab] = useState<Tab>("user");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const lists: Record<Tab, Array<{ id: string; label: string }>> = useMemo(() => {
    const inBranch = <T extends { branchId: string | null }>(x: T) => !onlyBranch || x.branchId === onlyBranch;
    return {
      user: names.users.filter(inBranch).map((u) => ({ id: u.id, label: u.name })),
      role: onlyBranch ? [] : names.roles.map((r) => ({ id: r.key, label: r.label })),
      branch: names.branches.filter((b) => !onlyBranch || b.id === onlyBranch).map((b) => ({ id: b.id, label: b.name })),
      team: names.teams.filter(inBranch).map((t) => ({ id: t.id, label: t.name })),
    };
  }, [names, onlyBranch]);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "user", label: "Users" },
    ...(lists.role.length ? [{ key: "role" as Tab, label: "Roles" }] : []),
    { key: "branch", label: "Branches" },
    ...(lists.team.length ? [{ key: "team" as Tab, label: "Teams" }] : []),
  ];

  const has = (t: Tab, id: string) => picked.some((p) => p.shareType === t && p.shareRef === id);
  const toggle = (t: Tab, id: string) =>
    setPicked((ps) => (has(t, id) ? ps.filter((p) => !(p.shareType === t && p.shareRef === id)) : [...ps, { shareType: t, shareRef: id, includeSubordinates: false }]));
  const labelOf = (p: ShareRowDto) => lists[p.shareType as Tab]?.find((x) => x.id === p.shareRef)?.label ?? p.shareRef;

  async function save() {
    setBusy(true);
    try {
      const body = system
        ? { roleAudience, shares: picked }
        : { mode, shares: mode === "custom" ? picked : [], locked: lock };
      const res = await fetch(`/api/dashboards/${dashboardId}/shares`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Could not share the dashboard");
      notify.success("Sharing updated");
      onClose();
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not share the dashboard");
    } finally {
      setBusy(false);
    }
  }

  const visible = lists[tab].filter((x) => !q.trim() || x.label.toLowerCase().includes(q.trim().toLowerCase()));

  const picker = (
    <div className="space-y-2">
      <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-1" role="tablist" aria-label="Share with">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-md px-3 py-1 text-sm ${tab === t.key ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
            onClick={() => { setTab(t.key); setQ(""); }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label htmlFor="share-find" className="sr-only">Find</label>
      <input id="share-find" className="input-base w-full text-sm" placeholder="Find" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {visible.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nothing to pick here.</li>}
        {visible.map((x) => (
          <li key={x.id} className="px-3 py-2 text-sm flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" checked={has(tab, x.id)} onChange={() => toggle(tab, x.id)} />
              <span className="flex-1">{x.label}</span>
            </label>
            {tab === "role" && has("role", x.id) && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={picked.find((p) => p.shareType === "role" && p.shareRef === x.id)?.includeSubordinates ?? false}
                  onChange={(e) =>
                    setPicked((ps) => ps.map((p) => (p.shareType === "role" && p.shareRef === x.id ? { ...p, includeSubordinates: e.target.checked } : p)))
                  }
                />
                Include subordinates
              </label>
            )}
          </li>
        ))}
      </ul>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {picked.map((p) => (
            <span key={`${p.shareType}:${p.shareRef}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-0.5">
              {labelOf(p)}
              <button type="button" aria-label={`Remove ${labelOf(p)}`} onClick={() => toggle(p.shareType as Tab, p.shareRef)}>
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl mt-16">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="share-title" className="section-title">Share “{name}”</h2>
          <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {system ? (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={roleAudience} onChange={(e) => setRoleAudience(e.target.checked)} />
                <span>
                  Everyone in the roles it&apos;s for
                  <span className="block text-xs text-muted-foreground">{audience}</span>
                </span>
              </label>
              <div className="text-xs font-medium text-muted-foreground">{roleAudience ? "Also share with" : "Share only with"}</div>
              {picker}
              {!roleAudience && picked.length === 0 && (
                <p className="text-xs text-muted-foreground">No one else is picked: only people who can manage dashboards will see it.</p>
              )}
              <p className="text-xs text-muted-foreground">
                A role dashboard is always locked: people can open it, not edit it. Each person sees only the records their own access allows.
              </p>
            </div>
          ) : (
          <>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground mb-1">Who can see it</legend>
            {([
              ["me", "Only me"],
              ["all", "All users"],
              ["custom", "Custom"],
            ] as const).map(([k, label]) => (
              <label key={k} className={`flex items-center gap-2 text-sm ${k === "all" && onlyBranch ? "opacity-50" : ""}`}>
                <input type="radio" name="share-mode" value={k} checked={mode === k} disabled={k === "all" && !!onlyBranch} onChange={() => setMode(k)} />
                {label}
                {k === "all" && onlyBranch && <span className="text-xs text-muted-foreground">(admins only)</span>}
              </label>
            ))}
          </fieldset>

          {mode === "custom" && picker}

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={lock} onChange={(e) => setLock(e.target.checked)} />
            <span>Lock this dashboard <span className="text-muted-foreground">— others can view and clone it, not edit it</span></span>
          </label>
          </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" className={buttonClass("ghost", "sm")} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonClass("primary", "sm")} disabled={busy || (!system && mode === "custom" && picked.length === 0)} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
