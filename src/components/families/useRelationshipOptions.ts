"use client";

import { useEffect, useState } from "react";

/**
 * The firm's relationship list (Settings → Family), for every picker that
 * asks "how is this person related?". Three components kept their own copy of
 * this list and never saw a relationship the firm added or renamed.
 *
 * `includeHead` keeps "Self / Head" in the list — the family page's role
 * select wants it (choosing it makes that member the head); pickers that add
 * a member to an existing family usually do not.
 */
export const FALLBACK_RELATIONSHIPS: [string, string][] = [
  ["self", "Self / Head"],
  ["spouse", "Spouse"],
  ["son", "Son"],
  ["daughter", "Daughter"],
  ["father", "Father"],
  ["mother", "Mother"],
  ["sibling", "Sibling"],
  ["huf_karta", "HUF Karta"],
  ["huf_coparcener", "HUF Co-parcener"],
  ["minor", "Minor"],
  ["other", "Other"],
];

// One request per page, shared by every picker on it (a family page draws one
// per member), so they never disagree while it loads.
let cache: [string, string][] | null = null;
let inflight: Promise<[string, string][] | null> | null = null;

function loadOptions() {
  inflight ??= fetch("/api/families/relationship-types")
    .then((r) => r.json())
    .then((j) => {
      if (!Array.isArray(j?.types) || !j.types.length) return null;
      cache = j.types.map((t: any) => [String(t.key), String(t.label)] as [string, string]);
      return cache;
    })
    .catch(() => null);
  return inflight;
}

export function useRelationshipOptions({ includeHead = false }: { includeHead?: boolean } = {}) {
  const [all, setAll] = useState<[string, string][]>(cache ?? FALLBACK_RELATIONSHIPS);

  useEffect(() => {
    if (cache) return;
    let dead = false;
    loadOptions().then((opts) => {
      if (!dead && opts) setAll(opts);
    });
    return () => {
      dead = true;
    };
  }, []);

  return includeHead ? all : all.filter(([k]) => k !== "self" && k !== "head" && k !== "primary");
}
