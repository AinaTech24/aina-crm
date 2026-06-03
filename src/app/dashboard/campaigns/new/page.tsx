"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  MessageCircle,
  Mail,
  MessageSquare,
  Share2,
  Video,
  Users2,
  Users,
  Globe,
  Sparkles,
  Megaphone,
  FileText,
  Save,
  Loader2,
} from "lucide-react";

const KIND_OPTIONS: Array<{
  key: string;
  label: string;
  icon: any;
  /** Set to true when this kind also produces an outbound broadcast we can wire to template+segment. */
  broadcast?: boolean;
}> = [
  { key: "social_media", label: "Social Media", icon: Share2 },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, broadcast: true },
  { key: "email", label: "Email", icon: Mail, broadcast: true },
  { key: "sms", label: "SMS", icon: MessageSquare, broadcast: true },
  { key: "webinar", label: "Webinar", icon: Video },
  { key: "seminar", label: "Seminar", icon: Users2 },
  { key: "referral", label: "Referral", icon: Users },
  { key: "google_business", label: "Google Business", icon: Globe },
  { key: "paid_ads", label: "Paid Ads", icon: Sparkles },
  { key: "content", label: "Content", icon: FileText },
  { key: "other", label: "Other", icon: Megaphone },
];

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("social_media");
  const [theme, setTheme] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [throttle, setThrottle] = useState(60);
  const [contentStatus, setContentStatus] = useState("not_started");
  const [complianceCheckStatus, setComplianceCheckStatus] = useState("pending");
  const [approvalStatus, setApprovalStatus] = useState("pending");
  const [campaignCost, setCampaignCost] = useState<string>("");
  const [remarks, setRemarks] = useState("");

  const [templates, setTemplates] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [tplRes, segRes] = await Promise.all([
        fetch("/api/templates").then((r) => r.json()).catch(() => ({})),
        fetch("/api/segments").then((r) => r.json()).catch(() => ({})),
      ]);
      setTemplates(tplRes.templates ?? []);
      setSegments(segRes.segments ?? []);
    })();
  }, []);

  const opt = KIND_OPTIONS.find((k) => k.key === kind)!;
  const isBroadcast = !!opt.broadcast;
  const filteredTemplates = templates.filter(
    (t) => t.channel === kind && t.status === "approved"
  );

  async function create(launch: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const sendable = launch && isBroadcast && !!templateId && !!segmentId;
      const immediateSend = sendable && !scheduledAt;
      const scheduledSend = sendable && !!scheduledAt;

      const payload: any = {
        name: name || `${opt.label} campaign`,
        kind,
        theme: theme || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        targetAudience: targetAudience || undefined,
        contentStatus,
        complianceCheckStatus,
        // Clicking "Save & send" / "Schedule" IS the send decision — mark the
        // campaign-level approval not-required so the launch gate passes.
        // Plain drafts keep the chosen approval status (default pending).
        approvalStatus: sendable ? "not_required" : approvalStatus,
        campaignCost: campaignCost ? Number(campaignCost) : undefined,
        remarks: remarks || undefined,
      };
      if (isBroadcast) {
        payload.channel = kind; // whatsapp / email / sms
        if (templateId) payload.templateId = templateId;
        if (segmentId) payload.segmentId = segmentId;
        if (scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
        payload.throttlePerMinute = throttle;
      }
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }

      // Only launch NOW for immediate sends. Scheduled broadcasts are promoted
      // to 'sending' by the dispatcher when their scheduledAt arrives.
      if (immediateSend) {
        const lr = await fetch(`/api/campaigns/${j.id}/launch`, { method: "POST" });
        if (!lr.ok) {
          const lj = await lr.json().catch(() => ({}));
          // Don't silently swallow — the campaign exists but didn't send.
          setErr(`Saved, but launch failed: ${lj.error ?? `HTTP ${lr.status}`}. Open the campaign to launch it.`);
          return;
        }
      }
      void scheduledSend; // scheduled — nothing to launch now
      router.push(`/dashboard/campaigns`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/campaigns"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to campaigns
      </Link>

      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Megaphone className="size-6 text-brand-cyan" /> New marketing campaign
      </h1>

      <div className="card-surface p-5 space-y-5">
        {/* Campaign type */}
        <div>
          <div className="text-xs font-medium mb-2">Campaign type</div>
          <div className="grid grid-cols-4 gap-2">
            {KIND_OPTIONS.map((o) => {
              const Icon = o.icon;
              const active = kind === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setKind(o.key)}
                  className={`rounded-md border p-3 text-sm flex flex-col items-center gap-1 transition ${
                    active
                      ? "border-brand-cyan bg-brand-cyan/5 ring-2 ring-brand-cyan/20"
                      : "hover:bg-secondary"
                  }`}
                >
                  <Icon
                    className={`size-5 ${
                      active ? "text-brand-cyan" : "text-muted-foreground"
                    }`}
                  />
                  <span className={active ? "font-medium" : ""}>{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Name + theme */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Campaign name *</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${opt.label} — Tax Saver Q4`}
              className="input-base"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Theme / hook</div>
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Tax Saving · SIP Power · NFO Launch · Diwali"
              className="input-base"
            />
          </label>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Start date</div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-base"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">End date</div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-base"
            />
          </label>
        </div>

        {/* Audience */}
        <label className="block">
          <div className="text-xs font-medium mb-1">Target audience (free text)</div>
          <input
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="HNI clients in Mumbai · prospects from Diwali campaign · all SIPs >5y"
            className="input-base"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Describe the audience in plain English. For broadcasts, also pick a Segment below.
          </p>
        </label>

        {/* Broadcast extras */}
        {isBroadcast && (
          <div className="border-l-2 border-brand-cyan/30 pl-4 space-y-3">
            <div className="text-xs font-semibold text-brand-cyan uppercase tracking-wide">
              Broadcast send (optional)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="text-xs font-medium mb-1">Template (approved {kind})</div>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="input-base"
                >
                  <option value="">Select template…</option>
                  {filteredTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.key})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="text-xs font-medium mb-1">Segment</div>
                <select
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  className="input-base"
                >
                  <option value="">Select audience…</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.memberCount ?? 0} members)
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="text-xs font-medium mb-1">
                  Schedule (blank = send now after launch)
                </div>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="input-base"
                />
              </label>
              <label className="block">
                <div className="text-xs font-medium mb-1">Throttle (per min)</div>
                <input
                  type="number"
                  value={throttle}
                  onChange={(e) => setThrottle(Number(e.target.value))}
                  className="input-base"
                />
              </label>
            </div>
          </div>
        )}

        {/* Gates */}
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Content status</div>
            <select
              value={contentStatus}
              onChange={(e) => setContentStatus(e.target.value)}
              className="input-base"
            >
              <option value="not_started">Not started</option>
              <option value="drafting">Drafting</option>
              <option value="ready">Ready</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Compliance check</div>
            <select
              value={complianceCheckStatus}
              onChange={(e) => setComplianceCheckStatus(e.target.value)}
              className="input-base"
            >
              <option value="pending">Pending</option>
              <option value="cleared">Cleared</option>
              <option value="blocked">Blocked</option>
              <option value="not_required">Not required</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Approval status</div>
            <select
              value={approvalStatus}
              onChange={(e) => setApprovalStatus(e.target.value)}
              className="input-base"
            >
              <option value="pending">Pending</option>
              <option value="not_required">Not required</option>
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Approve from the campaign page, or use Save &amp; send.</p>
          </label>
        </div>

        {/* Cost + remarks */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Campaign cost (₹)</div>
            <input
              type="number"
              min={0}
              step="0.01"
              value={campaignCost}
              onChange={(e) => setCampaignCost(e.target.value)}
              placeholder="0"
              className="input-base"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Remarks</div>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Notes for the team or owner"
              className="input-base"
            />
          </label>
        </div>

        {err && (
          <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => create(false)}
            disabled={busy || !name}
            className="btn-secondary"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save as draft
          </button>
          {isBroadcast && templateId && segmentId && (
            <button
              type="button"
              onClick={() => create(true)}
              disabled={busy || !name}
              className="btn-primary"
            >
              {scheduledAt ? "Schedule broadcast" : "Save & send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
