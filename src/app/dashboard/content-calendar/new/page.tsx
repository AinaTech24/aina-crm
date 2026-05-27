"use client";

/**
 * New social-media post form. Captures all 12 spec fields. The compliance
 * + approval checkboxes are exposed at creation time but the API enforces:
 * postedStatus='posted' requires complianceChecked AND approvalStatus='approved'.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  Save,
  AlertTriangle,
} from "lucide-react";

const PLATFORMS: [string, string][] = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["linkedin", "LinkedIn"],
  ["youtube", "YouTube"],
  ["x_twitter", "X / Twitter"],
  ["whatsapp_status", "WhatsApp Status"],
  ["telegram", "Telegram"],
  ["blog", "Blog"],
  ["other", "Other"],
];

const CONTENT_TYPES: [string, string][] = [
  ["image_post", "Image post"],
  ["carousel", "Carousel"],
  ["video_reel", "Video / Reel"],
  ["story", "Story"],
  ["live", "Live"],
  ["article", "Article"],
  ["infographic", "Infographic"],
  ["text", "Text"],
  ["other", "Other"],
];

export default function NewContentPostPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    contentDate: new Date().toISOString().slice(0, 10),
    platform: "instagram",
    contentType: "image_post",
    topic: "",
    caption: "",
    creativeUrl: "",
    creativeName: "",
    complianceChecked: false,
    complianceNotes: "",
    approvalStatus: "pending",
    postedStatus: "not_posted",
    postLink: "",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ compliance: boolean; approval: boolean } | null>(
    null
  );

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    if (!form.topic.trim()) {
      setErr("Topic is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    setBlocked(null);
    try {
      const creativeFiles =
        form.creativeUrl.trim()
          ? [
              {
                name: form.creativeName.trim() || "Creative",
                url: form.creativeUrl.trim(),
              },
            ]
          : [];
      const res = await fetch("/api/content-posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentDate: form.contentDate,
          platform: form.platform,
          contentType: form.contentType,
          topic: form.topic,
          caption: form.caption || undefined,
          creativeFiles,
          complianceChecked: form.complianceChecked,
          complianceNotes: form.complianceNotes || undefined,
          approvalStatus: form.approvalStatus,
          postedStatus: form.postedStatus,
          postLink: form.postLink || undefined,
          remarks: form.remarks || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (j.blockedBy) setBlocked(j.blockedBy);
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push(`/dashboard/content-calendar/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  // Live-disable the "posted" option in the UI when gates are open
  const postingAllowed =
    form.complianceChecked === true && form.approvalStatus === "approved";

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/content-calendar"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to calendar
      </Link>

      <div>
        <h1 className="page-title">
          <ImageIcon className="size-6 text-brand-cyan" /> New social-media post
        </h1>
        <p className="page-subtitle">
          Posting is gated — content can only be marked <strong>posted</strong> after compliance ✓
          AND approval ✓.
        </p>
      </div>

      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">1. Schedule + platform</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Content date *</div>
            <input
              type="date"
              value={form.contentDate}
              onChange={(e) => set("contentDate", e.target.value)}
              className="input-base"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Platform *</div>
            <select
              value={form.platform}
              onChange={(e) => set("platform", e.target.value)}
              className="input-base"
            >
              {PLATFORMS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Content type *</div>
            <select
              value={form.contentType}
              onChange={(e) => set("contentType", e.target.value)}
              className="input-base"
            >
              {CONTENT_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">2. Content</h2>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Topic *</div>
          <input
            value={form.topic}
            onChange={(e) => set("topic", e.target.value)}
            placeholder="e.g. Diwali Tax Saving — Last 7 days"
            className="input-base"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Caption</div>
          <textarea
            value={form.caption}
            onChange={(e) => set("caption", e.target.value)}
            rows={4}
            placeholder="Full caption with hashtags…"
            className="input-base"
          />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-1">
            <div className="text-xs font-medium mb-1">Creative — file name</div>
            <input
              value={form.creativeName}
              onChange={(e) => set("creativeName", e.target.value)}
              placeholder="diwali_carousel.jpg"
              className="input-base"
            />
          </label>
          <label className="block col-span-2">
            <div className="text-xs font-medium mb-1">Creative file URL</div>
            <input
              value={form.creativeUrl}
              onChange={(e) => set("creativeUrl", e.target.value)}
              placeholder="https://s3.amazonaws.com/…"
              className="input-base"
            />
          </label>
        </div>
      </div>

      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">3. Compliance + approval gates</h2>
        </div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.complianceChecked}
            onChange={(e) => set("complianceChecked", e.target.checked)}
            className="mt-0.5 size-4 rounded border-border text-brand-cyan focus:ring-brand-cyan"
          />
          <div>
            <div className="text-sm font-semibold">Compliance checked</div>
            <div className="text-[11px] text-muted-foreground">
              ARN tagline, SEBI no-return-guarantee, disclaimer verified.
            </div>
          </div>
        </label>
        {form.complianceChecked && (
          <label className="block ml-6">
            <div className="text-xs font-medium mb-1 text-muted-foreground">
              Compliance notes (optional)
            </div>
            <input
              value={form.complianceNotes}
              onChange={(e) => set("complianceNotes", e.target.value)}
              placeholder="Disclaimer wording approved, hashtags within DLT scope."
              className="input-base"
            />
          </label>
        )}
        <label className="block">
          <div className="text-xs font-medium mb-1">Approval status</div>
          <select
            value={form.approvalStatus}
            onChange={(e) => set("approvalStatus", e.target.value)}
            className="input-base"
          >
            <option value="pending">Pending</option>
            <option value="in_review">In review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="not_required">Not required</option>
          </select>
        </label>
      </div>

      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">4. Posting</h2>
        </div>
        {!postingAllowed && form.postedStatus === "posted" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="size-3.5" />
            <span>
              You can't mark this as <strong>posted</strong> until both compliance is checked and
              approval is granted.
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Posted status</div>
            <select
              value={form.postedStatus}
              onChange={(e) => set("postedStatus", e.target.value)}
              className="input-base"
            >
              <option value="not_posted">Not posted</option>
              <option value="scheduled">Scheduled</option>
              <option value="posted" disabled={!postingAllowed}>
                Posted {!postingAllowed ? "(requires gates)" : ""}
              </option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Post link (when published)</div>
            <input
              value={form.postLink}
              onChange={(e) => set("postLink", e.target.value)}
              placeholder="https://instagram.com/p/xxxxx"
              className="input-base"
            />
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Remarks</div>
          <textarea
            value={form.remarks}
            onChange={(e) => set("remarks", e.target.value)}
            rows={2}
            className="input-base"
          />
        </label>

        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
            {blocked && (
              <ul className="mt-1 text-xs list-disc list-inside">
                {blocked.compliance && <li>Compliance check is not done.</li>}
                {blocked.approval && <li>Approval is not granted.</li>}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/content-calendar" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={busy || !form.topic}
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save post"}
          </button>
        </div>
      </div>
    </div>
  );
}
