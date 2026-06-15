"use client";

/**
 * Risk Profiles list helpers:
 *   - <RiskProfileName>      — the investor-name cell. Clicking opens the Risk
 *                              Profile PDF in a popup modal WHEN a profile
 *                              exists; when not yet profiled the name is plain
 *                              text (clicking does nothing).
 *   - <RiskProfilePdfButtons> — View + Download buttons for a completed profile.
 *
 * Both share the PdfModal (the /api/risk-profiles/[id]/pdf route serves the PDF
 * inline so it renders in an <iframe>).
 */
import { useState } from "react";
import { X, Download, Eye } from "lucide-react";

function PdfModal({ profileId, name, onClose }: { profileId: string; name: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <div className="font-semibold text-sm truncate">Risk Profile · {name}</div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/risk-profiles/${profileId}/pdf?download=1`}
              className="btn-secondary text-xs px-2.5 py-1 inline-flex items-center gap-1"
            >
              <Download className="size-3" /> Download
            </a>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <iframe
          src={`/api/risk-profiles/${profileId}/pdf`}
          className="flex-1 w-full border-0 bg-secondary/30"
          title={`Risk Profile PDF — ${name}`}
        />
      </div>
    </div>
  );
}

export function RiskProfileName({
  name,
  pan,
  profileId,
}: {
  name: string;
  pan: string | null;
  profileId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {profileId ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium hover:underline text-left"
          title="View Risk Profile PDF"
        >
          {name}
        </button>
      ) : (
        // Not yet profiled — nothing to open, so the name is plain text.
        <span className="font-medium text-foreground">{name}</span>
      )}
      {pan && <div className="text-xs text-muted-foreground font-mono">{pan}</div>}
      {open && profileId && <PdfModal profileId={profileId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RiskProfilePdfButtons({ profileId, name }: { profileId: string | null; name: string }) {
  const [open, setOpen] = useState(false);
  if (!profileId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary text-xs px-2.5 py-1 inline-flex items-center gap-1"
        title="View Risk Profile PDF"
      >
        <Eye className="size-3" /> View
      </button>
      <a
        href={`/api/risk-profiles/${profileId}/pdf?download=1`}
        className="btn-secondary text-xs px-2.5 py-1 inline-flex items-center gap-1"
        title="Download Risk Profile PDF"
      >
        <Download className="size-3" /> Download
      </a>
      {open && <PdfModal profileId={profileId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
