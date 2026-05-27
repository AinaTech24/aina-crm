"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Loader2, Save, Users, Sparkles } from "lucide-react";

const TYPES = [
  ["portfolio_review", "Portfolio Review"],
  ["goal_review", "Goal Review"],
  ["new_investment_discussion", "New Investment Discussion"],
  ["service_discussion", "Service Discussion"],
  ["family_review", "Family Review"],
  ["complaint_discussion", "Complaint Discussion"],
] as const;

const MODES = [
  ["office", "Office"],
  ["client_place", "Client Place"],
  ["online", "Online"],
  ["phone", "Phone"],
] as const;

type InvestorOpt = { id: string; name: string; pan: string; segment_tag: string | null };
type LeadOpt = { id: string; name: string; phone: string | null; stage: string };

/**
 * Schedule-meeting form. MFDs hold meetings with both clients (investors)
 * and pre-conversion leads (discovery, proposal review), so the form opens
 * with a Lead | Client toggle that swaps the subject picker.
 *
 * If preselectedLeadId or preselectedInvestorId is set (e.g. when launched
 * from a detail page), the form opens locked to that subject type.
 */
export function ScheduleMeetingForm({
  investors,
  leads,
  preselectedInvestorId,
  preselectedLeadId,
}: {
  investors: InvestorOpt[];
  leads: LeadOpt[];
  preselectedInvestorId?: string;
  preselectedLeadId?: string;
}) {
  const router = useRouter();
  const [subjectKind, setSubjectKind] = useState<"client" | "lead">(
    preselectedLeadId ? "lead" : "client"
  );
  const [form, setForm] = useState({
    investorId: preselectedInvestorId ?? "",
    leadId: preselectedLeadId ?? "",
    meetingType: "portfolio_review",
    meetingDate: defaultIsoDateTime(),
    durationMinutes: "30",
    meetingMode: "online",
    locationOrLink: "",
    discussionPoints: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, any> = {
        meetingType: form.meetingType,
        meetingDate: new Date(form.meetingDate).toISOString(),
        durationMinutes: parseInt(form.durationMinutes, 10) || 30,
        meetingMode: form.meetingMode,
        locationOrLink: form.locationOrLink || undefined,
        discussionPoints: form.discussionPoints || undefined,
      };
      if (subjectKind === "client") body.investorId = form.investorId;
      else body.leadId = form.leadId;

      const res = await fetch("/api/review-meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push("/dashboard/review-meetings");
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    !!form.meetingDate &&
    (subjectKind === "client" ? !!form.investorId : !!form.leadId);

  // When a subject was pre-selected on the URL, lock the toggle to that kind
  // so the user can't accidentally clear it.
  const subjectLocked = !!(preselectedInvestorId || preselectedLeadId);

  return (
    <div className="card-surface p-5 space-y-3">
      <h2 className="font-semibold">Meeting details</h2>

      {/* Subject toggle — Lead vs Client */}
      <div>
        <div className="text-xs font-semibold text-foreground/80 mb-1.5">
          Who is the meeting with?
        </div>
        <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-1 gap-1">
          <button
            type="button"
            disabled={subjectLocked && subjectKind !== "client"}
            onClick={() => setSubjectKind("client")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
              subjectKind === "client"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            } ${subjectLocked && subjectKind !== "client" ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <Users className="size-3.5" /> Client
          </button>
          <button
            type="button"
            disabled={subjectLocked && subjectKind !== "lead"}
            onClick={() => setSubjectKind("lead")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
              subjectKind === "lead"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            } ${subjectLocked && subjectKind !== "lead" ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <Sparkles className="size-3.5" /> Lead
          </button>
        </div>
      </div>

      {subjectKind === "client" ? (
        <Field label="Client">
          <select
            value={form.investorId}
            onChange={(e) => set("investorId", e.target.value)}
            className="input-base"
          >
            <option value="">— pick a client —</option>
            {investors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {i.pan} {i.segment_tag ? `· ${i.segment_tag}` : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Lead">
          <select
            value={form.leadId}
            onChange={(e) => set("leadId", e.target.value)}
            className="input-base"
          >
            <option value="">— pick a lead —</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.phone ? ` · ${l.phone}` : ""} · {l.stage.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {leads.length === 0 && (
            <div className="text-[11px] text-muted-foreground mt-1.5">
              No open leads to meet with. Add a lead first from{" "}
              <a href="/dashboard/leads/new" className="text-brand-cyan hover:underline">
                Leads → New
              </a>
              .
            </div>
          )}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Meeting type">
          <select value={form.meetingType} onChange={(e) => set("meetingType", e.target.value)} className="input-base">
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <select value={form.meetingMode} onChange={(e) => set("meetingMode", e.target.value)} className="input-base">
            {MODES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </Field>

        <Field label="When">
          <input
            type="datetime-local"
            value={form.meetingDate}
            onChange={(e) => set("meetingDate", e.target.value)}
            className="input-base"
          />
        </Field>
        <Field label="Duration (minutes)">
          <input
            type="number"
            value={form.durationMinutes}
            onChange={(e) => set("durationMinutes", e.target.value)}
            min={5}
            max={480}
            className="input-base tabular-nums"
          />
        </Field>
      </div>

      <Field label="Location / link">
        <input
          value={form.locationOrLink}
          onChange={(e) => set("locationOrLink", e.target.value)}
          placeholder={
            form.meetingMode === "online"
              ? "Zoom / Meet / Teams URL"
              : form.meetingMode === "phone"
              ? "Phone number to call"
              : "Address"
          }
          className="input-base"
        />
      </Field>

      <Field label="Discussion points (agenda)">
        <textarea
          value={form.discussionPoints}
          onChange={(e) => set("discussionPoints", e.target.value)}
          rows={3}
          placeholder={
            subjectKind === "lead"
              ? "Introductory call agenda, risk appetite, family + goal context…"
              : "Portfolio rebalancing, new SIPs, tax planning, nominee update…"
          }
          className="input-base"
        />
      </Field>

      {err && (
        <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
          {err}
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-border">
        <button onClick={save} disabled={!canSave || busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {busy ? "Scheduling…" : "Schedule meeting"}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed pt-2 border-t border-border flex items-start gap-1.5">
        <Calendar className="size-3.5 mt-0.5 flex-shrink-0" />
        A reminder task auto-fires the day before. After completion, action
        items become individual tasks and the {subjectKind === "client" ? "client's next review date" : "lead's last-contact date"}{" "}
        gets updated.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-foreground/80 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function defaultIsoDateTime(): string {
  // Tomorrow 11am, formatted for <input type="datetime-local">
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
