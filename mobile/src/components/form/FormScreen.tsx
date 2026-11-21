/**
 * FormScreen — renders a FormSpec as a native create/edit form: grouped
 * sections, per-field validation, a sticky action bar, and the exact same POST
 * payload the web CRM sends. One generic screen drives every module's form.
 *
 * Supports two shapes:
 *   - single-page (spec.sections) — everything on one scroll
 *   - wizard (spec.steps) — a stepper with Back/Next; submit on the last step
 *
 * A long form folds its sections (./sections.ts): the first one and any where
 * something is missing open, the rest show "3 of 5 filled". A failed check —
 * the form's own or the server's field errors — opens the section, scrolls to
 * the first field with an error and focuses it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView, KeyboardAvoidingView, StyleSheet, type TextInput } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { BottomSheet } from "../ui/BottomSheet";
import { LoadingState, ErrorState } from "../states";
import { FieldRenderer } from "./FieldRenderer";
import { CollapsibleSection } from "./CollapsibleSection";
import { StickyActionBar } from "./StickyActionBar";
import { firstErrorKey, isLongForm, openAtFirstSight, sectionSummary, serverFieldErrors, shownSections } from "./sections";
import { api, ApiError } from "../../api/client";
import { useFormDraft } from "../../lib/useFormDraft";
import { useConnectivity } from "../../state/connectivity";
import { queuedPost } from "../../lib/offlineQueue";
import { palette, spacing } from "../../theme/tokens";
import { fmtDateTime } from "../../lib/format";
import type { FormSpec, FormValues, SectionSpec } from "../../features/forms/types";

export function FormScreen({ spec }: { spec: FormSpec }) {
  const router = useRouter();
  const qc = useQueryClient();
  const rawParams = useLocalSearchParams();
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams)) p[k] = Array.isArray(v) ? v[0] : String(v ?? "");
    return p;
  }, [rawParams]);

  // Normalize to a list of steps. Single-page specs become one implicit step.
  const steps = useMemo(
    () => spec.steps ?? [{ title: spec.title, sections: spec.sections ?? [] }],
    [spec]
  );
  const isWizard = !!spec.steps;

  // Edit mode: ?editId=<id> + spec.editInitial. Fetch the record and prefill.
  const editId = (params.editId || "").trim() || null;
  const isEdit = !!editId && !!spec.editInitial;
  const editQ = useQuery({
    queryKey: ["form-record", spec.endpoint, editId],
    enabled: isEdit,
    queryFn: () => api.get<any>(`${spec.endpoint}/${editId}`),
  });

  const draftEnabled = !isEdit && spec.endpoint === "/api/leads";
  const draft = useFormDraft<FormValues>("new-lead", () => {
    const base = typeof spec.initial === "function" ? spec.initial(params) : { ...spec.initial };
    if (spec.endpoint === "/api/tasks") for (const key of ["title", "description", "relatedLeadId", "relatedInvestorId"]) if (params[key]) base[key] = params[key];
    return base;
  }, draftEnabled);
  const form = draft.value, setForm = draft.setValue;
  const online = useConnectivity(s => s.online);
  const [moreDetails, setMoreDetails] = useState(false);
  const quickKeys = new Set(["name", "phone", "email", "source", "sourceOther", "referredByInvestorId", "followUpDate"]);
  const quickLead = draftEnabled && !moreDetails;
  const showField = (f: { key: string; visibleIf?: (v: FormValues) => boolean }) => (!quickLead || quickKeys.has(f.key)) && (!f.visibleIf || f.visibleIf(form));
  const [hydrated, setHydrated] = useState(!isEdit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  // RM double-booking (409 rm_conflict) → surface the clash + "Schedule anyway".
  const [conflicts, setConflicts] = useState<any[] | null>(null);
  // `busy` disables the button only after a re-render; a fast double tap (or
  // the keyboard's Done plus the button) could post the record twice.
  const submitting = useRef(false);
  // A 409 the spec knows how to answer (spec.on409) — its body, until dismissed.
  const [conflict409, setConflict409] = useState<any | null>(null);

  // Folding sections (long forms) and taking the person to the first error.
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<React.ComponentRef<typeof View>>(null);
  const fieldRefs = useRef<Record<string, React.ComponentRef<typeof View> | null>>({});
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  /** Each section's open-at-first-sight, decided once (never re-folded under the person's fingers). */
  const decided = useRef<Record<string, boolean>>({});
  /** A step that has once been long stays folded (a field appearing never flips the layout back). */
  const longStep = useRef<Record<number, boolean>>({});
  const [focusReq, setFocusReq] = useState<{ key: string; n: number } | null>(null);

  // Once the edit record loads, hydrate the form from it (once).
  useEffect(() => {
    if (!isEdit || hydrated || !editQ.data || !spec.editInitial) return;
    const rec = spec.editRecordEnvelope ? editQ.data[spec.editRecordEnvelope] : editQ.data;
    if (!rec) return;
    const base = typeof spec.initial === "function" ? spec.initial(params) : { ...spec.initial };
    let next = { ...base, ...spec.editInitial(rec, params) };
    if (spec.derive) {
      const d = spec.derive(next);
      if (d) next = { ...next, ...d };
    }
    setForm(next);
    setHydrated(true);
  }, [isEdit, hydrated, editQ.data]);

  const setField = (key: string, value: any) => {
    setForm((s) => {
      let next = { ...s, [key]: value };
      if (spec.derive) {
        const d = spec.derive(next);
        if (d) next = { ...next, ...d };
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  };

  // spec.effect: async work after a change (e.g. the pincode lookup) can
  // re-apply derive the moment its answer lands, instead of on the next keystroke.
  // It also re-renders once (the tick), so a cache-backed readonly line (the
  // pincode hint) shows even when derive has nothing to set — without
  // changing `form`, so the effect is not re-triggered by it.
  const [, bumpTick] = useState(0);
  const rederive = useCallback(() => {
    if (spec.derive) {
      setForm((s) => {
        const d = spec.derive!(s);
        return d ? { ...s, ...d } : s;
      });
    }
    bumpTick((n) => n + 1);
  }, [spec, setForm]);
  const setFieldRef = useRef(setField);
  setFieldRef.current = setField;
  useEffect(() => {
    if (!spec.effect || !draft.ready) return;
    return spec.effect(form, { setField: (k, v) => setFieldRef.current(k, v), rederive }) ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, draft.ready]);

  // Field keys that are actually visible in the given sections (respects visibleIf).
  const visibleKeysIn = (sections: SectionSpec[]): string[] =>
    sections.flatMap((s) => s.fields.filter((f) => !f.visibleIf || f.visibleIf(form)).map((f) => f.key));

  /** A step's sections on screen, with stable ids ("step.index"). */
  const sectionsOf = (stepIndex: number) =>
    shownSections(steps[stepIndex]?.sections ?? [], form, showField).map((x) => ({ ...x, id: `${stepIndex}.${x.index}` }));

  /** Open every section holding an error, then scroll to (and focus) the first one in field order. */
  const reveal = (errs: Record<string, string>, stepIndex = step) => {
    const list = sectionsOf(stepIndex);
    const bad = list.filter(({ fields }) => fields.some((f) => errs[f.key])).map((x) => x.id);
    if (bad.length) setOpenMap((m) => ({ ...m, ...Object.fromEntries(bad.map((id) => [id, true])) }));
    const key = firstErrorKey(list.flatMap(({ fields }) => fields.map((f) => f.key)), errs);
    if (key) setFocusReq({ key, n: Date.now() });
  };

  // After the section has opened (and laid out), bring the field into view.
  useEffect(() => {
    if (!focusReq) return;
    const t = setTimeout(() => {
      const node = fieldRefs.current[focusReq.key];
      const content = contentRef.current;
      if (!node || !content || typeof node.measureLayout !== "function") return;
      node.measureLayout(
        content,
        (_x, y) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.xl), animated: true });
          inputRefs.current[focusReq.key]?.focus?.();
        },
        () => {}
      );
    }, 120);
    return () => clearTimeout(t);
  }, [focusReq]);

  const goNext = () => {
    setBanner(null);
    const errs = spec.validate?.(form) ?? null;
    if (errs) {
      // Only block on errors for fields on THIS step.
      const stepKeys = new Set(visibleKeysIn(steps[step].sections));
      const stepErrs = Object.fromEntries(Object.entries(errs).filter(([k]) => stepKeys.has(k)));
      const msgs = Object.values(stepErrs);
      if (msgs.length) {
        setErrors(stepErrs);
        setBanner(msgs[0] || "Please fix the highlighted fields.");
        reveal(stepErrs);
        return;
      }
    }
    setErrors({});
    Haptics.selectionAsync().catch(() => {});
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const goBack = () => {
    setBanner(null);
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  const submit = async (opts?: { force?: boolean }) => {
    if (submitting.current) return;
    setBanner(null);
    if (!opts?.force) {
      const errs = spec.validate?.(form) ?? null;
      if (errs && Object.keys(errs).length) {
        setErrors(errs);
        // Jump the user to the first step that has an error.
        let at = step;
        if (isWizard) {
          const badStep = steps.findIndex((st) =>
            visibleKeysIn(st.sections).some((k) => errs[k])
          );
          if (badStep >= 0 && badStep !== step) { setStep(badStep); at = badStep; }
        }
        setBanner(Object.values(errs)[0] || "Please fix the highlighted fields.");
        reveal(errs, at);
        return;
      }
    }
    setErrors({});
    setConflicts(null);
    setConflict409(null);
    submitting.current = true;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const body = spec.buildBody(form, params);
      const finalBody = opts?.force ? { ...body, force: true } : body;
      const json = isEdit
        ? await api.patch<any>(`${spec.endpoint}/${editId}`, finalBody)
        : ["/api/leads", "/api/activities"].includes(spec.endpoint)
          ? await queuedPost<any>(spec.endpoint, finalBody, spec.title)
          : await api.post<any>(spec.endpoint, finalBody);
      if (draftEnabled) await draft.clear().catch(() => {});
      for (const key of spec.invalidate ?? []) qc.invalidateQueries({ queryKey: [key] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (isEdit) {
        // Refresh the detail screen we're returning to.
        qc.invalidateQueries();
        router.back();
        return;
      }
      if (!json) { router.back(); return; }
      if (spec.afterCreate) {
        await spec.afterCreate(json, form, { router, params, post: api.post });
        return;
      }
      const target = spec.redirect?.(json, form, params) ?? null;
      if (target) router.replace(target as any);
      else router.back();
    } catch (e) {
      // RM double-booking — offer "Schedule anyway" (re-submits with force:true).
      if (e instanceof ApiError && e.status === 409 && e.body?.error === "rm_conflict") {
        setConflicts(Array.isArray(e.body.conflicts) ? e.body.conflicts : []);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
      if (e instanceof ApiError && e.status === 409 && spec.on409 && e.body) {
        setConflict409(e.body);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
      // A refusal that names fields (zod issues / fieldErrors): mark them and go to the first.
      if (e instanceof ApiError && (e.status === 400 || e.status === 422) && e.body) {
        const keys = steps.flatMap((_st, i) => sectionsOf(i).flatMap(({ fields }) => fields.map((f) => f.key)));
        const fieldErrs = serverFieldErrors(e.body, keys);
        if (Object.keys(fieldErrs).length) {
          setErrors(fieldErrs);
          const at = isWizard ? Math.max(0, steps.findIndex((_st, i) => sectionsOf(i).some(({ fields }) => fields.some((f) => fieldErrs[f.key])))) : step;
          if (at !== step) setStep(at);
          reveal(fieldErrs, at);
        }
      }
      const msg = e instanceof ApiError ? e.message : "Could not save. Please try again.";
      setBanner(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const current = steps[step];
  const isLast = step === steps.length - 1;

  // Fold a long step: 3+ titled sections and 12+ fields (sections.ts). The quick
  // lead form stays flat — it is short by design until "More details".
  // Decided only on the form as it will show (a restored draft, a loaded record).
  const ready = draft.ready && (!isEdit || hydrated);
  const shown = sectionsOf(step);
  const longNow = isLongForm(shown, spec.collapse);
  if (ready && longNow && !quickLead) longStep.current[step] = true;
  const collapsible = !quickLead && spec.collapse !== "never" && (!!longStep.current[step] || longNow);
  if (ready && collapsible && shown.some((x) => !(x.id in decided.current))) {
    const first = openAtFirstSight(shown, form, { ...(spec.validate?.(form) ?? {}), ...errors });
    shown.forEach(({ id }, i) => {
      if (!(id in decided.current)) decided.current[id] = first[i];
    });
  }
  const isOpen = (id: string) => !collapsible || (openMap[id] ?? decided.current[id] ?? true);
  const headerTitle = isEdit ? spec.editTitle ?? "Edit" : spec.title;
  const submitText = isEdit ? "Save changes" : spec.submitLabel;

  // In edit mode, wait for the record before rendering the form (avoids a flash
  // of empty fields then a jump when values arrive).
  if (!draft.ready || (isEdit && !hydrated)) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={headerTitle} onBack={() => router.back()} />
        {editQ.isError ? <ErrorState onRetry={editQ.refetch} /> : <LoadingState label="Loading…" />}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={headerTitle} onBack={() => router.back()} />

      {isWizard ? (
        <View style={styles.stepper}>
          <Text variant="caption" tone="muted">
            Step {step + 1} of {steps.length}
          </Text>
          <Text variant="subtitle" style={{ marginTop: 2 }}>
            {current.title}
          </Text>
          {current.description ? (
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {current.description}
            </Text>
          ) : null}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((step + 1) / steps.length) * 100}%` }]} />
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View ref={contentRef} collapsable={false}>
          {draft.status ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>{draft.status}</Text> : null}
          {!online && (isEdit || !["/api/leads", "/api/activities"].includes(spec.endpoint)) ? <Text tone="warning" style={{ marginBottom: spacing.md }}>This form needs a connection to submit.</Text> : null}
          {shown.map(({ section, id, fields }, si) => (
            <CollapsibleSection
              key={id}
              title={section.title}
              collapsible={collapsible}
              open={isOpen(id)}
              onToggle={() => setOpenMap((m) => ({ ...m, [id]: !isOpen(id) }))}
              summary={sectionSummary(section, fields, form)}
              footer={si === 0 && spec.notice ? <spec.notice form={form} isEdit={isEdit} /> : null}
            >
              {fields.map((f) => (
                <View key={f.key} collapsable={false} ref={(r) => { fieldRefs.current[f.key] = r; }}>
                  <FieldRenderer
                    field={f}
                    value={form[f.key]}
                    error={errors[f.key]}
                    onChange={(v) => setField(f.key, v)}
                    setField={setField}
                    inputRef={(r) => { inputRefs.current[f.key] = r; }}
                    form={form}
                  />
                </View>
              ))}
            </CollapsibleSection>
          ))}

          {draftEnabled ? <Button label={moreDetails ? "Hide optional details" : "More details (optional)"} variant="secondary" onPress={() => setMoreDetails(!moreDetails)} /> : null}
          {banner ? (
            <Text variant="body" tone="danger" center style={{ marginTop: spacing.sm, color: palette.danger }}>
              {banner}
            </Text>
          ) : null}
          {conflict409 && spec.on409
            ? spec.on409(conflict409, { router, params, post: api.post, form, dismiss: () => setConflict409(null) }) ??
              <Text variant="body" tone="danger" center style={{ marginTop: spacing.sm, color: palette.danger }}>
                {String(conflict409?.error ?? "This record already exists.")}
              </Text>
            : null}
          </View>
        </ScrollView>

        <StickyActionBar>
          {isWizard && step > 0 ? (
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button label="Back" variant="secondary" onPress={goBack} full />
              </View>
              <View style={{ flex: 2 }}>
                {isLast ? (
                  <Button label={submitText} onPress={() => submit()} loading={busy} full />
                ) : (
                  <Button label="Next" onPress={goNext} full />
                )}
              </View>
            </View>
          ) : isWizard && !isLast ? (
            <Button label="Next" onPress={goNext} full />
          ) : (
            <Button label={submitText} onPress={() => submit()} loading={busy} full />
          )}
        </StickyActionBar>
      </KeyboardAvoidingView>

      {/* RM double-booking clash → confirm "Schedule anyway". */}
      <BottomSheet visible={!!conflicts} onClose={() => setConflicts(null)} title="RM already booked">
        <Text variant="body" tone="muted" style={{ marginBottom: spacing.md }}>
          This RM has {conflicts?.length === 1 ? "an overlapping meeting" : `${conflicts?.length ?? 0} overlapping meetings`} at that time:
        </Text>
        {(conflicts ?? []).map((c: any, i: number) => (
          <View key={c.id ?? i} style={styles.conflictRow}>
            <Text variant="body" numberOfLines={1}>{c.subject || (c.meeting_type ? String(c.meeting_type).replace(/_/g, " ") : "Meeting")}{c.name ? ` · ${c.name}` : ""}</Text>
            {c.meeting_date ? (
              <Text variant="caption" tone="muted">
                {fmtDateTime(c.meeting_date)}
                {c.duration_minutes ? ` · ${c.duration_minutes} min` : ""}
              </Text>
            ) : null}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
          <Button label="Go back" variant="secondary" onPress={() => setConflicts(null)} style={{ flex: 1 }} />
          <Button label="Schedule anyway" loading={busy} onPress={() => submit({ force: true })} style={{ flex: 1 }} />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  stepper: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surfaceSunken,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: palette.brand },
  conflictRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
    gap: 2,
  },
});
