"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  Save,
  Trash,
  AlertTriangle,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { runComplianceChecks } from "@/lib/comms/compliance";
import type { ContentPost, Campaign } from "@/db/schema";

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

interface EditContentPostFormProps {
  initialPost: ContentPost;
  campaigns: Campaign[];
}

export function EditContentPostForm({ initialPost, campaigns }: EditContentPostFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    contentDate: initialPost.contentDate,
    platform: initialPost.platform,
    contentType: initialPost.contentType,
    topic: initialPost.topic,
    caption: initialPost.caption ?? "",
    creativeUrl: (initialPost.creativeFiles as any)?.[0]?.url ?? "",
    creativeName: (initialPost.creativeFiles as any)?.[0]?.name ?? "",
    complianceChecked: initialPost.complianceChecked,
    complianceNotes: initialPost.complianceNotes ?? "",
    approvalStatus: initialPost.approvalStatus,
    rejectionReason: initialPost.rejectionReason ?? "",
    postedStatus: initialPost.postedStatus,
    postLink: initialPost.postLink ?? "",
    campaignId: initialPost.campaignId ?? "",
    remarks: initialPost.remarks ?? "",
  });

  const [tenant, setTenant] = useState<{
    legalName?: string;
    arn?: string;
    principalEuin?: string;
    riaRegistered?: boolean;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ compliance: boolean; approval: boolean } | null>(
    null
  );

  useEffect(() => {
    fetch("/api/tenant")
      .then((r) => r.json())
      .then((data) => {
        if (data?.tenant) {
          setTenant({
            legalName: data.tenant.legalName ?? "",
            arn: data.tenant.arn ?? "",
            principalEuin: data.tenant.principalEuin ?? undefined,
            riaRegistered: !!data.tenant.riaRegistered,
          });
        }
      })
      .catch((err) => console.error("Failed to load tenant details:", err));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  // Live compliance checking against the caption text
  const compliance = useMemo(() => {
    const activeTenant = tenant ?? {
      legalName: "Demo Wealth Advisors",
      arn: "123456",
      principalEuin: "E123456",
      riaRegistered: false,
    };
    return runComplianceChecks({
      channel: "email", // Use email rules as generic text scanning proxy
      category: "marketing", // Scan with strict marketing compliance
      tenant: activeTenant,
      text: form.caption || "",
    });
  }, [form.caption, tenant]);

  const postingAllowed =
    form.complianceChecked === true && form.approvalStatus === "approved";

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

      const res = await fetch(`/api/content-posts/${initialPost.id}`, {
        method: "PATCH",
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
          rejectionReason: form.rejectionReason || undefined,
          postedStatus: form.postedStatus,
          postLink: form.postLink || undefined,
          campaignId: form.campaignId || null,
          remarks: form.remarks || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.blockedBy) setBlocked(j.blockedBy);
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push("/dashboard/content-calendar");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Are you sure you want to cancel this post?")) return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/content-posts/${initialPost.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Delete failed (${res.status})`);
      }
      router.push("/dashboard/content-calendar");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/content-calendar"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to calendar
      </Link>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">
            <ImageIcon className="size-6 text-brand-cyan" /> Edit social-media post
          </h1>
          <p className="page-subtitle">
            Update scheduling, attach branded content library assets, and check compliance.
          </p>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="rounded-md bg-rose-50 text-rose-700 hover:bg-rose-100 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 border border-rose-200"
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash className="size-3.5" />}
          Cancel Post
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
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
                  onChange={(e) => set("platform", e.target.value as any)}
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
                  onChange={(e) => set("contentType", e.target.value as any)}
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
                rows={5}
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
            {form.creativeUrl && (
              <div className="mt-3 border rounded-lg overflow-hidden bg-slate-50 aspect-video relative flex items-center justify-center text-xs text-muted-foreground">
                {form.creativeUrl.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.creativeUrl}
                    alt="Creative Preview"
                    className="object-contain w-full h-full"
                  />
                ) : (
                  <span>No image preview available for this asset type.</span>
                )}
              </div>
            )}
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
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="block">
                <div className="text-xs font-medium mb-1">Approval status</div>
                <select
                  value={form.approvalStatus}
                  onChange={(e) => set("approvalStatus", e.target.value as any)}
                  className="input-base"
                >
                  <option value="pending">Pending</option>
                  <option value="in_review">In review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="not_required">Not required</option>
                </select>
              </label>
              {form.approvalStatus === "rejected" && (
                <label className="block">
                  <div className="text-xs font-medium mb-1">Rejection reason</div>
                  <input
                    value={form.rejectionReason}
                    onChange={(e) => set("rejectionReason", e.target.value)}
                    placeholder="Enter reason for rejection"
                    className="input-base border-rose-300"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="card-surface p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 rounded-full brand-bar" />
              <h2 className="section-title">4. Posting & Campaigns</h2>
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
                  onChange={(e) => set("postedStatus", e.target.value as any)}
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
                <div className="text-xs font-medium mb-1">Campaign Binding (ROI rollup)</div>
                <select
                  value={form.campaignId}
                  onChange={(e) => set("campaignId", e.target.value)}
                  className="input-base"
                >
                  <option value="">No Campaign association</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <div className="text-xs font-medium mb-1">Post link (when published)</div>
              <input
                value={form.postLink}
                onChange={(e) => set("postLink", e.target.value)}
                placeholder="https://instagram.com/p/xxxxx"
                className="input-base"
              />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Remarks</div>
              <textarea
                value={form.remarks}
                onChange={(e) => set("remarks", e.target.value)}
                rows={2}
                className="input-base"
              />
            </label>
          </div>

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

          <div className="flex justify-end gap-2 pt-2">
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
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Live Caption Compliance Scanner Sidebar */}
        <div className="space-y-4">
          <div className="card-surface p-4 space-y-3 h-fit sticky top-4">
            <div className="flex items-center gap-2 border-b pb-2">
              <ShieldCheck className={`size-5 ${compliance.blocked ? "text-rose-600" : "text-emerald-600"}`} />
              <h3 className="font-semibold text-sm text-slate-800">Caption Compliance</h3>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs font-medium">Compliance score</div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    compliance.blocked ? "bg-rose-500" : compliance.score >= 90 ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  style={{ width: `${compliance.score}%` }}
                />
              </div>
              <div className="font-mono text-xs">{compliance.score}/100</div>
            </div>

            {compliance.findings.length > 0 ? (
              <div className="space-y-2.5 pt-2">
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Findings</div>
                <ul className="space-y-2">
                  {compliance.findings.map((f, i) => (
                    <li key={i} className="text-xs border p-2.5 rounded-lg bg-slate-50/50 space-y-1">
                      <div className="flex items-start gap-1.5 font-medium text-slate-800">
                        <AlertCircle
                          className={`size-3.5 mt-0.5 shrink-0 ${
                            f.severity === "block" ? "text-rose-600" : f.severity === "warn" ? "text-amber-600" : "text-blue-600"
                          }`}
                        />
                        <span>{f.message}</span>
                      </div>
                      {f.remediation && (
                        <div className="text-[10px] text-emerald-700 font-medium pl-5">
                          Fix: {f.remediation}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-4 text-xs text-center text-emerald-800 border border-emerald-200 rounded-lg bg-emerald-50/20">
                Caption is fully compliant with SEBI regulations.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
