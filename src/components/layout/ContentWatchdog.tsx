"use client";

/**
 * A safety net for a page that never arrives (We Care, 2026-11-21: "sometimes
 * the reports page doesn't open" — the shell rendered, the content area stayed
 * empty, no error screen).
 *
 * Two cases, each answered with ONE reload of the page:
 *  1. The content area is still empty a few seconds after the page opened —
 *     no text, no loading skeleton, no error screen. The streamed page body
 *     never landed (a busy/restarting server, a hydration retry that stalled).
 *  2. A piece of the app failed to download (ChunkLoadError / "Failed to fetch
 *     dynamically imported module") — a tab still running the previous build
 *     after a deploy asks for files the new build no longer has.
 *
 * A page reloads at most once a minute (sessionStorage), so a page that is
 * genuinely empty can never loop.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "aina:content-watchdog";
const WINDOW_MS = 60_000;

function reloadOnce(reason: string) {
  try {
    const path = location.pathname;
    const raw = sessionStorage.getItem(KEY);
    const last = raw ? (JSON.parse(raw) as { path: string; at: number }) : null;
    if (last && last.path === path && Date.now() - last.at < WINDOW_MS) return;
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now(), reason }));
  } catch {
    // No sessionStorage (private mode): still reload, the browser itself stops a tight loop.
  }
  location.reload();
}

/** The content area shows something: text, a loading skeleton, or an error/notice screen. */
function contentShowsSomething(el: Element): boolean {
  if ((el as HTMLElement).innerText?.trim()) return true;
  return !!el.querySelector('[aria-busy="true"], .animate-pulse, img, svg, canvas, iframe, table, input');
}

const CHUNK_ERROR = /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function ContentWatchdog() {
  const pathname = usePathname();

  useEffect(() => {
    const timers = [5000, 10000].map((ms) =>
      setTimeout(() => {
        const el = document.querySelector(".dashboard-content");
        if (el && !contentShowsSomething(el)) reloadOnce(`empty content after ${ms}ms`);
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [pathname]);

  useEffect(() => {
    const isChunk = (v: unknown) => {
      const s = v instanceof Error ? `${v.name} ${v.message}` : typeof v === "string" ? v : "";
      return CHUNK_ERROR.test(s);
    };
    const onError = (e: ErrorEvent) => {
      if (isChunk(e.error) || isChunk(e.message)) reloadOnce("chunk load error");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunk(e.reason)) reloadOnce("chunk load error");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
