"use client";

/**
 * Family Master settings — relationship types + household defaults.
 *
 * Relationship types were an 11-item array hardcoded in two components, so a
 * firm that needed "Mother-in-law" or a regional HUF role simply could not
 * record it. They are editable here, and both pickers read this list.
 *
 * Retire, never delete: investors.family_role stores the key, so removing a row
 * would leave existing members pointing at a relationship nobody can name.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Plus, Undo2, X } from "lucide-react";

type RelType = {
  id: string | null;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  stored: boolean;
};

type Settings = {
  defaultReviewFrequency: "monthly" | "quarterly" | "half_yearly" | "annual" | null;
  familyNamePattern: string;
  requirePrimaryMember: boolean;
};

const CADENCES: [string, string][] = [
  ["", "No default — choose per household"],
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["half_yearly", "Half-yearly"],
  ["annual", "Yearly"],
];

export function FamilyMasterSettings({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [types, setTypes] = useState<RelType[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newLabel, setNewLabel] = useState("");

  async function reload() {
    const [t, s] = await Promise.all([
      fetch("/api/families/relationship-types?all=1").then((r) => r.json()).catch(() => ({})),
      fetch("/api/families/settings").then((r) => r.json()).catch(() => ({})),
    ]);
    setTypes(t?.types ?? []);
    setSettings(s?.settings ?? null);
    setLoading(false);
  }

  useEffect(() => { void reload(); }, []);

  function report(res: Response, j: any, okText: string) {
    if (res.ok) { setMsg({ ok: true, text: okText }); return true; }
    setMsg({
      ok: false,
      text: res.status === 403
        ? "You don’t have permission to change master data — ask your admin for “Manage master data”."
        : (j?.error ?? `Failed (HTTP ${res.status})`),
    });
    return false;
  }

  async function addType() {
    const label = newLabel.trim();
    if (!label) return;
    setBusy("add");
    try {
      const res = await fetch("/api/families/relationship-types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const j = await res.json().catch(() => ({}));
      if (report(res, j, `Added “${label}”`)) { setNewLabel(""); await reload(); }
    } finally { setBusy(null); }
  }

  async function patchType(t: RelType, patch: Partial<Pick<RelType, "label" | "sortOrder" | "isActive">>) {
    // A shipped default has no row yet; the API materialises the whole set on
    // first edit, so re-read to pick up the ids it just created.
    if (!t.id) {
      setBusy(t.key);
      try {
        const res = await fetch("/api/families/relationship-types", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ materializeOnly: true }),
        });
        await res.json().catch(() => ({}));
        await reload();
      } finally { setBusy(null); }
      setMsg({ ok: true, text: "Defaults are now editable — apply your change again." });
      return;
    }
    setBusy(t.id);
    try {
      const res = await fetch(`/api/families/relationship-types/${t.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json().catch(() => ({}));
      if (report(res, j, "Saved")) await reload();
    } finally { setBusy(null); }
  }

  async function saveSettings(next: Partial<Settings>) {
    setBusy("settings");
    try {
      const res = await fetch("/api/families/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await res.json().catch(() => ({}));
      if (report(res, j, "Household defaults saved")) {
        setSettings(j.settings);
        router.refresh();
      }
    } finally { setBusy(null); }
  }

  if (loading) {
    return (
      <div className="border rounded-lg bg-card p-12 grid place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const active = types.filter((t) => t.isActive);

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* ── Household defaults ── */}
      <section className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold">Household defaults</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Applied when a new household is created.
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-xs font-medium mb-1">Default review cadence</div>
            <select
              disabled={!canEdit || busy === "settings"}
              value={settings?.defaultReviewFrequency ?? ""}
              onChange={(e) =>
                saveSettings({ defaultReviewFrequency: (e.target.value || null) as Settings["defaultReviewFrequency"] })
              }
              className="input-base text-sm w-full disabled:opacity-60"
            >
              {CADENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Drives the household&apos;s next review date and the reviews-due queue.
            </p>
          </label>

          <label className="block">
            <div className="text-xs font-medium mb-1">Household name pattern</div>
            <div className="flex gap-2">
              <input
                disabled={!canEdit}
                defaultValue={settings?.familyNamePattern ?? "{head} Family"}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== settings?.familyNamePattern) saveSettings({ familyNamePattern: v });
                }}
                className="input-base text-sm flex-1 disabled:opacity-60"
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              <code>{"{head}"}</code> becomes the head&apos;s name — e.g. “{(settings?.familyNamePattern ?? "{head} Family").replace(/\{head\}/gi, "Sharma")}”.
            </p>
          </label>
        </div>

        <label className="mt-4 flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            disabled={!canEdit || busy === "settings"}
            checked={!!settings?.requirePrimaryMember}
            onChange={(e) => saveSettings({ requirePrimaryMember: e.target.checked })}
            className="mt-0.5 size-3.5 rounded border-border accent-brand-cyan"
          />
          <span>
            <span className="font-medium">Require a primary member</span>
            <span className="block text-[10px] text-muted-foreground">
              Refuse to create a household without naming its head. Prevents empty groupings that
              never get finished.
            </span>
          </span>
        </label>
      </section>

      {/* ── Relationship types ── */}
      <section className="border rounded-lg bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Relationships</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              The options offered when adding someone to a household. {active.length} in use.
            </p>
          </div>
          {!types.some((t) => t.stored) && (
            <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5 shrink-0">
              Using defaults
            </span>
          )}
        </div>

        {canEdit && (
          <div className="mt-4 flex gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addType(); } }}
              placeholder="Add a relationship — e.g. Mother-in-law"
              className="input-base text-sm flex-1"
            />
            <button onClick={addType} disabled={!newLabel.trim() || busy === "add"} className="btn-primary text-xs disabled:opacity-50">
              {busy === "add" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add
            </button>
          </div>
        )}

        <ul className="mt-4 border rounded-md divide-y">
          {types.map((t, idx) => (
            <li key={t.key} className={`flex items-center gap-3 p-2.5 ${t.isActive ? "" : "bg-secondary/30"}`}>
              <div className="min-w-0 flex-1">
                {canEdit ? (
                  <input
                    defaultValue={t.label}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== t.label) void patchType(t, { label: v });
                    }}
                    className="bg-transparent text-sm font-medium w-full outline-none focus:underline"
                  />
                ) : (
                  <span className="text-sm font-medium">{t.label}</span>
                )}
                <div className="text-[10px] text-muted-foreground font-mono">
                  {t.key}
                  {t.isSystem ? " · built-in" : ""}
                  {t.isActive ? "" : " · retired"}
                </div>
              </div>

              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    title="Move up"
                    disabled={idx === 0 || busy !== null}
                    onClick={() => void patchType(t, { sortOrder: Math.max(0, (types[idx - 1]?.sortOrder ?? t.sortOrder) - 1) })}
                    className="btn-icon size-7 disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    title="Move down"
                    disabled={idx === types.length - 1 || busy !== null}
                    onClick={() => void patchType(t, { sortOrder: (types[idx + 1]?.sortOrder ?? t.sortOrder) + 1 })}
                    className="btn-icon size-7 disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  {t.isActive ? (
                    <button
                      title="Retire — hides it from the pickers; existing members keep it"
                      disabled={busy !== null}
                      onClick={() => void patchType(t, { isActive: false })}
                      className="btn-icon size-7 text-muted-foreground hover:text-rose-600"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : (
                    <button
                      title="Bring back"
                      disabled={busy !== null}
                      onClick={() => void patchType(t, { isActive: true })}
                      className="btn-icon size-7 text-muted-foreground hover:text-emerald-600"
                    >
                      <Undo2 className="size-3.5" />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[10px] text-muted-foreground">
          Relationships are retired, never deleted — a client&apos;s recorded relationship keeps its
          meaning even after the option stops being offered.
        </p>
      </section>
    </div>
  );
}
