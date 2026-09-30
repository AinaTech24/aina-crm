"use client";

/**
 * A worklist row's quick actions (§4). Every change opens the claim drawer on
 * that action, so status, owner, follow-up and settlement are each edited in
 * one place with the claim in view. Documents and remarks are kept on the
 * claim page, so those two are links. Only what the viewer may do is offered.
 *
 * The menu is position: fixed, placed from the button: the worklist sits in a
 * horizontally scrolling box, which would clip an absolutely positioned menu
 * on the last rows. It closes on scroll rather than drift away from its row.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { openClaim, type ClaimAction } from "./ClaimLink";

const MENU_W = 192;

export function ClaimRowActions({ id, canWrite, canTask }: { id: string; canWrite: boolean; canTask: boolean }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos != null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const items = canWrite ? (canTask ? 7 : 6) : 1;
    const height = items * 30 + 8;
    const below = r.bottom + 4 + height <= window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)) });
  }
  const act = (a?: ClaimAction) => {
    setPos(null);
    openClaim(id, a);
  };
  const items: Array<{ key: string; label: string; run?: () => void; href?: string }> = [
    { key: "open", label: "Open claim", run: () => act() },
    ...(canWrite ? [
      { key: "status", label: "Change status", run: () => act("status") },
      { key: "assign", label: "Assign owner", run: () => act("assign") },
      ...(canTask ? [{ key: "follow-up", label: "Schedule follow-up", run: () => act("follow-up") }] : []),
      { key: "settle", label: "Record settlement", run: () => act("settle") },
      { key: "doc", label: "Add document", href: `/dashboard/insurance-claims/${id}#documents` },
      { key: "remark", label: "Add remark", href: `/dashboard/insurance-claims/new?edit=${id}` },
    ] : []),
  ];

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Claim actions" className="btn-icon">
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {pos && (
        <div ref={menuRef} role="menu" style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
          className="z-50 overflow-hidden rounded-lg border border-border bg-card py-1 text-left shadow-lg">
          {items.map((i) => i.href ? (
            <Link key={i.key} role="menuitem" href={i.href} className="block px-3 py-1.5 text-xs text-foreground hover:bg-accent">{i.label}</Link>
          ) : (
            <button key={i.key} role="menuitem" type="button" onClick={i.run} className="block w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent">{i.label}</button>
          ))}
        </div>
      )}
    </>
  );
}
