"use client";

import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { useState } from "react";
import { FamilyHeadPicker, familyNameFromHead, type HeadCandidate } from "@/components/families/FamilyHeadPicker";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { FAMILY_REVIEW_FREQUENCIES } from "@/lib/families/cadence";
import { buttonClass } from "@/components/ui/button-class";

const CATEGORIES = ["HNI", "Affluent", "Retail", "NRI", "Corporate"] as const;

export default function NewFamilyPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    headName: "",
    familyCode: "",
    familyCategory: "",
    rmId: "",
    reviewFrequency: "",
    firstMeetingDate: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [head, setHead] = useState<HeadCandidate | null>(null);
  /** True once the user edits the name themselves — after that we never
   *  overwrite it, so a household named by organisation ("Sharma Trust") is not
   *  dragged back to "<person> Family" when the head is picked or changed. */
  const [nameTouched, setNameTouched] = useState(false);

  function pickHead(c: HeadCandidate | null) {
    setHead(c);
    if (c && !nameTouched) set("headName", familyNameFromHead(c.name));
  }

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.headName.trim()) {
      setErr("Family name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // The name field IS the family's name: send it as such, so the firm's
      // naming pattern does not wrap it again ("Patel" → "Patel Family" was
      // fine, "Ramesh Patel" → "Ramesh Patel Family" was not what was typed).
      const name = form.headName.trim();
      const payload: any = { headName: head?.name ?? name, familyName: name, notes: form.notes.trim() || undefined };
      // Link the head so the household starts attached to a real client instead
      // of being a name with members bolted on later.
      if (head) payload.primaryInvestorId = head.id;
      if (form.familyCode) payload.familyCode = form.familyCode;
      if (form.familyCategory) payload.familyCategory = form.familyCategory;
      if (form.rmId) payload.rmId = form.rmId;
      if (form.reviewFrequency) payload.reviewFrequency = form.reviewFrequency;
      if (form.firstMeetingDate) payload.firstMeetingDate = form.firstMeetingDate;

      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A raw "forbidden: missing family.create" tells the user nothing they
        // can act on — name the setting an owner has to switch on, and where.
        if (res.status === 403) {
          setErr(
            "You don’t have permission to create households. Ask your firm admin to enable “Create households” for you under Team → your profile → Customize Access Permissions."
          );
        } else if (res.status === 401) {
          setErr("Your session has expired. Please sign in again.");
        } else if (Array.isArray(j?.issues) && j.issues.length) {
          const fields = j.issues
            .map((i: any) => (Array.isArray(i?.path) ? i.path.join(".") : ""))
            .filter(Boolean)
            .join(", ");
          setErr(fields ? `Please check: ${fields}` : (j.error ?? "Create failed"));
        } else {
          setErr(j.error ?? `Create failed (HTTP ${res.status})`);
        }
        return;
      }
      // Straight into the new family, where members are added next.
      router.push(j?.id ? `/dashboard/families/${j.id}` : "/dashboard/families");
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeaderCard
        breadcrumb={[{ label: "Families", href: "/dashboard/families" }, { label: "New family" }]}
        title={<>New family</>}
        subtitle={<>Pick the head of the household, name the family, then add the other members on the next screen.</>}
      />
<form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-4">
        {/* Head of family first: picking it fills the name below, so the common
            case is one search and a Create click. Optional — a household can
            still be named up front and populated later. */}
        <div>
          <div className="text-xs font-medium mb-1">
            Head of family <span className="text-muted-foreground font-normal">· optional, fills the name below</span>
          </div>
          <FamilyHeadPicker value={head} onPick={pickHead} />
        </div>

        {/* Identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">
              Family / organisation name<span className="text-destructive">*</span>
            </div>
            <input
              value={form.headName}
              onChange={(e) => { setNameTouched(true); set("headName", e.target.value); }}
              required
              // placeholder="e.g. Patel Family"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Family code</div>
            <input
              value={form.familyCode}
              onChange={(e) => set("familyCode", e.target.value)}
              // placeholder="e.g. PATEL-001"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <SelectField
              value={form.familyCategory}
              onChange={(e) => set("familyCategory", e.target.value)}
            >
              <option value="">Select</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">
              Relationship Manager
              <span className="ml-1 text-2xs text-muted-foreground font-normal">· defaults to you</span>
            </div>
            <RmSelector
              value={form.rmId || null}
              onChange={(id) => set("rmId", id ?? "")}
              placeholder="Assign to myself"
            />
          </label>
        </div>

        {/* Review cadence */}
        <div className="rounded-lg border border-border bg-secondary/30 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Review cadence
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Review frequency</div>
              <SelectField
                value={form.reviewFrequency}
                onChange={(e) => set("reviewFrequency", e.target.value)}
              >
                <option value="">None</option>
                {FAMILY_REVIEW_FREQUENCIES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </SelectField>
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">First meeting date</div>
              <DateField
                value={form.firstMeetingDate}
                onChange={(e) => set("firstMeetingDate", e.target.value)}
              />
            </label>
          </div>
          {form.reviewFrequency && (
            <p className="text-2xs text-muted-foreground mt-2">
              {form.firstMeetingDate
                ? "Reviews follow this schedule from the first meeting date."
                : "The first review falls due one period from today."}{" "}
              It shows up in "reviews due" on the dashboards.
            </p>
          )}
        </div>

        <label className="block">
          <div className="text-xs font-medium mb-1">Notes</div>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>

        {err && <div role="alert" className="text-sm text-destructive">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/families" className={buttonClass("secondary")}>Cancel</Link>
          <button type="submit" disabled={busy || form.headName.trim().length < 2} className={buttonClass("primary")}>
            {busy ? "Creating…" : "Create family"}
          </button>
        </div>
      </form>
</div>
  );
}
