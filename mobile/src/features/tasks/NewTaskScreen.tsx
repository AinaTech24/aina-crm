/**
 * New task — the live CRM's New task form (web /dashboard/tasks/new), in its
 * order: template → For client → What needs doing → Type of task (General /
 * Financial / Non-financial → the request) → entry date, due, assign to →
 * priority → More options.
 *
 * A financial or non-financial request is one of request-types.ts (copied
 * from the CRM): it asks for the client, its own fields (mode, amount, folio,
 * Online / Physical KYC) and, for most financial requests, one or more scheme
 * ROWS whose schemes are picked from the firm's Scheme Master (PMS / AIF are
 * typed). The task starts with the request's checklist (ending in "RTA data
 * check"); the server books the draft Business entry and says so.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet, Switch, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { Segmented } from "../../components/ui/Segmented";
import { SearchBar } from "../../components/ui/SearchBar";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { DateField } from "../../components/form/DateField";
import { api } from "../../api/client";
import { useMe } from "../../api/me";
import { toast } from "../../lib/toast";
import { useSearch } from "../search/api";
import { useTeam } from "../team/api";
import { useSchemeSearch, type SchemeHit } from "../proposals/api";
import {
  REQUEST_TYPE_BY_KEY, REDEMPTION_ROUTE_CHECKLISTS, FREQUENCIES, requestTypesFor, rowFieldLabel, categoryOfType,
  type TaskCategory, type RequestType,
} from "./request-types";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";

type Row = { key: number; schemeName: string; schemeCode?: string; amcName?: string; assetCategory?: string; fromSchemeName: string; fromSchemeCode?: string; amount: string; units: string; allUnits: boolean; folio: string; sipDay: string; frequency: string };
type Template = { id: string; name: string; description?: string | null; taskType?: string | null; priority?: string | null; dueOffsetDays?: number | null; subtasks?: Array<{ id: string; text: string }> };
type CheckItem = { id: string; text: string };

const KYC_MODES = [{ key: "online", label: "Online KYC" }, { key: "physical", label: "Physical KYC" }] as const;
const REMINDERS = [
  { value: "none", label: "No reminder" }, { value: "at_due", label: "At the due time" }, { value: "1h", label: "1 hour before" },
  { value: "3h", label: "3 hours before" }, { value: "1d", label: "1 day before" }, { value: "2d", label: "2 days before" }, { value: "1w", label: "1 week before" },
];
const REMIND_MIN: Record<string, number> = { at_due: 0, "1h": 60, "3h": 180, "1d": 1440, "2d": 2880, "1w": 10080 };
const PRIORITIES = [{ key: "low", label: "Low" }, { key: "normal", label: "Normal" }, { key: "high", label: "High" }, { key: "urgent", label: "Urgent" }];
const SIP_DAYS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

let seq = 0;
const emptyRow = (): Row => ({ key: ++seq, schemeName: "", fromSchemeName: "", amount: "", units: "", allUnits: false, folio: "", sipDay: "", frequency: "monthly" });
const localDay = (days = 0) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const num = (v: string) => { if (!v.trim()) return null; const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function NewTaskScreen({ params }: { params: Record<string, string | undefined> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const team = useTeam();
  const templates = useQuery({ queryKey: ["task-templates"], queryFn: () => api.get<{ templates: Template[] }>("/api/task-templates").then((r) => r.templates ?? []), staleTime: 5 * 60_000 });
  const redemptionRoute = me?.license?.featureFlags?.redemptionOnlineOffline === true;

  const [templateId, setTemplateId] = useState("");
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [lead, setLead] = useState<{ id: string; name: string } | null>(null);
  const [pick, setPick] = useState<null | "client" | "lead">(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [reminder, setReminder] = useState("none");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [recurrence, setRecurrence] = useState("");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  const [templateChecklist, setTemplateChecklist] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);

  // ?relatedInvestorId= / ?relatedLeadId= (from a client or lead page).
  useEffect(() => {
    if (params.relatedInvestorId) api.get<any>(`/api/investors/${params.relatedInvestorId}`).then(({ investor: i }) => i?.id && setClient({ id: i.id, name: i.name })).catch(() => {});
    if (params.relatedLeadId) api.get<any>(`/api/leads/${params.relatedLeadId}`).then((l) => l?.id && setLead({ id: l.id, name: l.name })).catch(() => {});
    if (params.title) { setTitle(params.title); setTitleTouched(true); }
    if (params.description) setDescription(params.description);
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
  useEffect(() => { if (!titleTouched && autoTitle) setTitle(autoTitle); }, [autoTitle, titleTouched]);

  // The request's checklist (a template's own sub-tasks win).
  useEffect(() => {
    if (templateChecklist) return;
    if (!req) { setChecklist([]); return; }
    const list = routeOn && (mode === "online" || mode === "offline") ? REDEMPTION_ROUTE_CHECKLISTS[mode] : req.checklist;
    setChecklist(list.map((text) => ({ id: newId(), text })));
  }, [req?.key, routeOn, mode, templateChecklist]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.data?.find((x) => x.id === id);
    if (!t) { setTemplateChecklist(false); return; }
    const cat = categoryOfType(t.taskType);
    if (t.taskType && cat !== "general") { setCategory(cat); setRequestKey(REQUEST_TYPE_BY_KEY[t.taskType] ? t.taskType : ""); }
    else if (t.taskType && t.taskType !== "follow_up") { setCategory("general"); setKind("custom"); setCustomType(t.taskType); }
    if (!titleTouched || !title.trim()) { setTitle(t.name); setTitleTouched(true); }
    if (t.description && !description.trim()) { setDescription(t.description); setMoreOpen(true); }
    if (t.priority && PRIORITIES.some((p) => p.key === t.priority)) setPriority(t.priority);
    if (t.dueOffsetDays != null) setDueDate(localDay(t.dueOffsetDays));
    if (t.subtasks?.length) { setTemplateChecklist(true); setChecklist(t.subtasks.map((s) => ({ id: s.id || newId(), text: s.text }))); }
  };

  const setRow = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const save = async () => {
    if (!title.trim()) return toast.error("Say what needs doing.");
    if (category === "general" && kind === "custom" && !customType.trim()) return toast.error("Name the kind of task.");
    if (category !== "general") {
      if (!req) return toast.error(`Pick the ${category === "financial" ? "financial" : "non-financial"} request.`);
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

    const payload: Record<string, any> = {
      title: title.trim(),
      description: description.trim() || undefined,
      type: req ? req.key : kind === "custom" ? customType.trim() : "follow_up",
      priority,
      entryDate: entryDate || undefined,
      dueAt: dueDate ? new Date(dueDate).toISOString() : undefined,
      assigneeId: assigneeId || undefined,
      requiresApproval: requiresApproval || undefined,
    };
    if (reminder !== "none" && dueDate) payload.remindAt = new Date(new Date(dueDate).getTime() - (REMIND_MIN[reminder] ?? 0) * 60000).toISOString();
    const items = checklist.map((c) => ({ id: c.id.slice(0, 64), text: c.text.trim(), done: false })).filter((c) => c.text);
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

    setBusy(true);
    try {
      const j = await api.post<{ id: string; businessEntryId?: string | null; businessNotBooked?: string }>("/api/tasks", payload);
      if (j.businessEntryId) toast.success("Task created — booked in Business entries as a draft, confirmed when the task is completed.");
      else if (j.businessNotBooked === "not_allowed") toast.info("Task created, but your role cannot book Business entries — ask Operations to add it.");
      else toast.success("Task created");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task-kpis"] });
      router.back();
    } catch (e: any) {
      toast.error(e?.body?.error ?? e?.message ?? "Couldn't create the task");
    } finally {
      setBusy(false);
    }
  };

  const people = (team.data?.rows ?? []).filter((u) => (u.status ?? "active") === "active").map((u) => ({ value: u.id, label: u.id === me?.user?.id ? `${u.name} (me)` : u.name ?? "—" }));

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="New task" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {(templates.data ?? []).length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
            {templates.data!.map((t) => (
              <Pressable key={t.id} onPress={() => applyTemplate(templateId === t.id ? "" : t.id)} style={[styles.chip, templateId === t.id && styles.chipOn]} accessibilityRole="button">
                <Text variant="caption" style={{ color: templateId === t.id ? palette.white : palette.ink, fontWeight: fontWeight.semibold }}>{t.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <Card flat>
          <Pick label={category === "general" ? "For client (optional)" : "For client"} value={client?.name} onPress={() => setPick("client")} onClear={client ? () => setClient(null) : undefined} />
          <TextField label="What needs doing" required value={title} onChangeText={(v) => { setTitle(v); setTitleTouched(true); }} />

          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Type of task</Text>
          <Segmented options={[{ key: "general", label: "General" }, { key: "financial", label: "Financial" }, { key: "non_financial", label: "Non-financial" }]} value={category}
            onChange={(v) => { setCategory(v as TaskCategory); setRequestKey(""); setMode(""); setKycMode(""); setRows([emptyRow()]); setTemplateChecklist(false); }} />
          <View style={{ height: spacing.md }} />

          {category !== "general" ? (
            <>
              <SelectField label="Request" required value={requestKey || null} placeholder="Pick the request" options={requestTypesFor(category).map((r) => ({ value: r.key, label: r.label }))}
                onChange={(v) => { setRequestKey(v); setRows([emptyRow()]); setMode(""); setKycMode(""); }} />
              {requestKey === "kyc_renewal" ? <Segmented options={KYC_MODES.map((m) => ({ key: m.key, label: m.label }))} value={kycMode} onChange={setKycMode} /> : null}
              {hasF("mode") ? (
                <SelectField label={routeOn ? "Online or offline" : "Mode"} required={routeOn} value={mode || null} placeholder="Select"
                  options={[{ value: "online", label: "Online" }, { value: "offline", label: "Offline" }]} onChange={setMode} />
              ) : null}
              {hasF("amount") ? <TextField label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" /> : null}
              {hasF("folio") ? <TextField label="Folio number" value={folio} onChangeText={setFolio} /> : null}
              {req?.rowFields.length ? rows.map((r, i) => (
                <SchemeRow key={r.key} index={i} row={r} req={req} onChange={(p) => setRow(r.key, p)} onRemove={rows.length > 1 ? () => setRows((rs) => rs.filter((x) => x.key !== r.key)) : undefined} />
              )) : null}
              {req?.rowFields.length ? <Button label="Add another scheme" size="sm" variant="secondary" onPress={() => setRows((rs) => [...rs, emptyRow()])} /> : null}
            </>
          ) : (
            <>
              <Segmented options={[{ key: "follow_up", label: "Follow-up" }, { key: "custom", label: "Custom" }]} value={kind} onChange={(v) => setKind(v as any)} />
              {kind === "custom" ? <View style={{ marginTop: spacing.md }}><TextField label="Kind of task" value={customType} onChangeText={setCustomType} placeholder="e.g. Portfolio rebalance" /></View> : null}
            </>
          )}
        </Card>

        <Card flat style={{ marginTop: spacing.md }}>
          <DateField label="Entry date" value={entryDate} onChange={setEntryDate} />
          <DateField label="Due" value={dueDate} onChange={setDueDate} />
          <View style={styles.chips}>
            {[{ l: "Today", d: 0 }, { l: "Tomorrow", d: 1 }, { l: "3 days", d: 3 }, { l: "1 week", d: 7 }].map((c) => (
              <Pressable key={c.l} onPress={() => setDueDate(localDay(c.d))} style={[styles.chip, dueDate === localDay(c.d) && styles.chipOn]}>
                <Text variant="caption" style={{ color: dueDate === localDay(c.d) ? palette.white : palette.ink }}>{c.l}</Text>
              </Pressable>
            ))}
          </View>
          <SelectField label="Assign to" value={assigneeId} placeholder="Me" options={people} onChange={setAssigneeId} />
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Priority</Text>
          <Segmented options={PRIORITIES} value={priority} onChange={setPriority} />
        </Card>

        <Pressable onPress={() => setMoreOpen((v) => !v)} style={styles.more} accessibilityRole="button">
          <Feather name={moreOpen ? "chevron-up" : "chevron-down"} size={16} color={palette.brand} />
          <Text style={{ color: palette.brand, fontWeight: fontWeight.semibold }}>More options</Text>
        </Pressable>
        {moreOpen ? (
          <Card flat>
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
          </Card>
        ) : null}

        <Card flat style={{ marginTop: spacing.md }}>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Sub-tasks</Text>
          {checklist.map((c) => (
            <View key={c.id} style={styles.item}>
              <Feather name="circle" size={14} color={palette.faint} />
              <Text variant="body" style={{ flex: 1 }}>{c.text}</Text>
              <Pressable onPress={() => setChecklist((l) => l.filter((x) => x.id !== c.id))} hitSlop={8} accessibilityLabel={`Remove ${c.text}`}><Feather name="x" size={15} color={palette.faint} /></Pressable>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}><TextField label="" value={newItem} onChangeText={setNewItem} placeholder="Add a sub-task…" /></View>
            <Button label="Add" size="sm" variant="secondary" onPress={() => { if (newItem.trim()) { setChecklist((l) => [...l, { id: newId(), text: newItem.trim() }]); setNewItem(""); } }} />
          </View>
        </Card>
      </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}><Button label="Create task" full loading={busy} onPress={save} /></View>
      {pick ? <RecordPicker kind={pick} onClose={() => setPick(null)} onPick={(r) => { pick === "client" ? setClient(r) : setLead(r); setPick(null); }} /> : null}
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
        : <TextField label={rowFieldLabel("scheme", req)} value={row.schemeName} onChangeText={(v) => onChange({ schemeName: v })} />}
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
      {has("folio") ? <TextField label="Folio" value={row.folio} onChangeText={(v) => onChange({ folio: v })} /> : null}
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg, marginTop: -spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  more: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.md, minHeight: 44 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minHeight: 40 },
  pickBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 46, backgroundColor: palette.surface },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  rowBox: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, backgroundColor: palette.surface },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: palette.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
});
