"use client";

/**
 * Settings → Dashboards (D8): the default dashboard per role, and a dashboard
 * assigned to one person (it beats their role's default). Each change saves
 * on its own.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/ui/Toast";

type Opt = { id: string; name: string };

export function DefaultsEditor({
  roles,
  users,
}: {
  roles: Array<{ role: string; label: string; current: string | null; options: Opt[] }>;
  users: Array<{ id: string; name: string; current: string | null; options: Opt[] }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function set(targetType: "role" | "user", targetRef: string, dashboardId: string | null) {
    setBusy(`${targetType}:${targetRef}`);
    try {
      const res = await fetch("/api/dashboards/defaults", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetRef, dashboardId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Could not save");
      notify.success("Saved");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card-surface">
        <div className="px-5 pt-4 pb-2">
          <h2 className="section-title">Default per role</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-5 py-2 text-left">Role</th>
              <th className="px-5 py-2 text-left">Opens</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.role}>
                <td className="px-5 py-2 font-medium">{r.label}</td>
                <td className="px-5 py-2">
                  <label htmlFor={`role-${r.role}`} className="sr-only">Default dashboard for {r.label}</label>
                  <select
                    id={`role-${r.role}`}
                    className="input-base w-full max-w-sm text-sm"
                    value={r.current ?? ""}
                    disabled={busy === `role:${r.role}`}
                    onChange={(e) => set("role", r.role, e.target.value || null)}
                  >
                    <option value="">Owner Dashboard (fallback)</option>
                    {r.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-surface">
        <div className="px-5 pt-4 pb-2">
          <h2 className="section-title">Assigned to a person</h2>
          
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-5 py-2 text-left">Person</th>
              <th className="px-5 py-2 text-left">Opens</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-5 py-2 font-medium">{u.name}</td>
                <td className="px-5 py-2">
                  <label htmlFor={`user-${u.id}`} className="sr-only">Dashboard assigned to {u.name}</label>
                  <select
                    id={`user-${u.id}`}
                    className="input-base w-full max-w-sm text-sm"
                    value={u.current ?? ""}
                    disabled={busy === `user:${u.id}`}
                    onChange={(e) => set("user", u.id, e.target.value || null)}
                  >
                    <option value="">Role default</option>
                    {u.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
