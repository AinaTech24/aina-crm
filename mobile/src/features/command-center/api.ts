/**
 * Command Center data layer — GET /api/command-center (the ranked "what needs me
 * today" worklist, same buildCommandQueue logic as web) + the inline row actions
 * (snooze / dismiss / mark-task-done).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { queuedPatch } from "../../lib/offlineQueue";

export type Severity = "now" | "today" | "soon";
export type Tone = "rose" | "amber" | "sky" | "violet" | "emerald";

export interface CommandItem {
  id: string;
  itemKey: string;
  title: string;
  detail: string | null;
  href: string;
  date: string | null;
  ageDays: number | null;
  amount: number | null;
  client: { id: string; name: string } | null;
  phone: string | null;
  actionType: "task" | "birthday" | "anniversary" | "generic";
  escalate: boolean;
}

export interface CommandGroup {
  key: string;
  label: string;
  icon: string;
  severity: Severity;
  severityLabel: string;
  tone: Tone;
  count: number;
  href: string | null;
  items: CommandItem[];
}

export interface CommandCenter {
  scope: { firmWide: boolean; scopeLabel: string; userId: string | null; clientId: string | null; clientName: string | null };
  kpis: { now: number; today: number; soon: number; total: number };
  groups: CommandGroup[];
  filterOptions: { categories: { value: string; label: string }[]; users?: { value: string; label: string }[] };
}

export function useCommandCenter() {
  return useQuery({
    queryKey: ["command-center"],
    queryFn: () => api.get<CommandCenter>("/api/command-center"),
    staleTime: 30_000,
  });
}

/** Snooze 1 day / dismiss a queue item. */
export function useCommandSnooze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { itemKey: string; action: "1d" | "3d" | "7d" | "dismiss" | "unsnooze" }) =>
      api.post("/api/command-center/snooze", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["command-center"] }),
  });
}

/** Mark a task-type item done. */
export function useMarkTaskDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => queuedPatch(`/api/tasks/${taskId}`, { status: "completed" }, "Task completion"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["command-center"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/** Birthday / anniversary WhatsApp wish text (mirrors the web wishText()). */
export function wishText(actionType: string, name: string): string {
  if (actionType === "anniversary") return `Dear ${name}, wishing you a very happy wedding anniversary! 💐`;
  return `Dear ${name}, wishing you a very happy birthday! 🎂 May the year ahead bring you health, happiness and prosperity.`;
}

const TONE_HEX: Record<Tone, string> = {
  rose: "#DC2626",
  amber: "#D97706",
  sky: "#0EA5E9",
  violet: "#7C3AED",
  emerald: "#16A34A",
};
export const toneColor = (t: Tone) => TONE_HEX[t] ?? "#64748B";

/** lucide icon name (from the API) → Feather icon name. */
const ICON_MAP: Record<string, string> = {
  LifeBuoy: "life-buoy",
  XOctagon: "x-octagon",
  TrendingDown: "trending-down",
  CalendarClock: "calendar",
  Calendar: "calendar",
  CalendarOff: "calendar",
  CalendarCheck: "calendar",
  ShieldAlert: "shield",
  ListChecks: "check-square",
  Sparkles: "star",
  ShieldCheck: "shield",
  Cake: "gift",
  FileText: "file-text",
  MessageCircle: "message-circle",
};
export const featherIcon = (lucide: string) => ICON_MAP[lucide] ?? "alert-circle";

/** Query params a native screen understands, kept when a web link is mapped. */
const KEEP_QUERY: Record<string, string[]> = {
  // Tasks tab reads ?due=overdue|today and ?approval=mine (approval notifications).
  "/tasks": ["approval", "due"],
};

/** Convert a web /dashboard/... href to the mobile route (best-effort). */
export function toMobileRoute(href: string): string | null {
  if (!href?.startsWith("/dashboard/")) return null;
  const [rawPath, rawQuery = ""] = href.replace(/^\/dashboard\//, "").split("?");
  const path = rawPath.replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean);
  if (seg.length === 0) return null;
  // Web pages whose native screen lives at a different path, and pages the CRM
  // removed (it redirects them; older notifications still link to them). Without
  // this /dashboard/tasks/daily opened /m/tasks/daily, read as a task id.
  const ALIASES: Record<string, string> = {
    tasks: "/tasks",
    "tasks/daily": "/tasks", "tasks/daily/team": "/tasks", "tasks/weekly-pack": "/tasks",
    "my-day": "/home", "command-center": "/home", "next-best-action": "/home",
    "pipeline-board": "/leads", lifecycle: "/leads", opportunities: "/m/opportunities",
    // Removed from the CRM (it redirects them); older notifications still link here.
    "compliance/command-center": "/home", "compliance/amfi-circulars": "/home", "content-library": "/home",
    "complaints/disclosure": "/m/service-requests",
  };
  const target = ALIASES[seg.join("/")] ?? "/m/" + seg.join("/");
  const keep = KEEP_QUERY[target];
  if (!keep || !rawQuery) return target;
  const name = (pair: string) => { try { return decodeURIComponent(pair.split("=")[0] ?? ""); } catch { return ""; } };
  const kept = rawQuery.split("&").filter((pair) => keep.includes(name(pair)));
  return kept.length ? `${target}?${kept.join("&")}` : target;
}
