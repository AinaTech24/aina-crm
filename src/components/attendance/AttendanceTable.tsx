"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_TONE, fmtMinutes } from "@/lib/attendance/policy";

const STATUSES = ["present", "absent", "half_day", "week_off", "holiday", "on_leave"] as const;

export type AttRow = {
  id: string;
  employee_user_id: string;
  employee_name: string | null;
  attendance_date: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  note: string | null;
};

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function AttendanceTable({ rows, canManage }: { rows: AttRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(r: AttRow, status: string) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeUserId: r.employee_user_id, date: r.attendance_date, status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Update failed"); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return <div className="card-surface p-12 text-center text-sm text-muted-foreground">No attendance records match.</div>;
  }

  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Employee</th>
            <th className="text-left py-2 font-medium">Date</th>
            <th className="text-left py-2 font-medium">Status</th>
            <th className="text-left py-2 font-medium">Clock In</th>
            <th className="text-left py-2 font-medium">Clock Out</th>
            <th className="text-right py-2 font-medium">Worked</th>
            <th className="text-left py-2 font-medium pr-4">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
              <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.employee_name ?? "—"}</td>
              <td className="py-2.5 text-xs tabular-nums whitespace-nowrap">{formatDate(r.attendance_date)}</td>
              <td className="py-2.5">
                {canManage ? (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${ATTENDANCE_STATUS_TONE[r.status] ?? ""}`}>
                    {busy === r.id && <Loader2 className="size-3 animate-spin" />}
                    <select
                      value={r.status}
                      disabled={busy === r.id}
                      onChange={(e) => setStatus(r, e.target.value)}
                      className="bg-transparent border-0 outline-none cursor-pointer text-xs font-medium appearance-none pr-1"
                    >
                      {STATUSES.map((s) => <option key={s} value={s} className="bg-white text-foreground">{ATTENDANCE_STATUS_LABELS[s]}</option>)}
                    </select>
                  </span>
                ) : (
                  <span className={`chip ${ATTENDANCE_STATUS_TONE[r.status] ?? ""}`}>{ATTENDANCE_STATUS_LABELS[r.status] ?? r.status}</span>
                )}
              </td>
              <td className="py-2.5 text-xs tabular-nums">{hhmm(r.clock_in_at)}</td>
              <td className="py-2.5 text-xs tabular-nums">{hhmm(r.clock_out_at)}</td>
              <td className="py-2.5 text-right text-xs tabular-nums">{fmtMinutes(r.total_minutes)}</td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-[200px] truncate">{r.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
