"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** The circled back arrow at the left of the topbar, as in the reference. */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      title="Back"
      className="hidden lg:grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary"
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}
