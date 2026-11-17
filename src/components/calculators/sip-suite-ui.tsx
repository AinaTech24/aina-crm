"use client";

/**
 * Small form pieces shared by the SIP & lumpsum suite calculators
 * (math: src/lib/calculators/sip-suite.ts): the client-name field, the
 * optional second return scenario, the summary / year-wise report switch and
 * the chart series colours. Presentation only.
 */

import type React from "react";
import { CHART_SERIES } from "@/lib/dashboard/chart-palette";
import { ClientNameField } from "./ClientNameField";
import { Field, NumberField, Segmented, Toggle } from "./ui";

/** Series colours for scenario 1, scenario 2, then any third line. */
export const SUITE_COLORS = [CHART_SERIES[1], CHART_SERIES[2], CHART_SERIES[3]] as const;

export type ReportView = "summary" | "detailed";

export function ClientField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Client name (optional)">
      <ClientNameField value={value} onChange={onChange} />
    </Field>
  );
}

/** Scenario 1 rate + "compare a second scenario" toggle and its rate. */
export function ScenarioFields({
  r1, setR1, useR2, setUseR2, r2, setR2,
}: {
  r1: number; setR1: (v: number) => void;
  useR2: boolean; setUseR2: (v: boolean) => void;
  r2: number; setR2: (v: number) => void;
}) {
  return (
    <>
      <NumberField label="Return, scenario 1 (%)" value={r1} setValue={setR1} step={0.5} />
      <div className="flex flex-col justify-end gap-1">
        <Toggle checked={useR2} onChange={setUseR2} label="Compare scenario 2" />
        {useR2 && <NumberField label="Return, scenario 2 (%)" value={r2} setValue={setR2} step={0.5} />}
      </div>
    </>
  );
}

export function ReportSwitch({ value, onChange }: { value: ReportView; onChange: (v: ReportView) => void }) {
  return (
    <Segmented
      label="Report"
      value={value}
      onChange={onChange}
      options={[
        { value: "summary", label: "Summary" },
        { value: "detailed", label: "Year-wise detail" },
      ]}
    />
  );
}

/** "Prepared for …" line, shown only when a name is entered. */
export function PreparedFor({ name, children }: { name: string; children?: React.ReactNode }) {
  if (!name.trim()) return null;
  return (
    <div className="text-sm font-medium">
      Prepared for <span className="text-primary">{name}</span>
      {children ? <> · {children}</> : null}
    </div>
  );
}

/** Scrollable wrapper for a long year-wise table (expands when printed). */
export function YearTableWrap({ children }: { children: React.ReactNode }) {
  return <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">{children}</div>;
}
