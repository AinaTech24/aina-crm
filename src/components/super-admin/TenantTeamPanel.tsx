"use client";

/**
 * Aina Admin → firm page → Team: every login the firm has, with a "Send reset
 * link" for each active one. The link is emailed to the team member (valid
 * one hour); the admin never sees it or the password. Uses inline status
 * messages, like the account panel above it.
 */

import { useMemo, useState } from "react";
import { KeyRound, Loader2, Search, Users } from "lucide-react";
import { ROLE_LABELS } from "@/lib/auth/rbac";

export type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  roles: string[];
  status: string;
  lastLoginAt: string | null;
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-blue-50 text-blue-700",
  suspended: "bg-rose-50 text-rose-700",
  offboarding: "bg-amber-50 text-amber-700",
};

const lastSeen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "Never";

export function TenantTeamPanel({ tenantId, members }: { tenantId: string; members: TeamMember[] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? members.filter((m) => `${m.name} ${m.email ?? ""}`.toLowerCase().includes(t)) : members;
  }, [members, q]);

  async function sendReset(m: TeamMember) {
    setBusy(m.id);
    setMsg((x) => ({ ...x, [m.id]: { ok: true, text: "" } }));
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: m.id }),
      });
      const j = await res.json().catch(() => ({}));
      setMsg((x) => ({
        ...x,
        [m.id]: res.ok
          ? { ok: j.emailSent !== false, text: j.emailSent === false ? `Link created, but the email could not be sent to ${j.sentTo} — check email settings.` : `Reset link sent to ${j.sentTo}. It works for 1 hour.` }
          : { ok: false, text: j.error ?? "Could not send the reset link." },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" /> Team ({members.length})
        </h2>
        {members.length > 8 && (
          <label className="relative ml-auto">
            <span className="sr-only">Search the team</span>
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="input-base text-sm h-9 pl-8 w-64" />
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Login email</th>
              <th className="py-2 pr-3 font-medium">Role</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Last sign-in</th>
              <th className="py-2 font-medium relative"><span className="sr-only">Password</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">{members.length ? "No one matches." : "This firm has no team members."}</td></tr>
            )}
            {shown.map((m) => {
              const note = msg[m.id];
              const canReset = m.status === "active" && !!m.email;
              return (
                <tr key={m.id} className="border-b last:border-0 align-top">
                  <td className="py-2.5 pr-3 font-medium">{m.name}</td>
                  <td className="py-2.5 pr-3 break-words">{m.email ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2.5 pr-3">{m.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "—"}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-2xs font-medium capitalize ${STATUS_TONE[m.status] ?? "bg-secondary text-foreground"}`}>{m.status}</span>
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground">{lastSeen(m.lastLoginAt)}</td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => sendReset(m)}
                      disabled={!canReset || busy === m.id}
                      title={
                        canReset
                          ? `Email ${m.name} a link to set a new password`
                          : m.status === "invited"
                            ? "Not signed up yet — resend the invite instead"
                            : !m.email
                              ? "No email address"
                              : `Login is ${m.status}`
                      }
                      className="rounded-md border px-3 py-1.5 text-xs inline-flex items-center gap-1.5 hover:bg-accent disabled:opacity-50 whitespace-nowrap"
                    >
                      {busy === m.id ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Send reset link
                    </button>
                    {note?.text && <div className={`mt-1 text-xs ${note.ok ? "text-emerald-600" : "text-rose-600"}`}>{note.text}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
