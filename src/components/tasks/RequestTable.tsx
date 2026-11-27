"use client";

/**
 * The request table on the New task form (flag `taskRequestTable`) — a
 * Zoho-style subform: one row per request of the task's type (Financial,
 * Non-financial or Insurance — the type picks the list), each row for the
 * client or a member of their family. Only the columns the rows' requests use
 * are drawn; in a row whose request does not use a drawn column the cell
 * shows "—".
 * The rules (columns per request, task type, checklist, title) live in
 * lib/tasks/request-lines; this file only draws and edits the rows.
 *
 * Every select is native (ThemeSelect) and the scheme search floats, so
 * nothing is clipped by the table's horizontal scroll.
 */

import { Copy, Plus, Trash2 } from "lucide-react";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";
import { formatMoney } from "@/lib/format";
import { FREQUENCIES, REQUEST_TYPE_BY_KEY, requestTypesFor, type RequestType, type TaskCategory } from "@/lib/tasks/request-types";
import { lineColumnLabel, lineColumns, modeOptions, type LineMode } from "@/lib/tasks/request-lines";

export type RequestCategory = Exclude<TaskCategory, "general">;
type LineColumn = ReturnType<typeof lineColumns> extends Set<infer C> ? C : never;

/** A row as edited (strings, so a half-typed number survives). */
export type LineValues = {
  key: string;
  investorId: string;
  requestKey: string;
  schemeCode: string;
  schemeName: string;
  amcName: string;
  assetCategory: string;
  fromSchemeCode: string;
  fromSchemeName: string;
  amount: string;
  units: string;
  allUnits: boolean;
  folio: string;
  sipDay: string;
  frequency: string;
  mode: "" | LineMode;
  note: string;
};

export type FamilyMember = { id: string; name: string; role: string; isSelf: boolean };

let seq = 0;
export const emptyLine = (investorId = "", requestKey = ""): LineValues => ({
  key: `l${++seq}`,
  investorId,
  requestKey,
  schemeCode: "",
  schemeName: "",
  amcName: "",
  assetCategory: "",
  fromSchemeCode: "",
  fromSchemeName: "",
  amount: "",
  units: "",
  allUnits: false,
  folio: "",
  sipDay: "",
  frequency: "monthly",
  mode: "",
  note: "",
});

/** Parse a typed rupee / unit figure ("5,00,000" → 500000); null when blank or bad. */
export const lineNum = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const DAYS: [string, string][] = [["", "—"], ...Array.from({ length: 28 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])];
const CELL = "h-8 py-0 text-xs";
const NA = <span className="block px-1 text-xs text-muted-foreground">—</span>;

export function RequestTable({
  lines,
  members,
  category,
  onChange,
}: {
  lines: LineValues[];
  /** The client and their family; more than one adds the Member column. */
  members: FamilyMember[];
  /** The task's type: only its requests are offered. */
  category: RequestCategory;
  onChange: (lines: LineValues[]) => void;
}) {
  const family = members.length > 1;
  const defaultMember = members.find((m) => m.isSelf)?.id ?? members[0]?.id ?? "";
  const setLine = (i: number, patch: Partial<LineValues>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (lineNum(l.amount) ?? 0), 0);
  const options = requestTypesFor(category);

  // Only the columns some row's request uses.
  const picked = lines.map((l) => REQUEST_TYPE_BY_KEY[l.requestKey]).filter((r): r is RequestType => !!r);
  const used = new Set<LineColumn>(picked.flatMap((r) => [...lineColumns(r)]));
  const show = {
    scheme: used.has("scheme") || used.has("fromScheme"),
    amount: used.has("amount") || used.has("units"),
    day: used.has("sipDay") || used.has("frequency"),
    folio: used.has("folio"),
    mode: used.has("mode"),
  };
  /** One request's own label when every row using the column agrees, else the general one. */
  const head = (c: LineColumn, general: string) => {
    const labels = new Set(picked.filter((r) => lineColumns(r).has(c)).map((r) => lineColumnLabel(c, r)));
    return labels.size === 1 ? [...labels][0] : general;
  };
  const amountHead = [used.has("amount") ? `${head("amount", "Amount")} (₹)` : "", used.has("units") ? "units" : ""].filter(Boolean).join(" / ");
  const dayHead = [used.has("sipDay") ? head("sipDay", "Day") : "", used.has("frequency") ? "frequency" : ""].filter(Boolean).join(" · ");
  const minWidth =
    360 + (family ? 160 : 0) + (show.scheme ? 280 : 0) + (show.amount ? 140 : 0) + (show.day ? 180 : 0) + (show.folio ? 140 : 0) + (show.mode ? 140 : 0);
  /** Columns left of Amount, and right of it, for the total row. */
  const beforeAmount = 2 + (family ? 1 : 0) + (show.scheme ? 1 : 0);
  const afterAmount = 2 + (show.day ? 1 : 0) + (show.folio ? 1 : 0) + (show.mode ? 1 : 0);

  /** A new request keeps the row's member and drops what the request does not use. */
  const changeRequest = (i: number, key: string) => {
    const req = REQUEST_TYPE_BY_KEY[key];
    const cols = lineColumns(req);
    const l = lines[i];
    setLine(i, {
      requestKey: key,
      ...(cols.has("scheme") ? {} : { schemeName: "", schemeCode: "", amcName: "", assetCategory: "" }),
      ...(cols.has("fromScheme") ? {} : { fromSchemeName: "", fromSchemeCode: "" }),
      ...(cols.has("units") ? {} : { units: "", allUnits: false }),
      ...(cols.has("sipDay") ? {} : { sipDay: "" }),
      ...(cols.has("frequency") ? { frequency: l.frequency || "monthly" } : {}),
      ...(cols.has("amount") ? {} : { amount: "" }),
      ...(cols.has("folio") ? {} : { folio: "" }),
      // Online/Offline and Online/Physical KYC are different choices.
      mode: cols.has("mode") && modeOptions(key).some(([m]) => m === l.mode) ? l.mode : "",
      // A PMS / AIF name is typed, a mutual fund is picked: never carry one into the other.
      ...(req && REQUEST_TYPE_BY_KEY[l.requestKey] && (req.catalog === false) !== (REQUEST_TYPE_BY_KEY[l.requestKey].catalog === false)
        ? { schemeName: "", schemeCode: "", amcName: "", assetCategory: "" }
        : {}),
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">
          Requests <span className="text-destructive">*</span>
          <span className="ml-1.5 font-normal text-muted-foreground">
            · one row per {category === "financial" ? "transaction" : category === "insurance" ? "insurance request" : "service request"}
            {family ? ", for anyone in the family" : ""}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="table-raw w-full border-collapse text-xs" style={{ minWidth }}>
          <thead className="bg-secondary/60 text-left text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 font-medium">#</th>
              {family && <th className="w-40 px-2 py-2 font-medium">Member</th>}
              <th className="w-48 px-2 py-2 font-medium">Request</th>
              {show.scheme && (
                <th className="px-2 py-2 font-medium" style={{ minWidth: 260 }}>
                  {head("scheme", "Scheme / product")}
                </th>
              )}
              {show.amount && <th className="w-32 px-2 py-2 font-medium">{amountHead}</th>}
              {show.day && <th className="w-44 px-2 py-2 font-medium">{dayHead}</th>}
              {show.folio && <th className="w-32 px-2 py-2 font-medium">{head("folio", category === "insurance" ? "Policy no." : "Folio")}</th>}
              {show.mode && <th className="w-32 px-2 py-2 font-medium">{head("mode", "Mode")}</th>}
              <th className="w-44 px-2 py-2 font-medium">Note</th>
              <th className="relative w-16 px-2 py-2"><span className="sr-only">Row actions</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const req = REQUEST_TYPE_BY_KEY[l.requestKey];
              const cols = lineColumns(req);
              return (
                <tr key={l.key} className="border-t border-border align-top">
                  <td className="px-2 py-2 pt-3.5 text-muted-foreground tabular-nums">{i + 1}</td>
                  {family && (
                    <td className="px-2 py-1.5">
                      <ThemeSelect value={l.investorId || defaultMember} onChange={(v) => setLine(i, { investorId: v })} className={CELL} aria-label={`Row ${i + 1} member`}>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.role && m.role !== "—" ? ` (${m.role})` : ""}
                          </option>
                        ))}
                      </ThemeSelect>
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <ThemeSelect value={l.requestKey} onChange={(v) => changeRequest(i, v)} className={CELL} aria-label={`Row ${i + 1} request`}>
                      <option value="">Select…</option>
                      {options.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </ThemeSelect>
                  </td>
                  {show.scheme && <td className="px-2 py-1.5">
                    {cols.has("scheme") || cols.has("fromScheme") ? (
                      <div className="space-y-1.5">
                        {cols.has("fromScheme") && <SchemeCell which="fromScheme" req={req!} line={l} row={i} onChange={(p) => setLine(i, p)} />}
                        {cols.has("scheme") && <SchemeCell which="scheme" req={req!} line={l} row={i} onChange={(p) => setLine(i, p)} />}
                      </div>
                    ) : (
                      NA
                    )}
                  </td>}
                  {show.amount && <td className="px-2 py-1.5">
                    {cols.has("amount") || cols.has("units") ? (
                      <div className="space-y-1.5">
                        {cols.has("amount") && (
                          <input
                            value={l.amount}
                            onChange={(e) => setLine(i, { amount: e.target.value })}
                            inputMode="decimal"
                            placeholder={lineColumnLabel("amount", req)}
                            aria-label={`Row ${i + 1} ${lineColumnLabel("amount", req)}`}
                            className={`input-base ${CELL} text-right tabular-nums`}
                          />
                        )}
                        {cols.has("units") && (
                          <div className="flex items-center gap-1.5">
                            <input
                              value={l.units}
                              onChange={(e) => setLine(i, { units: e.target.value })}
                              disabled={l.allUnits}
                              inputMode="decimal"
                              placeholder="Units"
                              aria-label={`Row ${i + 1} units`}
                              className={`input-base ${CELL} min-w-0 flex-1 text-right tabular-nums`}
                            />
                            <label className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs" title="All units">
                              <input type="checkbox" checked={l.allUnits} onChange={(e) => setLine(i, { allUnits: e.target.checked })} />
                              All
                            </label>
                          </div>
                        )}
                      </div>
                    ) : (
                      NA
                    )}
                  </td>}
                  {show.day && <td className="px-2 py-1.5">
                    {cols.has("sipDay") || cols.has("frequency") ? (
                      <div className="flex gap-1.5">
                        {cols.has("sipDay") && (
                          <ThemeSelect value={l.sipDay} onChange={(v) => setLine(i, { sipDay: v })} options={DAYS} className={`${CELL} pr-7`} wrapperClassName="w-16 shrink-0" aria-label={`Row ${i + 1} ${lineColumnLabel("sipDay", req)}`} />
                        )}
                        {cols.has("frequency") && (
                          <ThemeSelect value={l.frequency} onChange={(v) => setLine(i, { frequency: v })} options={FREQUENCIES} className={`${CELL} pr-7`} wrapperClassName="min-w-0 flex-1" aria-label={`Row ${i + 1} frequency`} />
                        )}
                      </div>
                    ) : (
                      NA
                    )}
                  </td>}
                  {show.folio && <td className="px-2 py-1.5">
                    {cols.has("folio") ? (
                      <input
                        value={l.folio}
                        onChange={(e) => setLine(i, { folio: e.target.value })}
                        maxLength={60}
                        placeholder={lineColumnLabel("folio", req)}
                        aria-label={`Row ${i + 1} ${lineColumnLabel("folio", req)}`}
                        className={`input-base ${CELL}`}
                      />
                    ) : (
                      NA
                    )}
                  </td>}
                  {show.mode && <td className="px-2 py-1.5">
                    {cols.has("mode") ? (
                      <ThemeSelect value={l.mode} onChange={(v) => setLine(i, { mode: v as LineValues["mode"] })} className={CELL} aria-label={`Row ${i + 1} ${lineColumnLabel("mode", req)}`}>
                        <option value="">{req?.key === "kyc_renewal" ? "Which KYC?" : "Not set"}</option>
                        {modeOptions(l.requestKey).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </ThemeSelect>
                    ) : (
                      NA
                    )}
                  </td>}
                  <td className="px-2 py-1.5">
                    <input
                      value={l.note}
                      onChange={(e) => setLine(i, { note: e.target.value })}
                      maxLength={300}
                      placeholder="Optional"
                      aria-label={`Row ${i + 1} note`}
                      className={`input-base ${CELL}`}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <div className="flex items-center">
                      <button
                        type="button"
                        className="btn-icon text-muted-foreground"
                        title="Copy this row"
                        aria-label={`Copy row ${i + 1}`}
                        onClick={() => onChange([...lines.slice(0, i + 1), { ...l, key: emptyLine().key }, ...lines.slice(i + 1)])}
                      >
                        <Copy className="size-3.5" />
                      </button>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn-icon text-muted-foreground hover:text-destructive"
                          title="Remove this row"
                          aria-label={`Remove row ${i + 1}`}
                          onClick={() => onChange(lines.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {total > 0 && show.amount && (
            <tfoot>
              <tr className="border-t border-border bg-secondary/40 font-medium">
                <td className="px-2 py-2" colSpan={beforeAmount}>
                  Total
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(total)}</td>
                <td colSpan={afterAmount} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <button
        type="button"
        onClick={() => onChange([...lines, emptyLine(lines[lines.length - 1]?.investorId || defaultMember)])}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <Plus className="size-3.5" /> Add row
      </button>
    </div>
  );
}

function SchemeCell({
  which,
  req,
  line,
  row,
  onChange,
}: {
  which: "scheme" | "fromScheme";
  req: RequestType;
  line: LineValues;
  row: number;
  onChange: (p: Partial<LineValues>) => void;
}) {
  const name = which === "scheme" ? line.schemeName : line.fromSchemeName;
  const label = lineColumnLabel(which, req);
  if (req.catalog === false) {
    return (
      <input
        value={name}
        onChange={(e) => onChange({ schemeName: e.target.value, schemeCode: "" })}
        maxLength={250}
        placeholder={req.key === "aif" ? "AIF name" : "PMS strategy / provider"}
        aria-label={`Row ${row + 1} ${label}`}
        className={`input-base ${CELL}`}
      />
    );
  }
  return (
    <div>
      {req.rowFields.includes("fromScheme") && <div className="mb-0.5 text-2xs text-muted-foreground">{label}</div>}
      <SchemeAutocomplete
        size="sm"
        floating
        defaultValue={name}
        placeholder="Search schemes…"
        onClear={() =>
          onChange(which === "scheme" ? { schemeName: "", schemeCode: "", amcName: "", assetCategory: "" } : { fromSchemeName: "", fromSchemeCode: "" })
        }
        onSelect={(s) =>
          onChange(
            which === "scheme"
              ? { schemeName: s.schemeName, schemeCode: s.schemeCode, amcName: s.amc ?? "", assetCategory: s.category ?? "" }
              : { fromSchemeName: s.schemeName, fromSchemeCode: s.schemeCode },
          )
        }
      />
    </div>
  );
}
