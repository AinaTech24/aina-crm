"use client";

/**
 * Opens a claim in the Claims Control Centre's drawer. One drawer is mounted
 * on the page; a link raises an event with the claim's id (and, from the
 * worklist's action menu, the action to start on), so server-rendered tables
 * need no client wrapper of their own.
 */

export const CLAIM_OPEN_EVENT = "claims:open";
export type ClaimAction = "status" | "assign" | "follow-up" | "settle";

export function openClaim(id: string, action?: ClaimAction) {
  window.dispatchEvent(new CustomEvent(CLAIM_OPEN_EVENT, { detail: { id, action } }));
}

export function ClaimLink({ id, children, className, action, title }: {
  id: string; children: React.ReactNode; className?: string; action?: ClaimAction; title?: string;
}) {
  return (
    <button type="button" onClick={() => openClaim(id, action)} title={title}
      className={className ?? "text-left text-xs font-medium text-foreground hover:text-primary hover:underline"}>
      {children}
    </button>
  );
}
