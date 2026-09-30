import React from "react";
import Link from "next/link";
import { Sparkles, CheckCircle2, ArrowLeft, Eye, LayoutDashboard, Shield, ThumbsUp } from "lucide-react";
import { ModernDashboardScreen } from "@/components/dashboards/modern/ModernDashboardScreen";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RedesignPreviewPage() {
  let sessionName = "Pritesh Thakor";
  try {
    const session = await requireSession();
    if (session?.name) {
      sessionName = session.name;
    }
  } catch {
    // Fallback for preview mode
  }

  return (
    <div className="space-y-6">
      {/* Interactive Review & Demo Notice Header */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-primary/10 via-card to-indigo-500/10 border border-primary/20 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="size-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-xs">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-base text-foreground">
                CRM UI/UX Redesign — Live Dashboard Demo
              </span>
              <span className="text-2xs uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                Ready for Review
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Designed for high information density, sleek fintech aesthetics, intuitive period filtering, and 1-click actionability.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-secondary hover:bg-secondary/80 text-foreground border border-border transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Back to Standard Dashboard
          </Link>
        </div>
      </div>

      {/* The Redesigned Modern Dashboard Screen */}
      <ModernDashboardScreen userName={sessionName.split(" ")[0]} />
    </div>
  );
}
