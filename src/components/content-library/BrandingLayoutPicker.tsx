"use client";

/**
 * MFD-controlled branding layout picker for the AINA library detail page.
 *
 * Four layouts:
 *   - Bottom only          → single strip at the bottom (default)
 *   - Top only             → single strip at the top
 *   - Both                 → same strip top + bottom
 *   - Split (recommended)  → logo + firm name on top, ARN + contact + address on bottom
 *
 * Each option re-points the preview <img> and the download link at
 * /api/content-library/[id]/branded?mode=…&position=…&h=… so the server
 * composites the requested layout. The raw S3 URL never leaves the server.
 */

import { useState } from "react";
import { Download, LayoutTemplate } from "lucide-react";

type Layout = "bottom" | "top" | "both" | "split";

const OPTIONS: { key: Layout; label: string; sub: string }[] = [
  {
    key: "bottom",
    label: "Bottom only",
    sub: "Everything in one strip at the bottom",
  },
  {
    key: "top",
    label: "Top only",
    sub: "Everything in one strip at the top",
  },
  {
    key: "split",
    label: "Split — logo top, details bottom",
    sub: "Thin header (logo + firm name) + details (ARN, contact, address)",
  },
  {
    key: "both",
    label: "Both edges",
    sub: "Full strip duplicated top + bottom",
  },
];

export function BrandingLayoutPicker({
  assetId,
  defaultLayout = "bottom",
  defaultHeightPct = 18,
}: {
  assetId: string;
  defaultLayout?: Layout;
  defaultHeightPct?: number;
}) {
  const [layout, setLayout] = useState<Layout>(defaultLayout);
  const [heightPct, setHeightPct] = useState(defaultHeightPct);
  // Cache-buster so React swaps the <img> when params change (otherwise
  // the browser may reuse the cached preview).
  const [refreshKey, setRefreshKey] = useState(0);

  const params = `position=${layout}&h=${heightPct}&v=${refreshKey}`;
  const previewSrc = `/api/content-library/${assetId}/branded?mode=preview&${params}`;
  const downloadHref = `/api/content-library/${assetId}/branded?mode=download&${params}`;

  return (
    <div className="space-y-3">
      {/* Layout selector */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <LayoutTemplate className="size-3.5 text-brand-cyan" />
          <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
            Branding layout
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {OPTIONS.map((o) => {
            const active = layout === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  setLayout(o.key);
                  setRefreshKey((k) => k + 1);
                }}
                className={`text-left rounded-lg border p-2.5 text-xs transition ${
                  active
                    ? "border-brand-cyan bg-brand-cyan-light/40 ring-2 ring-brand-cyan/20"
                    : "border-border hover:bg-secondary"
                }`}
              >
                <div className="font-semibold text-[12px]">{o.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                  {o.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Height slider — applies to the main strip (the small top header in
          split mode is fixed at ~7 % so it never crowds the image). */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
          <span>
            Strip height — <span className="tabular-nums text-foreground font-semibold">{heightPct}%</span>
            <span className="opacity-70"> of image</span>
          </span>
          <span className="text-[10px] italic">
            {layout === "split" ? "Bottom strip only — top header is fixed compact" : "Applies to the strip"}
          </span>
        </div>
        <input
          type="range"
          min={8}
          max={30}
          step={1}
          value={heightPct}
          onChange={(e) => {
            setHeightPct(Number(e.target.value));
            setRefreshKey((k) => k + 1);
          }}
          className="w-full accent-brand-cyan"
        />
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-border bg-white p-2 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={previewSrc}
          src={previewSrc}
          alt="Branded preview"
          className="max-w-full h-auto rounded-md mx-auto block"
          style={{ maxHeight: "60vh" }}
        />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border">
        <p className="text-[11px] text-muted-foreground italic">
          Composited server-side · the raw image is never sent to the browser.
        </p>
        <a href={downloadHref} className="btn-primary" download>
          <Download className="size-4" /> Download branded PNG
        </a>
      </div>
    </div>
  );
}
