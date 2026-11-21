/**
 * New task — the live CRM's New task form (web /dashboard/tasks/new), in its
 * order: template → For client → What needs doing → Type of task (General /
 * Financial / Non-financial, and Insurance for a firm with the insuranceTasks
 * flag → the request) → entry date, due, assign to → priority → More options.
 *
 * A request is one of request-types.ts (copied from the CRM): it asks for the
 * client, its own fields (mode, amount, folio — an insurance request names them
 * "Policy number", "Premium (₹)" — Online / Physical KYC) and, for most
 * financial requests, one or more scheme ROWS whose schemes are picked from the
 * firm's Scheme Master (PMS / AIF are typed). The task starts with the
 * request's checklist (an MF request's ends in "RTA data check"); the server
 * books the draft Business entry and says so.
 *
 * The checklist follows the web's rule: a request fills an empty list or
 * replaces the one the previous request put in — never one a template brought
 * — and only a redemption's Online / Offline route (flagged firms) changes it
 * again, so picking a Mode never wipes sub-tasks already assigned.
 *
 * Short by default: the task itself is always open; "When & who", "More
 * options" and "Sub-tasks" fold to one line each until tapped. The last task
 * type and priority used start the next task (forms/task-prefs.ts) — never
 * over what the screen was opened with or a template sets. Opened from a
 * client / lead (?relatedInvestorId= / ?relatedLeadId=, + ?name=) the record
 * is already picked, by name.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet, Switch, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { Segmented } from "../../components/ui/Segmented";
import { SearchBar } from "../../components/ui/SearchBar";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { DateField } from "../../components/form/DateField";
import { DueDateField } from "../../components/form/DueDateField";
import { CollapsibleSection } from "../../components/form/CollapsibleSection";
import { StickyActionBar } from "../../components/form/StickyActionBar";
import { istToIso, splitDue, timeLabel } from "../../components/form/due";
import { loadTaskPrefs, restoreTaskPrefs, saveTaskPrefs, type TaskPrefs } from "../forms/task-prefs";
import { api } from "../../api/client";
import { useMe } from "../../api/me";
import { toast } from "../../lib/toast";
import { useSearch } from "../search/api";
import { useTeam } from "../team/api";
import { useMeetings } from "../meetings/api";
import { useSchemeSearch, type SchemeHit } from "../proposals/api";
import {
  REQUEST_TYPE_BY_KEY, REDEMPTION_ROUTE_CHECKLISTS, FREQUENCIES, CATEGORY_LABEL, INSURANCE_TASKS_FLAG,
  requestTypesFor, rowFieldLabel, fieldLabel, categoryOfType,
  type TaskCategory, type RequestType,
} from "./request-types";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";

type Row = { key: number; schemeName: string; schemeCode?: string; amcName?: string; assetCategory?: string; fromSchemeName: string; fromSchemeCode?: string; amount: string; units: string; allUnits: boolean; folio: string; sipDay: string; frequency: string };
type Template = { id: string; name: string; description?: string | null; taskType?: string | null; priority?: string | null; dueOffsetDays?: number | null; subtasks?: Array<{ id: string; text: string }> };
/** A sub-task may have its own owner and date (the web's TaskChecklistItem). */
type CheckItem = { id: string; text: string; assigneeId?: string | null; actionDate?: string };

const KYC_MODES = [{ key: "online", label: "Online KYC" }, { key: "physical", label: "Physical KYC" }] as const;
const REMINDERS = [
  { value: "none", label: "No reminder" }, { value: "at_due", label: "At the due time" }, { value: "1h", label: "1 hour before" },
  { value: "3h", label: "3 hours before" }, { value: "1d", label: "1 day before" }, { value: "2d", label: "2 days before" }, { value: "1w", label: "1 week before" },
];
const REMIND_MIN: Record<string, number> = { at_due: 0, "1h": 60, "3h": 180, "1d": 1440, "2d": 2880, "1w": 10080 };
const PRIORITIES = [{ key: "low", label: "Low" }, { key: "normal", label: "Normal" }, { key: "high", label: "High" }, { key: "urgent", label: "Urgent" }];
const SIP_DAYS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
/** The web RequestPicker's CATEGORIES; Insurance only for a firm with the flag. */
const CATEGORIES: Array<{ key: TaskCategory; label: string }> = [
  { key: "general", label: "General" },
  { key: "financial", label: "Financial" },
  { key: "non_financial", label: "Non-financial" },
  { key: "insurance", label: "Insurance" },
];

let seq = 0;
const emptyRow = (): Row => ({ key: ++seq, schemeName: "", fromSchemeName: "", amount: "", units: "", allUnits: false, folio: "", sipDay: "", frequency: "monthly" });
const localDay = (days = 0) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** "24 Nov" for a "YYYY-MM-DD" day (a calendar day — no zone shift). */
const dayLabel = (day: string) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return isNaN(t) ? day : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
};
/** A due value as sent: a chip's / picked India time, else the web's `new Date(day)` (UTC midnight). */
const dueIso = (v: string) => (!v ? undefined : splitDue(v).time ? istToIso(v) : new Date(splitDue(v).day).toISOString());
const num = (v: string) => { if (!v.trim()) return null; const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function NewTaskScreen({ params }: { params: Record<string, string | undefined> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const meQ = useMe();
  const me = meQ.data;
  const team = useTeam();
  const [relatedMeetingId, setRelatedMeetingId] = useState("");
  // The web's "Related meeting": a recent meeting this task follows from.
  const recentMeetings = useMeetings({ sort: "meeting_desc" });
  const templates = useQuery({ queryKey: ["task-templates"], queryFn: () => api.get<{ templates: Template[] }>("/api/task-templates").then((r) => r.templates ?? []), staleTime: 5 * 60_000 });
  const redemptionRoute = me?.license?.featureFlags?.redemptionOnlineOffline === true;
  /** The firm's `insuranceTasks` flag: the Insurance category. */
  const insuranceTasks = me?.license?.featureFlags?.[INSURANCE_TASKS_FLAG] === true;

  const [templateId, setTemplateId] = useState("");
  // Opened from a client's / lead's page with its name (?name=): picked at once, no lookup.
  const [client, setClient] = useState<{ id: string; name: string } | null>(() => (params.relatedInvestorId && params.name ? { id: params.relatedInvestorId, name: params.name } : null));
  const [lead, setLead] = useState<{ id: string; name: string } | null>(() => (params.relatedLeadId && params.name && !params.relatedInvestorId ? { id: params.relatedLeadId, name: params.name } : null));
  const [pick, setPick] = useState<null | "client" | "lead">(null);
  // A title passed in (a client card's "Follow up with …") counts as typed, so a request never replaces it.
  const [title, setTitle] = useState(params.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!params.title);
  const [category, setCategory] = useState<TaskCategory>("general");
  const [requestKey, setRequestKey] = useState("");
  const [kind, setKind] = useState<"follow_up" | "custom">("follow_up");
  const [customType, setCustomType] = useState("");
  const [mode, setMode] = useState("");
  const [amount, setAmount] = useState("");
  const [folio, setFolio] = useState("");
  const [kycMode, setKycMode] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [entryDate, setEntryDate] = useState(localDay());
  const [dueDate, setDueDate] = useState(localDay(3));
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [priority, setPriority] = useState("normal");
  const [moreOpen, setMoreOpen] = useState(!!params.description);
  const [whenOpen, setWhenOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  // Remembered type / priority yield to anything the person (or a template) chose first.
  const typeTouched = useRef(false), prioTouched = useRef(false);
  const [prefs, setPrefs] = useState<TaskPrefs | null | undefined>(undefined);
  const restored = useRef(false);
  const [description, setDescription] = useState(params.description ?? "");
  const [reminder, setReminder] = useState("none");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [recurrence, setRecurrence] = useState("");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  /** The list a request put in — a request change may replace it; a template's or an empty one is filled. */
  const [autoList, setAutoList] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  // Two taps land before `busy` re-renders the button: one task, not two.
  const saving = useRef(false);

  // ?relatedInvestorId= / ?relatedLeadId= (from a client or lead page) — named by a lookup when no ?name= came.
  useEffect(() => {
    if (params.relatedInvestorId && !client) api.get<any>(`/api/investors/${params.relatedInvestorId}`).then(({ investor: i }) => i?.id && setClient({ id: i.id, name: i.name })).catch(() => {});
    if (params.relatedLeadId && !lead) api.get<any>(`/api/leads/${params.relatedLeadId}`).then((l) => l?.id && setLead({ id: l.id, name: l.name })).catch(() => {});
    loadTaskPrefs().then(setPrefs, () => setPrefs(null));
  }, []);

  const req: RequestType | undefined = category !== "general" && requestKey ? REQUEST_TYPE_BY_KEY[requestKey] : undefined;
  const routeOn = redemptionRoute && requestKey === "redemption";
  const hasF = (f: string) => !!req?.fields.includes(f as any);
  const hasR = (f: string) => !!req?.rowFields.includes(f as any);

  // The title a request suggests — "Redemption — Rajesh Patel" / "Online KYC — Rajesh Patel" — until the RM types one.
  const autoTitle = useMemo(() => {
    if (!req) return "";
    const label = req.key === "kyc_renewal" && kycMode ? KYC_MODES.find((m) => m.key === kycMode)?.label ?? req.label : req.label;
    return client ? `${label} — ${client.name}` : label;
  }, [req, kycMode, client]);
  // An untouched title follows the request — and empties when it goes (General).
  useEffect(() => { if (!titleTouched) setTitle(autoTitle); }, [autoTitle, titleTouched]);

  const seedChecklist = (texts: string[]) => { setChecklist(texts.map((text) => ({ id: newId(), text }))); setAutoList(true); };

  const changeCategory = (c: TaskCategory) => {
    if (c === category) return;
    setCategory(c); setRequestKey(""); setMode(""); setKycMode(""); setRows([emptyRow()]);
    if (autoList) { setChecklist([]); setAutoList(false); }
  };

  /** A request's checklist fills an empty list or replaces the previous request's — never a template's. */
  const changeRequest = (key: string) => {
    setRequestKey(key); setRows([emptyRow()]); setKycMode("");
    const routed = redemptionRoute && key === "redemption";
    if (routed) setMode("");
    if (checklist.length === 0 || autoList) {
      const r = REQUEST_TYPE_BY_KEY[key];
      if (r?.checklist.length && !routed) seedChecklist(r.checklist);
      else { setChecklist([]); setAutoList(false); }
    }
  };

  /** Mode; for a flagged firm's redemption it is the route, and its sub-tasks replace the auto list. */
  const changeMode = (m: string) => {
    setMode(m);
    if (routeOn && (m === "online" || m === "offline") && (checklist.length === 0 || autoList)) seedChecklist(REDEMPTION_ROUTE_CHECKLISTS[m]);
  };

  // The last type and priority used (this phone, this account) — once, after
  // the firm's flags are known, and only where nothing was chosen yet.
  useEffect(() => {
    if (restored.current || prefs === undefined || (!me && !meQ.isFetched)) return;
    restored.current = true;
    const r = restoreTaskPrefs(prefs, {
      prefilled: !!(params.title || params.description),
      insuranceAllowed: insuranceTasks,
      requestCategory: (k) => REQUEST_TYPE_BY_KEY[k]?.category ?? null,
    });
    if (templateId) return;
    if (r.priority && !prioTouched.current) setPriority(r.priority);
    if (!r.category || typeTouched.current) return;
    if (r.category !== "general" && r.requestKey) { setCategory(r.category); changeRequest(r.requestKey); }
    else if (r.kind === "custom" && r.customType) { setKind("custom"); setCustomType(r.customType); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, me, meQ.isFetched]);

  const applyTemplate = (id: string) => {
    typeTouched.current = true; prioTouched.current = true;
    const prev = templates.data?.find((x) => x.id === templateId);
    setTemplateId(id);
    const t = templates.data?.find((x) => x.id === id);
    if (!t) {
      // "No template": its sub-tasks go, and so does its title if nobody changed it.
      setChecklist([]); setAutoList(false);
      if (prev && title === prev.name) { setTitle(""); setTitleTouched(false); }
      return;
    }
    const cat = categoryOfType(t.taskType);
    if (t.taskType && cat !== "general") { setCategory(cat); setRequestKey(REQUEST_TYPE_BY_KEY[t.taskType] ? t.taskType : ""); }
    else if (t.taskType && t.taskType !== "follow_up") { setCategory("general"); setKind("custom"); setCustomType(t.taskType); }
    if (!titleTouched || !title.trim() || (prev && title === prev.name)) { setTitle(t.name); setTitleTouched(true); }
    if (t.description && !description.trim()) { setDescription(t.description); setMoreOpen(true); }
    if (t.priority && PRIORITIES.some((p) => p.key === t.priority)) setPriority(t.priority);
    if (t.dueOffsetDays != null) setDueDate(localDay(t.dueOffsetDays));
    // The template's own sub-tasks win (web applyTemplate).
    setChecklist((t.subtasks ?? []).map((st) => ({ id: st.id || newId(), text: st.text })));
    setAutoList(false);
  };

  const setRow = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const save = async () => {
    if (saving.current) return;
    if (title.trim().length < 2) return toast.error("Say what needs doing.");
    if (category === "general" && kind === "custom" && !customType.trim()) return toast.error("Name the kind of task.");
    if (category !== "general") {
      if (!req) return toast.error(`Pick the ${CATEGORY_LABEL[category].toLowerCase()} request.`);
      if (!client) return toast.error("Pick the client this request is for.");
    }
    if (routeOn && !mode) return toast.error("Choose Online or Offline for the redemption.");
    if (requestKey === "kyc_renewal" && !kycMode) return toast.error("Choose Online KYC or Physical KYC.");
    if (hasF("amount") && amount.trim() && num(amount) == null) return toast.error("Enter the amount as a number, e.g. 500000.");
    const usedRows = req?.rowFields.length ? rows.filter((r, i, all) => r.schemeName.trim() || r.amount.trim() || i < all.length - 1) : [];
    if (req?.rowFields.length) {
      if (!usedRows.length) return toast.error("Add at least one scheme.");
      for (const [i, r] of usedRows.entries()) {
        if (!r.schemeName.trim()) return toast.error(`Scheme ${i + 1}: pick the scheme.`);
        if (hasR("fromScheme") && !r.fromSchemeName.trim()) return toast.error(`Scheme ${i + 1}: pick the scheme it moves from.`);
        if ((r.amount.trim() && num(r.amount) == null) || (r.units.trim() && !r.allUnits && num(r.units) == null)) return toast.error(`Scheme ${i + 1}: enter amounts and units as numbers.`);
      }
    }

    const dueAt = dueIso(dueDate);
    const payload: Record<string, any> = {
      title: title.trim(),
      description: description.trim() || undefined,
      type: req ? req.key : kind === "custom" ? customType.trim() : "follow_up",
      priority,
      entryDate: entryDate || undefined,
      dueAt,
      assigneeId: assigneeId || undefined,
      requiresApproval: requiresApproval || undefined,
    };
    if (reminder !== "none" && dueAt) payload.remindAt = new Date(Date.parse(dueAt) - (REMIND_MIN[reminder] ?? 0) * 60000).toISOString();
    const items = checklist
      .map((c) => ({
        id: c.id.slice(0, 64), text: c.text.trim(), done: false,
        ...(c.assigneeId ? { assigneeId: c.assigneeId } : {}),
        ...(c.actionDate ? { actionDate: c.actionDate } : {}),
      }))
      .filter((c) => c.text);
    if (items.length) payload.checklist = items;
    if (templateId) payload.templateId = templateId;
    if (recurrence) { payload.recurrence = recurrence; if (recurrenceUntil) payload.recurrenceUntil = recurrenceUntil; }
    if (req) {
      const total = usedRows.reduce((t, r) => t + (num(r.amount) ?? 0), 0);
      if (hasF("amount") && num(amount) != null) payload.boValue = num(amount);
      else if (total > 0) payload.boValue = total;
      if (hasF("mode") && mode) payload.boChannel = mode;
      payload.request = {
        ...(req.key === "kyc_renewal" && kycMode ? { kycMode } : {}),
        ...(hasF("folio") && folio.trim() ? { folio: folio.trim() } : {}),
        ...(usedRows.length ? {
          rows: usedRows.map((r) => ({
            schemeName: r.schemeName.trim(),
            ...(r.schemeCode ? { schemeCode: r.schemeCode } : {}),
            ...(r.amcName ? { amcName: r.amcName } : {}),
            ...(r.assetCategory ? { assetCategory: r.assetCategory } : {}),
            ...(hasR("fromScheme") ? { fromSchemeName: r.fromSchemeName.trim(), ...(r.fromSchemeCode ? { fromSchemeCode: r.fromSchemeCode } : {}) } : {}),
            ...(hasR("amount") && num(r.amount) != null ? { amount: num(r.amount)! } : {}),
            ...(hasR("units") && r.allUnits ? { allUnits: true } : {}),
            ...(hasR("units") && !r.allUnits && num(r.units) != null ? { units: num(r.units)! } : {}),
            ...(hasR("folio") && r.folio.trim() ? { folio: r.folio.trim() } : {}),
            ...(hasR("sipDay") && r.sipDay ? { sipDay: r.sipDay } : {}),
            ...(hasR("frequency") && r.frequency ? { frequency: r.frequency } : {}),
          })),
        } : {}),
      };
    }
    if (client) payload.relatedInvestorId = client.id;
    if (lead) payload.relatedLeadId = lead.id;
    if (relatedMeetingId) payload.relatedMeetingId = relatedMeetingId;

    saving.current = true;
    setBusy(true);
    try {
      const j = await api.post<{ id: string; businessEntryId?: string | null; businessNotBooked?: string }>("/api/tasks", payload);
      if (j.businessEntryId) toast.success("Task created — booked in Business entries as a draft, confirmed when the task is completed.");
      else if (j.businessNotBooked === "not_allowed") toast.info("Task created, but your role cannot book Business entries — ask Operations to add it.");
      else toast.success("Task created");
      void saveTaskPrefs({ type: payload.type, priority });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task-kpis"] });
      router.back();
    } catch (e: any) {
      toast.error(e?.body?.error ?? e?.message ?? "Couldn't create the task");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const people = (team.data?.rows ?? []).filter((u) => (u.status ?? "active") === "active").map((u) => ({ value: u.id, label: u.id === me?.user?.id ? `${u.name} (me)` : u.name ?? "—" }));

  // The folded blocks' one-liners.
  const due = splitDue(dueDate);
  const whenSummary = [
    due.day ? `Due ${dayLabel(due.day)}${due.time ? ` ${timeLabel(due.time)}` : ""}` : "No due date",
    assigneeId ? people.find((p) => p.value === assigneeId)?.label ?? "Assigned" : "Me",
    PRIORITIES.find((p) => p.key === priority)?.label ?? priority,
  ].join(" · ");
  const moreSummary = [
    description.trim() ? "Description" : null,
    reminder !== "none" ? REMINDERS.find((r) => r.value === reminder)?.label : null,
    requiresApproval ? "Needs approval" : null,
    recurrence ? `Repeats ${recurrence}` : null,
    lead ? `Lead: ${lead.name}` : null,
    relatedMeetingId ? "Meeting linked" : null,
  ].filter(Boolean).join(" · ") || "Optional";
  const subSummary = checklist.length ? `${checklist.length} sub-task${checklist.length === 1 ? "" : "s"}` : "None";

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="New task" />
      {/* The Create bar sits inside the keyboard-avoiding view, so it rides above the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        {(templates.data ?? []).length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
            {templates.data!.map((t) => (
              <Pressable key={t.id} onPress={() => applyTemplate(templateId === t.id ? "" : t.id)} style={[styles.chip, templateId === t.id && styles.chipOn]} accessibilityRole="button">
                <Text variant="caption" style={{ color: templateId === t.id ? palette.white : palette.ink, fontWeight: fontWeight.semibold }}>{t.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <CollapsibleSection open collapsible={false}>
          <Pick label={category === "general" ? "For client (optional)" : "For client"} value={client?.name} onPress={() => setPick("client")} onClear={client ? () => setClient(null) : undefined} />
          <TextField label="What needs doing" required value={title} onChangeText={(v) => { setTitle(v); setTitleTouched(true); }} />

          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Type of task</Text>
          <CategoryPicker
            options={CATEGORIES.filter((c) => c.key !== "insurance" || insuranceTasks || category === "insurance")}
            value={category}
            onChange={(c) => { typeTouched.current = true; changeCategory(c); }}
          />
          <View style={{ height: spacing.md }} />

          {category !== "general" ? (
            <>
              <SelectField label={`${CATEGORY_LABEL[category]} request`} required value={requestKey || null} placeholder="Pick the request" options={requestTypesFor(category).map((r) => ({ value: r.key, label: r.label }))}
                onChange={(k) => { typeTouched.current = true; changeRequest(k); }} />
              {requestKey === "kyc_renewal" ? <Segmented options={KYC_MODES.map((m) => ({ key: m.key, label: m.label }))} value={kycMode} onChange={setKycMode} /> : null}
              {hasF("mode") ? (
                <SelectField label={routeOn ? "Online or offline" : fieldLabel("mode", req)} required={routeOn} value={mode || null} placeholder="Select"
                  options={[{ value: "online", label: "Online" }, { value: "offline", label: "Offline" }]} onChange={changeMode} />
              ) : null}
              {hasF("amount") ? <TextField label={fieldLabel("amount", req)} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /> : null}
              {hasF("folio") ? <TextField label={fieldLabel("folio", req)} placeholder={fieldLabel("folio", req)} value={folio} onChangeText={(v) => setFolio(v.slice(0, 60))} autoCapitalize="characters" /> : null}
              {req?.rowFields.length ? rows.map((r, i) => (
                <SchemeRow key={r.key} index={i} row={r} req={req} onChange={(p) => setRow(r.key, p)} onRemove={rows.length > 1 ? () => setRows((rs) => rs.filter((x) => x.key !== r.key)) : undefined} />
              )) : null}
              {req?.rowFields.length ? <Button label="Add another scheme" size="sm" variant="secondary" onPress={() => setRows((rs) => [...rs, emptyRow()])} /> : null}
            </>
          ) : (
            <>
              <Segmented options={[{ key: "follow_up", label: "Follow-up" }, { key: "custom", label: "Custom" }]} value={kind} onChange={(v) => { typeTouched.current = true; setKind(v as any); }} />
              {kind === "custom" ? <View style={{ marginTop: spacing.md }}><TextField label="Kind of task" value={customType} onChangeText={(v) => { typeTouched.current = true; setCustomType(v); }} placeholder="e.g. Portfolio rebalance" /></View> : null}
            </>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="When & who" open={whenOpen} onToggle={() => setWhenOpen((v) => !v)} summary={whenSummary}>
          <DateField label="Entry date" value={entryDate} onChange={setEntryDate} />
          <DueDateField label="Due" value={dueDate} onChange={setDueDate} extraChips={[{ label: "3 days", days: 3 }, { label: "1 week", days: 7 }]} />
          <SelectField label="Assign to" value={assigneeId} placeholder="Me" options={people} onChange={setAssigneeId} />
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Priority</Text>
          <Segmented options={PRIORITIES} value={priority} onChange={(v) => { prioTouched.current = true; setPriority(v); }} />
        </CollapsibleSection>

        <CollapsibleSection title="More options" open={moreOpen} onToggle={() => setMoreOpen((v) => !v)} summary={moreSummary}>
          <TextField label="Description" value={description} onChangeText={setDescription} multiline />
          <SelectField label="Reminder" value={reminder} options={REMINDERS} onChange={setReminder} />
          <View style={styles.switchRow}>
            <Text variant="body" style={{ flex: 1 }}>Needs my approval</Text>
            <Switch value={requiresApproval} onValueChange={setRequiresApproval} trackColor={{ true: palette.brand, false: palette.line }} />
          </View>
          <SelectField label="Repeat" value={recurrence || null} placeholder="Doesn't repeat"
            options={[{ value: "", label: "Doesn't repeat" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "yearly", label: "Yearly" }]} onChange={setRecurrence} />
          {recurrence ? <DateField label="Until (optional)" value={recurrenceUntil} onChange={setRecurrenceUntil} /> : null}
          <Pick label="Also link to a lead" value={lead?.name} onPress={() => setPick("lead")} onClear={lead ? () => setLead(null) : undefined} />
          <SelectField
            label="Related meeting"
            value={relatedMeetingId || null}
            placeholder="Pick a recent meeting (optional)"
            options={[
              ...(relatedMeetingId ? [{ value: "", label: "No meeting" }] : []),
              ...(recentMeetings.data?.meetings ?? []).slice(0, 50).map((m) => ({
                value: m.id,
                label: `${m.meeting_date ? new Date(m.meeting_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"} — ${m.investor_name ?? m.subject_name ?? "—"}${m.category ? ` · ${String(m.category).replace(/_/g, " ")}` : ""}`,
              })),
            ]}
            onChange={setRelatedMeetingId}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Sub-tasks" open={subOpen} onToggle={() => setSubOpen((v) => !v)} summary={subSummary}>
          {checklist.map((c) => (
            <View key={c.id} style={styles.subtask}>
              <View style={styles.item}>
                <Feather name="circle" size={14} color={palette.faint} />
                <Text variant="body" style={{ flex: 1 }}>{c.text}</Text>
                <Pressable onPress={() => setChecklist((l) => l.filter((x) => x.id !== c.id))} hitSlop={8} accessibilityLabel={`Remove ${c.text}`}><Feather name="x" size={15} color={palette.faint} /></Pressable>
              </View>
              {/* Each sub-task may go to someone else, by its own date (the web's row). */}
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <SelectField label="Assign to" value={c.assigneeId ?? null} placeholder="Task's assignee"
                    options={[...(c.assigneeId ? [{ value: "", label: "Task's assignee" }] : []), ...people]}
                    onChange={(v) => setChecklist((l) => l.map((x) => (x.id === c.id ? { ...x, assigneeId: v || null } : x)))} />
                </View>
                <View style={{ flex: 1 }}>
                  <DateField label="Due date" value={c.actionDate ?? ""} onChange={(v) => setChecklist((l) => l.map((x) => (x.id === c.id ? { ...x, actionDate: v } : x)))} />
                </View>
              </View>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}><TextField label="" value={newItem} onChangeText={setNewItem} placeholder="Add a sub-task…" /></View>
            <Button label="Add" size="sm" variant="secondary" onPress={() => { if (newItem.trim()) { setChecklist((l) => [...l, { id: newId(), text: newItem.trim().slice(0, 500) }]); setNewItem(""); } }} />
          </View>
        </CollapsibleSection>
      </ScrollView>
      <StickyActionBar><Button label="Create task" full loading={busy} onPress={save} /></StickyActionBar>
      </KeyboardAvoidingView>
      {pick ? <RecordPicker kind={pick} onClose={() => setPick(null)} onPick={(r) => { pick === "client" ? setClient(r) : setLead(r); setPick(null); }} /> : null}
    </View>
  );
}

/** Type of task — the web's segmented control, wrapping to two rows when Insurance makes four. */
function CategoryPicker({ options, value, onChange }: { options: Array<{ key: TaskCategory; label: string }>; value: TaskCategory; onChange: (c: TaskCategory) => void }) {
  return (
    <View style={styles.catWrap} accessibilityRole="radiogroup" accessibilityLabel="Type of task">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="radio" accessibilityState={{ checked: on }}
            style={[styles.catItem, { minWidth: options.length > 3 ? "47%" : "30%" }, on && styles.catOn]}>
            <Text variant="label" style={{ color: on ? palette.ink : palette.muted }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Pick({ label, value, onPress, onClear }: { label: string; value?: string | null; onPress: () => void; onClear?: () => void }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
        <Pressable onPress={onPress} style={styles.pickBox} accessibilityRole="button">
          <Feather name="search" size={15} color={palette.faint} />
          <Text style={{ flex: 1, color: value ? palette.ink : palette.faint }} numberOfLines={1}>{value || "Search…"}</Text>
        </Pressable>
        {onClear ? <Pressable onPress={onClear} hitSlop={8} accessibilityLabel="Clear"><Feather name="x" size={18} color={palette.muted} /></Pressable> : null}
      </View>
    </View>
  );
}

function RecordPicker({ kind, onClose, onPick }: { kind: "client" | "lead"; onClose: () => void; onPick: (r: { id: string; name: string }) => void }) {
  const [q, setQ] = useState("");
  const s = useSearch(q);
  const rows: any[] = (kind === "client" ? s.data?.investors : s.data?.leads) ?? [];
  return (
    <BottomSheet visible onClose={onClose} title={kind === "client" ? "Pick the client" : "Pick the lead"}>
      <SearchBar value={q} onChangeText={setQ} placeholder={kind === "client" ? "Search clients…" : "Search leads…"} />
      <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {rows.map((r) => (
          <Pressable key={r.id} style={styles.item} onPress={() => onPick({ id: r.id, name: r.name })}>
            <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{r.name}</Text><Text variant="caption" tone="muted" numberOfLines={1}>{[r.pan_display, r.phone].filter(Boolean).join(" · ")}</Text></View>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

/** One scheme row; catalog requests pick from the Scheme Master, PMS / AIF type the name. */
function SchemeRow({ index, row, req, onChange, onRemove }: { index: number; row: Row; req: RequestType; onChange: (p: Partial<Row>) => void; onRemove?: () => void }) {
  const [picking, setPicking] = useState<null | "scheme" | "fromScheme">(null);
  const has = (f: string) => req.rowFields.includes(f as any);
  const catalog = req.catalog !== false;
  return (
    <View style={styles.rowBox}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.xs }}>
        <Text variant="label" tone="muted" style={{ flex: 1 }}>SCHEME {index + 1}</Text>
        {onRemove ? <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel="Remove scheme"><Feather name="trash-2" size={15} color={palette.danger} /></Pressable> : null}
      </View>
      {has("fromScheme") ? <Pick label={rowFieldLabel("fromScheme", req)} value={row.fromSchemeName} onPress={() => setPicking("fromScheme")} /> : null}
      {catalog
        ? <Pick label={rowFieldLabel("scheme", req)} value={row.schemeName} onPress={() => setPicking("scheme")} />
        : <TextField label={rowFieldLabel("scheme", req)} value={row.schemeName} onChangeText={(v) => onChange({ schemeName: v.slice(0, 250) })} />}
      {has("amount") ? <TextField label={rowFieldLabel("amount", req)} value={row.amount} onChangeText={(v) => onChange({ amount: v })} keyboardType="numeric" /> : null}
      {has("units") ? (
        <>
          <View style={styles.switchRow}>
            <Text variant="body" style={{ flex: 1 }}>All units</Text>
            <Switch value={row.allUnits} onValueChange={(v) => onChange({ allUnits: v })} trackColor={{ true: palette.brand, false: palette.line }} />
          </View>
          {!row.allUnits ? <TextField label={rowFieldLabel("units", req)} value={row.units} onChangeText={(v) => onChange({ units: v })} keyboardType="numeric" /> : null}
        </>
      ) : null}
      {has("sipDay") ? <SelectField label={rowFieldLabel("sipDay", req)} value={row.sipDay || null} placeholder="Day" options={SIP_DAYS} onChange={(v) => onChange({ sipDay: v })} /> : null}
      {has("frequency") ? <SelectField label="Frequency" value={row.frequency} options={FREQUENCIES.map(([value, label]) => ({ value, label }))} onChange={(v) => onChange({ frequency: v })} /> : null}
      {has("folio") ? <TextField label="Folio" value={row.folio} onChangeText={(v) => onChange({ folio: v.slice(0, 60) })} autoCapitalize="characters" /> : null}
      {picking ? (
        <SchemePicker onClose={() => setPicking(null)} onPick={(s) => {
          onChange(picking === "fromScheme"
            ? { fromSchemeName: s.schemeName, fromSchemeCode: s.schemeCode }
            : { schemeName: s.schemeName, schemeCode: s.schemeCode, amcName: s.amc ?? undefined, assetCategory: s.category ?? undefined });
          setPicking(null);
        }} />
      ) : null}
    </View>
  );
}

function SchemePicker({ onClose, onPick }: { onClose: () => void; onPick: (s: SchemeHit) => void }) {
  const [q, setQ] = useState("");
  const res = useSchemeSearch(q, null, { regularOnly: false });
  return (
    <BottomSheet visible onClose={onClose} title="Pick a scheme">
      {res.data?.masterEmpty ? <Text variant="caption" style={{ color: palette.warning, marginBottom: spacing.sm }}>The firm's Scheme Master is empty — sync it in the CRM first.</Text> : null}
      <SearchBar value={q} onChangeText={setQ} placeholder="Search the Scheme Master…" />
      <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {(res.data?.schemes ?? []).map((s) => (
          <Pressable key={s.schemeCode} style={styles.item} onPress={() => onPick(s)}>
            <View style={{ flex: 1 }}><Text variant="body" numberOfLines={2}>{s.schemeName}</Text><Text variant="caption" tone="muted" numberOfLines={1}>{[s.amc, s.category].filter(Boolean).join(" · ")}</Text></View>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subtask: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minHeight: 40 },
  pickBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 46, backgroundColor: palette.surface },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  rowBox: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, backgroundColor: palette.surface },
  catWrap: { flexDirection: "row", flexWrap: "wrap", gap: 3, backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: 3 },
  catItem: { flexGrow: 1, flexBasis: 0, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm },
  catOn: { backgroundColor: palette.surface, shadowColor: palette.shadow, shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});
