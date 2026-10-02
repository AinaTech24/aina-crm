"use client";

/**
 * AmcSelect — the one AMC picker in the CRM. Lists the firm's AMC master
 * (GET /api/mf/amcs), so every AMC field picks from the Scheme Master module,
 * never free text. The value is the AMC's code, which is also its name in the
 * master and what scheme_master.amc_code holds — so a picked AMC can narrow a
 * SchemeAutocomplete (`amc` prop).
 *
 * A value saved before this picker existed (free-typed) stays visible and
 * selected, marked "not in AMC master", so opening an old record never
 * silently changes it.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { SelectField } from "@/components/ui/SelectField";
import { MultiSelectField } from "@/components/ui/MultiSelectField";

type Amc = { code: string; name: string; schemes: number };

let cache: Promise<{ amcs: Amc[]; masterEmpty: boolean }> | null = null;
function loadAmcs() {
  if (!cache) {
    cache = fetch("/api/mf/amcs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => ({ amcs: Array.isArray(j.amcs) ? j.amcs : [], masterEmpty: !!j.masterEmpty }))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

export function AmcSelect({
  value,
  onChange,
  id,
  className = "w-full",
  placeholder = "Select AMC…",
  disabled,
  "aria-describedby": describedBy,
  "aria-label": ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (amc: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const [amcs, setAmcs] = useState<Amc[] | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let live = true;
    loadAmcs().then((d) => { if (live) { setAmcs(d.amcs); setEmpty(d.masterEmpty); } }).catch(() => live && setAmcs([]));
    return () => { live = false; };
  }, []);

  const v = value ?? "";
  // Match a saved value to the master by code or name, ignoring case.
  const match = amcs?.find((a) => a.code.toLowerCase() === v.toLowerCase() || a.name.toLowerCase() === v.toLowerCase());
  const legacy = v && amcs && !match ? v : null;

  return (
    <div>
      <SelectField
        id={id}
        aria-label={ariaLabel ?? (describedBy ? undefined : "AMC")}
        value={match ? match.code : v}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        disabled={disabled || amcs === null}
        searchable
        searchPlaceholder="Search AMCs…"
      >
        <option value="">{amcs === null ? "Loading AMCs…" : placeholder}</option>
        {legacy && <option value={legacy}>{legacy} (not in AMC master)</option>}
        {(amcs ?? []).map((a) => (
          <option key={a.code} value={a.code}>{a.name}</option>
        ))}
      </SelectField>
      {empty && (
        <p className="mt-1 text-2xs text-muted-foreground">
          Your AMC master is empty. <Link href="/dashboard/schemes" className="font-medium text-foreground underline">Open Scheme Master</Link> and sync it from AMFI.
        </p>
      )}
    </div>
  );
}

/**
 * AmcMultiSelect — several AMCs at once (a team member's distributing AMCs),
 * from the same AMC master. Values saved before as free text stay selected,
 * marked "not in AMC master", until someone removes them.
 */
export function AmcMultiSelect({
  values,
  onChange,
  id,
  placeholder = "Select AMCs…",
}: {
  values: string[];
  onChange: (v: string[]) => void;
  id?: string;
  placeholder?: string;
}) {
  const [amcs, setAmcs] = useState<Amc[] | null>(null);
  useEffect(() => {
    let live = true;
    loadAmcs().then((d) => live && setAmcs(d.amcs)).catch(() => live && setAmcs([]));
    return () => { live = false; };
  }, []);
  const known = new Set((amcs ?? []).map((a) => a.code));
  const options = [
    ...values.filter((v) => amcs && !known.has(v)).map((v) => ({ value: v, label: `${v} (not in AMC master)` })),
    ...(amcs ?? []).map((a) => ({ value: a.code, label: a.name })),
  ];
  return <MultiSelectField id={id} values={values} onChange={onChange} options={options} placeholder={amcs === null ? "Loading AMCs…" : placeholder} />;
}
