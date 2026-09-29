"use client";

/**
 * Attendance list. Nothing is edited inline: a manager changes a record through
 * "Correct", a dialog that asks for the new status / times AND a reason, and
 * the API keeps the before and after values with that reason in the audit
 * trail. A dropdown in every row changed the record the moment it was touched,
 * with no record of why.
 *
 * `pending` rows are today's auto-seeded "absent" before the working day has
 * ended: they read "Not clocked in" (muted) until then.
 */

import { useState, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clock, PencilLine } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_TONE, fmtMinutes } from "@/lib/attendance/policy";
import { SelectField } from "@/components/ui/SelectField";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";

const STATUSES = ["present", "absent", "half_day", "week_off", "holiday", "on_leave"] as const;
const REASON_MIN = 3;

const SOURCE_LABEL: Record<string, string> = { manual: "Manual", clock: "Clocked", auto: "Auto" };
const SOURCE_TONE: Record<string, string> = {
  manual: "bg-secondary text-muted-foreground",
  clock: "bg-emerald-50 text-emerald-700",
  auto: "bg-secondary text-muted-foreground",
};

export type AttRow = {
  id: string;
  employee_user_id: string;
  employee_name: string | null;
  employee_avatar_url?: string | null;
  attendance_date: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  note: string | null;
  source?: string | null;
  is_late?: boolean;
  late_minutes?: number;
  is_early_out?: boolean;
  early_minutes?: number;
  /** Today's auto "absent" before the working day ends — shown as Not clocked in. */
  pending?: boolean;
};

/** ISO → "HH:MM" in IST for a time input value. */
function hhmmInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}
/** ISO → "h:mm AM/PM" in IST for display. */
function hhmm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function AttendanceTable({ rows, canManage, toolbar }: { rows: AttRow[]; canManage: boolean; toolbar?: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("present");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [correcting, setCorrecting] = useState<AttRow | null>(null);

  const allSelected = useMemo(() => rows.length > 0 && rows.every((r) => sel.has(r.id)), [rows, sel]);

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function applyBulk() {
    const ids = [...sel];
    if (!ids.length || bulkReason.trim().length < REASON_MIN) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/attendance/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, status: bulkStatus, reason: bulkReason.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.issues?.[0]?.message ?? j.error ?? "Bulk update failed", "Update failed");
        return;
      }
      toast.success(`${j.count ?? ids.length} marked ${ATTENDANCE_STATUS_LABELS[bulkStatus] ?? bulkStatus}`);
      setSel(new Set());
      setBulkReason("");
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  const header = toolbar ? (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
      <div className="text-sm font-semibold whitespace-nowrap">
        Attendance <span className="text-muted-foreground font-normal text-xs">· {rows.length}</span>
      </div>
      {toolbar}
    </div>
  ) : null;

  if (rows.length === 0) {
    return (
      <div className="card-surface overflow-hidden">
        {header}
        <div className="p-12 text-center text-sm text-muted-foreground">No attendance records match these filters.</div>
      </div>
    );
  }

  const bulkReasonOk = bulkReason.trim().length >= REASON_MIN;

  return (
    <div className="space-y-2">
      {canManage && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} selected</span>
          <span className="text-muted-foreground">· set to</span>
          <SelectField value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} size="sm" className="w-32" aria-label="New status">
            {STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>)}
          </SelectField>
          <label htmlFor="att-bulk-reason" className="sr-only">Reason for the change</label>
          <input
            id="att-bulk-reason"
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
            maxLength={300}
            placeholder="Reason (required), e.g. Diwali holiday"
            className="input-base h-8 min-w-48 flex-1 text-xs sm:max-w-xs"
          />
          <button onClick={applyBulk} disabled={bulkBusy || !bulkReasonOk} className={buttonClass("primary", "sm")}>
            {bulkBusy && <Loader2 className="size-3 animate-spin" />} Apply to {sel.size}
          </button>
          <button onClick={() => { setSel(new Set()); setBulkReason(""); }} className={buttonClass("ghost", "sm")}>
            Clear
          </button>
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {header}
        <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              {canManage && (
                <th className="w-9 pl-4 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-4 accent-brand-cyan" aria-label="Select all" />
                </th>
              )}
              <th className="text-left px-4 py-2 font-medium">Employee</th>
              <th className="text-left py-2 font-medium">Date</th>
              <th className="text-left py-2 font-medium">Status</th>
              <th className="text-left py-2 font-medium">Clock In</th>
              <th className="text-left py-2 font-medium">Clock Out</th>
              <th className="text-right py-2 font-medium">Worked</th>
              <th className="text-left py-2 pl-4 font-medium">Note</th>
              {canManage && <th className="relative py-2 pr-4"><span className="sr-only">Correct</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
                {canManage && (
                  <td className="pl-4 py-2.5">
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-brand-cyan" aria-label={`Select ${r.employee_name ?? "row"}`} />
                  </td>
                )}
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Avatar src={r.employee_avatar_url ?? null} name={r.employee_name} size={26} />
                    <span>{r.employee_name ?? "—"}</span>
                  </div>
                </td>
                <td className="py-2.5 text-xs tabular-nums whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {formatDate(r.attendance_date)}
                    {r.source && !r.pending && (
                      <span className={`text-2xs px-1 py-px rounded ${SOURCE_TONE[r.source] ?? ""}`} title={`Marked: ${SOURCE_LABEL[r.source] ?? r.source}`}>
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5">
                  {r.pending ? (
                    <span className="chip bg-secondary text-muted-foreground" title="Marked absent only if they haven't clocked in by the end of the working day">
                      Not clocked in
                    </span>
                  ) : (
                    <span className={`chip ${ATTENDANCE_STATUS_TONE[r.status] ?? ""}`}>{ATTENDANCE_STATUS_LABELS[r.status] ?? r.status}</span>
                  )}
                </td>
                <td className="py-2.5 text-xs tabular-nums">
                  <div className="flex items-center gap-1.5">
                    {hhmm(r.clock_in_at)}
                    {r.is_late && (
                      <span className="text-2xs px-1 py-px rounded bg-rose-50 text-rose-600" title={`Late by ${r.late_minutes ?? 0} min`}>
                        Late
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 text-xs tabular-nums">
                  <div className="flex items-center gap-1.5">
                    {hhmm(r.clock_out_at)}
                    {r.is_early_out && (
                      <span className="text-2xs px-1 py-px rounded bg-amber-50 text-amber-600" title={`Left ${r.early_minutes ?? 0} min early`}>
                        Early
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 text-right text-xs tabular-nums">
                  {r.total_minutes && r.total_minutes > 0 ? (
                    <span className="inline-flex items-center gap-1 justify-end">
                      <Clock className="size-3 text-muted-foreground/50" /> {fmtMinutes(r.total_minutes)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="py-2.5 pl-4 text-xs text-muted-foreground max-w-[200px] truncate">
                  {r.note ? r.note : <span className="text-muted-foreground/40">—</span>}
                </td>
                {canManage && (
                  <td className="py-2.5 pr-4 text-right">
                    <button type="button" onClick={() => setCorrecting(r)} className={buttonClass("ghost", "sm")}>
                      <PencilLine className="size-3.5" aria-hidden /> Correct
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {canManage && (
        <CorrectionDialog
          row={correcting}
          onClose={() => setCorrecting(null)}
          onDone={(msg) => {
            toast.success(msg);
            setCorrecting(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Correct one record: status, clock times, and a required reason for the audit trail. */
function CorrectionDialog({ row, onClose, onDone }: { row: AttRow | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [status, setStatus] = useState("present");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forId, setForId] = useState<string | null>(null);

  // Load the row's current values each time a different row opens.
  if (row && forId !== row.id) {
    setForId(row.id);
    setStatus(row.pending ? "present" : row.status);
    setClockIn(hhmmInput(row.clock_in_at));
    setClockOut(hhmmInput(row.clock_out_at));
    setReason("");
    setErr(null);
  }
  if (!row && forId !== null) setForId(null);

  async function save() {
    if (!row) return;
    if (reason.trim().length < REASON_MIN) {
      setErr("Say why you are correcting this record.");
      return;
    }
    if (clockIn && clockOut && clockOut <= clockIn) {
      setErr("Clock-out must be after clock-in.");
      return;
    }
    setBusy(true);
    setErr(null);
    const iso = (t: string) => new Date(`${row.attendance_date.slice(0, 10)}T${t}:00+05:30`).toISOString();
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeUserId: row.employee_user_id,
          date: row.attendance_date,
          status,
          clockInAt: clockIn && clockIn !== hhmmInput(row.clock_in_at) ? iso(clockIn) : undefined,
          clockOutAt: clockOut && clockOut !== hhmmInput(row.clock_out_at) ? iso(clockOut) : undefined,
          reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.issues?.[0]?.message ?? j.error ?? "Could not save the correction.");
        return;
      }
      onDone(`${row.employee_name ?? "Attendance"} corrected to ${ATTENDANCE_STATUS_LABELS[status] ?? status}.`);
    } catch {
      setErr("Network error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Correct attendance</DialogTitle>
          <DialogDescription>
            {row?.employee_name ?? "Employee"} · {row ? formatDate(row.attendance_date) : ""}. The change and your reason are kept in
            the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3 text-sm">
          <div>
            <label htmlFor="att-fix-status" className="mb-1 block text-xs font-medium">Status</label>
            <select id="att-fix-status" value={status} onChange={(e) => setStatus(e.target.value)} className="input-base w-full">
              {STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="att-fix-in" className="mb-1 block text-xs font-medium">Clock in</label>
              <input id="att-fix-in" type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} className="input-base w-full" />
            </div>
            <div>
              <label htmlFor="att-fix-out" className="mb-1 block text-xs font-medium">Clock out</label>
              <input id="att-fix-out" type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} className="input-base w-full" />
            </div>
          </div>
          <div>
            <label htmlFor="att-fix-reason" className="mb-1 block text-xs font-medium">Reason</label>
            <textarea
              id="att-fix-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="e.g. Forgot to clock out; confirmed with the branch head"
              className="input-base w-full"
            />
          </div>
          {err && <p className="text-sm text-rose-700">{err}</p>}
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass("secondary")}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || reason.trim().length < REASON_MIN} className={buttonClass("primary")}>
            {busy && <Loader2 className="size-4 animate-spin" />} Save correction
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
