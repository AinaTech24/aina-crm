"use client";

/**
 * Investor-name cell for the Risk Profiles list. When the investor has a
 * completed profile, clicking the name opens the Risk Profile PDF inline in a
 * popup modal (the /api/risk-profiles/[id]/pdf route serves it inline). When
 * not yet profiled, the name links to the investor 360 page as before.
 */
import { useState } from "react";
import Link from "next/link";
import { X, Download } from "lucide-react";

export function RiskProfileName({
  investorId,
  name,
  pan,
  profileId,
}: {
  investorId: string;
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
        <Link href={`/dashboard/investors/${investorId}`} className="font-medium hover:underline">
          {name}
        </Link>
      )}
      {pan && <div className="text-xs text-muted-foreground font-mono">{pan}</div>}

      {open && profileId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
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
                <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-accent" aria-label="Close">
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
      )}
    </>
  );
}
