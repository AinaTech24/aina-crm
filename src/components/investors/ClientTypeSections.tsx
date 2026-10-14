"use client";

/**
 * The client-master sections a client's TYPE brings (lib/investors/client-types.ts):
 *
 *   Minor              Guardian — and the day the minor turns 18
 *   HUF                Karta, the date the HUF was formed, coparceners
 *   Company · LLP ·    Entity details, authorised signatories,
 *   Partnership ·      beneficial owners
 *   Trust · Society
 *   NRI                Overseas details
 *   Sole proprietor    Business name
 *
 * and Nomination: nominees (or a recorded opt-out) for an individual, and a
 * plain "not available" for everyone else — only individual holders can
 * nominate. Shared by the Add client form and the client details editor.
 */

import { Plus, Trash2 } from "lucide-react";
import { Field, FieldSection } from "@/components/ui/Field";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { Button } from "@/components/ui/Button";
import { NomineesField } from "@/components/investors/NomineesField";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { ownPan } from "@/lib/investors/pan-display";
import { formatDate } from "@/lib/format";
import type { Nominee } from "@/lib/investors/nominee";
import {
  FATCA_ENTITY_CLASSES, GUARDIAN_RELATIONS, NRI_ACCOUNT_TYPES,
  BUSINESS_NATURES, COPARCENER_RELATIONS, SIGNATORY_DESIGNATIONS, withCurrent,
  canNominate, clientTypeDef, clientTypeLabel, majorityDate, type ClientTypeDetails,
} from "@/lib/investors/client-types";
import { COUNTRIES, canonicalCountry } from "@/lib/geo/places";

const input = "input-base w-full";
const panInput = `${input} font-mono uppercase tracking-wide`;
const panValue = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

/** The guardian's own client record, when they are a client (migration 0234:
 *  the minor then carries the guardian's risk profile). */
export type GuardianLink = { id: string | null; name: string | null; riskProfile?: string | null; hidden?: boolean };

/** What the form says for a linked guardian the user may not open (G-1). */
export const HIDDEN_GUARDIAN_LABEL = "A client outside your book";

export function ClientTypeSections({
  type, value, onChange, dob, nominees, onNomineesChange, showNominees = true, guardianLink, onGuardianLinkChange,
}: {
  guardianLink?: GuardianLink;
  onGuardianLinkChange?: (g: GuardianLink) => void;
  type: string;
  value: ClientTypeDetails;
  onChange: (v: ClientTypeDetails) => void;
  /** The client's date of birth — a minor's turns-18 date comes from it. */
  dob?: string;
  nominees: Nominee[];
  onNomineesChange: (n: Nominee[]) => void;
  /** The editor hides nominees when the firm's field settings do. */
  showNominees?: boolean;
}) {
  const def = clientTypeDef(type);
  const set = <K extends keyof ClientTypeDetails>(k: K, v: ClientTypeDetails[K]) => onChange({ ...value, [k]: v });
  const sub = <K extends "guardian" | "karta" | "entity" | "nri">(k: K, patch: Partial<NonNullable<ClientTypeDetails[K]>>) =>
    onChange({ ...value, [k]: { ...(value[k] ?? {}), ...patch } });

  const turns18 = def.kind === "minor" ? majorityDate(dob) : null;

  return (
    <>
      {def.kind === "minor" && (
        <FieldSection title="Guardian">
          {onGuardianLinkChange && (
            <Field label="Guardian's client record" className="sm:col-span-2"
              hint="Pick the guardian if they are a client — their details fill in. The minor's own risk profile is recorded for the minor's account.">
              {(id, d) => (
                <div id={id} aria-describedby={d}>
                  <InvestorLookup
                    value={guardianLink?.id ?? null}
                    displayName={guardianLink?.hidden ? HIDDEN_GUARDIAN_LABEL : guardianLink?.name ?? null}
                    placeholder="Search the guardian by name, PAN, mobile…"
                    onClear={() => onGuardianLinkChange({ id: null, name: null, riskProfile: null })}
                    onSelect={async (gid, gname) => {
                      onGuardianLinkChange({ id: gid, name: gname });
                      const r = await fetch(`/api/investors/${gid}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
                      const g = r?.investor;
                      if (!g) return;
                      onGuardianLinkChange({ id: gid, name: gname, riskProfile: g.riskProfile ?? null });
                      onChange({
                        ...value,
                        guardian: {
                          ...(value.guardian ?? {}),
                          name: g.name ?? gname,
                          pan: ownPan(g.pan) ?? value.guardian?.pan ?? "",
                          dob: g.dob ? String(g.dob).slice(0, 10) : value.guardian?.dob ?? "",
                          mobile: g.phone ?? value.guardian?.mobile ?? "",
                          email: g.email ?? value.guardian?.email ?? "",
                        },
                      });
                    }}
                  />
                </div>
              )}
            </Field>
          )}
          <Field label="Guardian's name" required>
            {(id, d) => <input id={id} aria-describedby={d} value={value.guardian?.name ?? ""} onChange={(e) => sub("guardian", { name: e.target.value })} className={input} />}
          </Field>
          <Field label="Guardian's PAN" required>
            {(id, d) => <input id={id} aria-describedby={d} value={value.guardian?.pan ?? ""} onChange={(e) => sub("guardian", { pan: panValue(e.target.value) })} placeholder="ABCDE1234F" className={panInput} />}
          </Field>
          <Field label="Relationship to the minor">
            {(id) => (
              <SelectField id={id} value={value.guardian?.relation ?? ""} onChange={(e) => sub("guardian", { relation: e.target.value as any })} className="w-full" placeholder="Select">
                <option value="">Select</option>
                {GUARDIAN_RELATIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </SelectField>
            )}
          </Field>
          <Field label="Guardian's date of birth">
            {(id) => <DateField id={id} value={value.guardian?.dob ?? ""} onChange={(e) => sub("guardian", { dob: e.target.value })} className="w-full" />}
          </Field>
          <Field label="Guardian's mobile">
            {(id) => <input id={id} value={value.guardian?.mobile ?? ""} onChange={(e) => sub("guardian", { mobile: e.target.value })} inputMode="tel" className={input} />}
          </Field>
          <Field label="Guardian's email">
            {(id) => <input id={id} value={value.guardian?.email ?? ""} onChange={(e) => sub("guardian", { email: e.target.value })} inputMode="email" className={input} />}
          </Field>
          {turns18 && (
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Turns 18 on <span className="font-medium text-foreground">{formatDate(turns18)}</span> — then change the client type to Individual, with their own KYC and bank account.
            </p>
          )}
        </FieldSection>
      )}

      {def.kind === "huf" && (
        <>
          <FieldSection title="Karta">
            <Field label="Karta's name" required>
              {(id, d) => <input id={id} aria-describedby={d} value={value.karta?.name ?? ""} onChange={(e) => sub("karta", { name: e.target.value })} className={input} />}
            </Field>
            <Field label="Karta's PAN">
              {(id) => <input id={id} value={value.karta?.pan ?? ""} onChange={(e) => sub("karta", { pan: panValue(e.target.value) })} placeholder="ABCDE1234F" className={panInput} />}
            </Field>
            <Field label="Karta's date of birth">
              {(id) => <DateField id={id} value={value.karta?.dob ?? ""} onChange={(e) => sub("karta", { dob: e.target.value })} className="w-full" />}
            </Field>
            <Field label="Date the HUF was formed">
              {(id) => <DateField id={id} value={value.entity?.formedOn ?? ""} onChange={(e) => sub("entity", { formedOn: e.target.value })} className="w-full" />}
            </Field>
            <Field label="Karta's mobile">
              {(id) => <input id={id} value={value.karta?.mobile ?? ""} onChange={(e) => sub("karta", { mobile: e.target.value })} inputMode="tel" className={input} />}
            </Field>
            <Field label="Karta's email">
              {(id) => <input id={id} value={value.karta?.email ?? ""} onChange={(e) => sub("karta", { email: e.target.value })} inputMode="email" className={input} />}
            </Field>
          </FieldSection>
          <FieldSection title="Coparceners">
            <Rows
              rows={value.coparceners ?? []}
              onChange={(r) => set("coparceners", r)}
              blank={{ name: "", relation: "", dob: "" }}
              addLabel="Add coparcener"
              cols={[
                { key: "name", label: "Name", grow: true },
                { key: "relation", label: "Relation to Karta", width: "sm:w-44", options: COPARCENER_RELATIONS },
                { key: "dob", label: "Date of birth", date: true, width: "sm:w-44" },
              ]}
            />
          </FieldSection>
        </>
      )}

      {def.kind === "entity" && (
        <>
          <FieldSection title="Entity details">
            <Field label={def.formedLabel ?? "Date of incorporation"}>
              {(id) => <DateField id={id} value={value.entity?.formedOn ?? ""} onChange={(e) => sub("entity", { formedOn: e.target.value })} className="w-full" />}
            </Field>
            <Field label={def.registrationLabel ?? "Registration no."}>
              {(id) => <input id={id} value={value.entity?.registrationNo ?? ""} onChange={(e) => sub("entity", { registrationNo: e.target.value })} className={`${input} font-mono`} />}
            </Field>
            <Field label="Place of incorporation">
              {(id) => <input id={id} value={value.entity?.placeOfIncorporation ?? ""} onChange={(e) => sub("entity", { placeOfIncorporation: e.target.value })} className={input} />}
            </Field>
            <Field label="Nature of business">
              {(id) => (
                <SelectField id={id} value={value.entity?.natureOfBusiness ?? ""} onChange={(e) => sub("entity", { natureOfBusiness: e.target.value })} className="w-full" placeholder="Select">
                  <option value="">Select</option>
                  {withCurrent(BUSINESS_NATURES, value.entity?.natureOfBusiness).map((b) => <option key={b} value={b}>{b}</option>)}
                </SelectField>
              )}
            </Field>
            <Field label="Net worth (₹)">
              {(id) => <input id={id} value={String(value.entity?.netWorth ?? "")} onChange={(e) => sub("entity", { netWorth: e.target.value.replace(/[^0-9.]/g, "") as any })} inputMode="decimal" className={input} />}
            </Field>
            <Field label="Net worth as on">
              {(id) => <DateField id={id} value={value.entity?.netWorthAsOn ?? ""} onChange={(e) => sub("entity", { netWorthAsOn: e.target.value })} className="w-full" />}
            </Field>
            <Field label="FATCA / CRS classification">
              {(id) => (
                <SelectField id={id} value={value.entity?.fatcaClass ?? ""} onChange={(e) => sub("entity", { fatcaClass: e.target.value as any })} className="w-full" placeholder="Select">
                  <option value="">Select</option>
                  {FATCA_ENTITY_CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </SelectField>
              )}
            </Field>
            {value.entity?.fatcaClass === "financial_institution" && (
              <Field label="GIIN">
                {(id) => <input id={id} value={value.entity?.giin ?? ""} onChange={(e) => sub("entity", { giin: e.target.value.toUpperCase() })} className={`${input} font-mono`} />}
              </Field>
            )}
          </FieldSection>
          <FieldSection title="Authorised signatories">
            <Rows
              rows={value.signatories ?? []}
              onChange={(r) => set("signatories", r)}
              blank={{ name: "", pan: "", designation: "", mobile: "", email: "" }}
              addLabel="Add signatory"
              cols={[
                { key: "name", label: "Name", grow: true },
                { key: "pan", label: "PAN", pan: true, width: "sm:w-36" },
                { key: "designation", label: "Designation", width: "sm:w-44", options: SIGNATORY_DESIGNATIONS },
                { key: "mobile", label: "Mobile", width: "sm:w-36" },
                { key: "email", label: "Email", width: "sm:w-48" },
              ]}
            />
          </FieldSection>
          <FieldSection title="Beneficial owners">
            <Rows
              rows={value.ubos ?? []}
              onChange={(r) => set("ubos", r)}
              blank={{ name: "", pan: "", holdingPct: "" }}
              addLabel="Add beneficial owner"
              hint="Everyone who owns or controls more than 10%."
              cols={[
                { key: "name", label: "Name", grow: true },
                { key: "pan", label: "PAN", pan: true, width: "sm:w-36" },
                { key: "holdingPct", label: "Holding %", numeric: true, width: "sm:w-28" },
              ]}
            />
          </FieldSection>
        </>
      )}

      {type === "nri" && (
        <FieldSection title="Overseas details">
          <Field label="Country of residence">
            {(id) => (
              <SelectField id={id} value={canonicalCountry(value.nri?.countryOfResidence) ?? value.nri?.countryOfResidence ?? ""} onChange={(e) => sub("nri", { countryOfResidence: e.target.value })} className="w-full" placeholder="Select" searchable>
                <option value="">Select</option>
                {withCurrent(COUNTRIES, canonicalCountry(value.nri?.countryOfResidence) ?? value.nri?.countryOfResidence).map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectField>
            )}
          </Field>
          <Field label="Bank account type">
            {(id) => (
              <SelectField id={id} value={value.nri?.accountType ?? ""} onChange={(e) => sub("nri", { accountType: e.target.value as any })} className="w-full" placeholder="Select">
                <option value="">Select</option>
                {NRI_ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </SelectField>
            )}
          </Field>
          <Field label="Overseas address" className="sm:col-span-2">
            {(id) => <input id={id} value={value.nri?.overseasAddress ?? ""} onChange={(e) => sub("nri", { overseasAddress: e.target.value })} className={input} />}
          </Field>
          <Field label="Country of tax residence">
            {(id) => (
              <SelectField id={id} value={canonicalCountry(value.nri?.taxResidencyCountry) ?? value.nri?.taxResidencyCountry ?? ""} onChange={(e) => sub("nri", { taxResidencyCountry: e.target.value })} className="w-full" placeholder="Select" searchable>
                <option value="">Select</option>
                {withCurrent(COUNTRIES, canonicalCountry(value.nri?.taxResidencyCountry) ?? value.nri?.taxResidencyCountry).map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectField>
            )}
          </Field>
          <Field label="Foreign tax ID (TIN)">
            {(id) => <input id={id} value={value.nri?.foreignTin ?? ""} onChange={(e) => sub("nri", { foreignTin: e.target.value })} className={`${input} font-mono`} />}
          </Field>
        </FieldSection>
      )}

      {type === "sole_proprietor" && (
        <FieldSection title="Business">
          <Field label="Business name" hint="The proprietorship invests in the proprietor's own name and PAN.">
            {(id, d) => <input id={id} aria-describedby={d} value={value.businessName ?? ""} onChange={(e) => set("businessName", e.target.value)} className={input} />}
          </Field>
        </FieldSection>
      )}

      {showNominees && (
        <FieldSection title="Nomination">
          {canNominate(type) ? (
            <div className="sm:col-span-2 space-y-3">
              <NomineesField value={nominees} onChange={onNomineesChange} />
              {nominees.every((n) => !(n.name ?? "").trim()) && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!value.nominationOptOut} onChange={(e) => set("nominationOptOut", e.target.checked)} />
                  The client chose not to nominate (opt-out declaration on record)
                </label>
              )}
            </div>
          ) : (
            <p className="sm:col-span-2 text-sm text-muted-foreground">
              Not available for {clientTypeLabel(type).replace(/ \(.*\)$/, "")} — only individual holders can nominate.
            </p>
          )}
        </FieldSection>
      )}
    </>
  );
}

/* ─────────────────────────────── row lists ─────────────────────────────── */

type Col = { key: string; label: string; grow?: boolean; width?: string; date?: boolean; pan?: boolean; numeric?: boolean; options?: string[] };

function Rows<T extends Record<string, any>>({ rows, onChange, blank, cols, addLabel, hint }: {
  rows: T[]; onChange: (r: T[]) => void; blank: T; cols: Col[]; addLabel: string; hint?: string;
}) {
  const patch = (i: number, k: string, v: string) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  return (
    <div className="sm:col-span-2 space-y-2">
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          {cols.map((c) => c.date ? (
            <div key={c.key} className={`min-w-0 basis-full sm:basis-auto sm:shrink-0 ${c.width ?? ""}`}>
              <DateField value={r[c.key] ?? ""} onChange={(e) => patch(i, c.key, e.target.value)} aria-label={c.label} className="w-full" />
            </div>
          ) : c.options ? (
            <div key={c.key} className={`min-w-0 basis-full sm:basis-auto sm:shrink-0 ${c.width ?? ""}`}>
              <SelectField value={r[c.key] ?? ""} onChange={(e) => patch(i, c.key, e.target.value)} aria-label={c.label} className="w-full" placeholder={c.label}>
                <option value="">{c.label}</option>
                {withCurrent(c.options, r[c.key]).map((o) => <option key={o} value={o}>{o}</option>)}
              </SelectField>
            </div>
          ) : (
            <input
              key={c.key}
              value={r[c.key] ?? ""}
              onChange={(e) => patch(i, c.key, c.pan ? panValue(e.target.value) : c.numeric ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)}
              placeholder={c.label}
              aria-label={c.label}
              inputMode={c.numeric ? "decimal" : undefined}
              className={`input-base min-w-0 ${c.grow ? "flex-1 basis-full sm:basis-auto" : `flex-1 sm:flex-none ${c.width ?? ""}`} ${c.pan ? "font-mono uppercase" : ""}`}
            />
          ))}
          <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="btn-icon text-muted-foreground hover:text-destructive" aria-label={`Remove ${addLabel.replace(/^Add /, "")}`}>
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, { ...blank }])}>
        <Plus className="size-3.5" /> {addLabel}
      </Button>
    </div>
  );
}
