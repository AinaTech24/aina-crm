"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_TONE, fmtMinutes } from "@/lib/attendance/policy";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

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
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(r: AttRow, status: string) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeUserId: r.employee_user_id, date: r.attendance_date, status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not update attendance", "Update failed");
        return;
      }
      toast.success(`${r.employee_name ?? "Attendance"} set to ${ATTENDANCE_STATUS_LABELS[status] ?? status}`);
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
            <tr key={r.id} className="border-b last:border-0 hover:bg-brand-cyan-light/25 transition-colors">
              <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.employee_name ?? "—"}</td>
              <td className="py-2.5 text-xs tabular-nums whitespace-nowrap">{formatDate(r.attendance_date)}</td>
              <td className="py-2.5">
                {canManage ? (
                  <div className="flex items-center gap-1.5">
                    {busy === r.id && <Loader2 className="size-3 animate-spin text-brand-cyan" />}
                    <SelectField
                      value={r.status}
                      disabled={busy === r.id}
                      onChange={(e) => setStatus(r, e.target.value)}
                      size="sm"
                      className="w-32"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>)}
                    </SelectField>
                  </div>
                ) : (
                  <span className={`chip ${ATTENDANCE_STATUS_TONE[r.status] ?? ""}`}>{ATTENDANCE_STATUS_LABELS[r.status] ?? r.status}</span>
                )}
              </td>
              <td className="py-2.5 text-xs tabular-nums">{hhmm(r.clock_in_at)}</td>
              <td className="py-2.5 text-xs tabular-nums">{hhmm(r.clock_out_at)}</td>
              <td className="py-2.5 text-right text-xs tabular-nums">
                {r.total_minutes && r.total_minutes > 0 ? fmtMinutes(r.total_minutes) : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-[200px] truncate">
                {r.note ? r.note : <span className="text-muted-foreground/40">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
