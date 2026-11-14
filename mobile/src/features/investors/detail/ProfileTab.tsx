/**
 * KYC & Profile tab — nominees, referrals, the full master record (identity /
 * contact / profile / compliance / second holder / bank groups), profile
 * completeness, captured KYC data, and risk-profile history.
 *
 * Each client type sees only its own fields (the CRM's rule of 2026-10-14):
 * personal fields for a person or minor, adult fields for an individual, the
 * type's own card (Guardian · Karta & coparceners · Entity · Overseas ·
 * Business), and Nominees only where the type can nominate.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { inr, fmtDate, titleCase } from "../../../lib/format";
import { Section, FieldRow, FieldGroup, Empty } from "./primitives";
import {
  canNominate, clientKind, clientTypeDef, clientTypeLabel, hasAdultDetails, hasPersonalDetails, majorityDate, ownPan,
  GUARDIAN_RELATIONS, FATCA_ENTITY_CLASSES, NRI_ACCOUNT_TYPES,
} from "../client-types";

const optLabel = (list: { value: string; label: string }[], v?: string | null) => (v ? list.find((o) => o.value === v)?.label ?? v : null);

export function ProfileTab({ d }: { d: any }) {
  const i = d.investor ?? {};
  const addr = i.address ?? {};
  const nominees: any[] = i.nominees?.length ? i.nominees : i.nomineeName ? [{ name: i.nomineeName, relation: i.nomineeRelation, dob: i.nomineeDob }] : [];
  const referrals: any[] = i.referrals ?? [];
  const banks: any[] = i.bankAccounts?.length ? i.bankAccounts : i.bankName ? [{ bankName: i.bankName, accountMasked: i.bankAccountNumberMasked, ifsc: i.bankIfsc }] : [];
  const kycData = i.kycData && typeof i.kycData === "object" ? Object.entries(i.kycData) : [];
  const comp = d.completeness ?? {};
  const type = i.investorCategory as string | undefined;
  const kind = clientKind(type);
  const td = i.typeDetails ?? {};
  const personal = hasPersonalDetails(type);
  const adult = hasAdultDetails(type);
  const keep = (rows: [string, any, boolean?][]) => rows.filter((r) => r[2] !== false).map(([l, v]) => [l, v] as [string, any]);

  return (
    <View>
      {/* Nominees — only a type that can nominate (SEBI) */}
      {canNominate(type) ? (
      <Section title="Nominees" icon="users">
        {td.nominationOptOut && nominees.length === 0 ? <Empty text="The client chose not to nominate." /> : nominees.length === 0 ? <Empty text="No nominees on record." /> : nominees.map((n, idx) => (
          <View key={idx} style={idx > 0 ? styles.sep : undefined}>
            <FieldRow label="Name" value={n.name} />
            <FieldRow label="Relation" value={titleCase(n.relation)} />
            {n.dob ? <FieldRow label="DOB" value={fmtDate(n.dob)} /> : null}
            {n.mobile ? <FieldRow label="Mobile" value={n.mobile} /> : null}
            {n.pan ? <FieldRow label="PAN" value={n.pan} /> : null}
            {n.sharePct != null ? <FieldRow label="Share %" value={`${n.sharePct}%`} /> : null}
          </View>
        ))}
      </Section>
      ) : null}

      <TypeCard type={type} td={td} dob={i.dob} />

      {/* Referrals */}
      <Section title="Referrals" icon="share-2">
        {referrals.length === 0 ? <Empty text="No referrals recorded." /> : referrals.map((r, idx) => (
          <View key={idx} style={idx > 0 ? styles.sep : undefined}>
            <FieldRow label="Name" value={r.name} />
            <FieldRow label="Relation" value={titleCase(r.relation)} />
            {r.mobile ? <FieldRow label="Mobile" value={r.mobile} /> : null}
            {r.email ? <FieldRow label="Email" value={r.email} /> : null}
            {r.note ? <FieldRow label="Note" value={r.note} /> : null}
          </View>
        ))}
      </Section>

      {/* Master record */}
      <Section title="Client details" icon="file-text">
        <FieldGroup title="Identity" rows={keep([
          ["Client ID", String(i.id ?? "").slice(0, 8)],
          ["Client type", clientTypeLabel(type)],
          // The column may hold a registrar key (MINOR:… / NOPAN:…), never shown as a PAN.
          ["PAN", ownPan(i.pan) || null],
          ["Name", i.name],
          ["Name as per PAN", i.nameAsPerPan],
          ["Date of birth", fmtDate(i.dob), personal],
          ["Gender", i.gender === "M" ? "Male" : i.gender === "F" ? "Female" : i.gender === "O" ? "Other" : "—", personal],
          ["Marital status", titleCase(i.maritalStatus), adult],
          ["Mother's name", i.motherName, personal],
          ["Place of birth", i.birthPlace, personal],
          ["Aadhaar (last 4)", i.aadhaarLast4, personal],
          ["Client since", fmtDate(i.onboardedAt)],
          ["Anniversary", fmtDate(i.anniversaryDate), adult],
        ])} />
        <FieldGroup title="Contact" rows={[
          ["Mobile", i.phone],
          ["Mobile belongs to", i.mobileRelation],
          ["Alternate mobile", i.alternatePhone],
          ["Email", i.email],
          ["Email belongs to", i.emailRelation],
          ["WhatsApp", i.whatsappPhone],
          ["Address", [addr.line1, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(", ")],
        ]} />
        <FieldGroup title="Profile" rows={keep([
          ["Occupation", i.occupation, adult],
          ["Employer", i.employerName, adult],
          ["Income range", i.incomeRange],
          ["Segment", i.segmentTag],
          ["Client category", i.clientCategory],
          ["Mode of holding", i.modeOfHolding],
          ["Household type", i.householdType],
          ["Family head", i.familyOwnerName],
          ["Referral client", i.referralClientName],
          ["Assigned RM", d.rm?.name],
          ["Family group", d.family?.familyName ?? d.family?.headName],
        ])} />
        <FieldGroup title="Compliance" rows={keep([
          ["KYC status", titleCase(i.kycStatus)],
          ["Residential status", titleCase(i.residencyStatus)],
          ["Tax status", i.taxStatus],
          ["PAN–Aadhaar link", titleCase(i.panAadhaarLinkStatus), adult],
          ["CKYC number", i.ckycNumber],
          ["KYC validated", fmtDate(i.kycValidatedAt)],
          ["KRA", i.kraName],
          ["FATCA status", titleCase(i.fatcaStatus)],
          ["Risk profile", kind === "minor" ? `${titleCase(i.riskProfile) || "—"} (the guardian's)` : titleCase(i.riskProfile)],
          ["BSE UCC", i.bseUccCode],
          ["NSE CAN", i.nseCanCode],
          ["Mandate status", titleCase(i.mandateStatus)],
          ["Mandate ref", i.mandateRefNo],
          ["Mandate amount", i.mandateAmount != null ? inr(i.mandateAmount) : null],
        ])} />
        {banks.length > 0 && (
          <FieldGroup title="Bank" rows={banks.flatMap((b, idx) => [
            [`Bank${banks.length > 1 ? ` ${idx + 1}` : ""}`, b.bankName],
            ["Account", b.accountMasked],
            ["IFSC", b.ifsc],
          ] as [string, any][])} />
        )}
        {(i.secondHolderFirstName || i.secondHolderLastName) && (
          <FieldGroup title="Second / joint holder" rows={[
            ["Name", [i.secondHolderFirstName, i.secondHolderLastName].filter(Boolean).join(" ")],
            ["Occupation", i.secondHolderOccupation],
            ["Company", i.secondHolderCompanyName],
            ["Birth place", i.secondHolderBirthPlace],
            ["Mother's name", i.secondHolderMotherName],
            ["Marital status", titleCase(i.secondHolderMaritalStatus)],
          ]} />
        )}
        {i.notes ? (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={{ fontWeight: fontWeight.semibold, marginBottom: 2 }}>Notes</Text>
            <Text variant="caption" tone="muted">{i.notes}</Text>
          </View>
        ) : null}
      </Section>

      {/* Completeness */}
      <Section title="Profile completeness" icon="check-circle">
        <View style={styles.compHead}>
          <Text style={{ fontSize: 22, fontWeight: fontWeight.bold }}>{comp.pct ?? comp.score ?? 0}%</Text>
          <View style={styles.compTrack}><View style={[styles.compFill, { width: `${comp.pct ?? comp.score ?? 0}%` }]} /></View>
        </View>
        {(comp.missing ?? []).length > 0 ? <Text variant="caption" tone="muted">Missing: {(comp.missing ?? []).join(", ")}</Text> : <Text variant="caption" tone="muted">All key fields captured.</Text>}
      </Section>

      {/* KYC data */}
      {kycData.length > 0 && (
        <Section title="Captured KYC data" icon="database">
          {kycData.map(([k, v]) => <FieldRow key={k} label={titleCase(k)} value={typeof v === "object" ? JSON.stringify(v) : String(v)} />)}
        </Section>
      )}

      {/* Risk history */}
      <Section title="Risk profile history" icon="activity">
        {(d.riskHistory ?? []).length === 0 ? <Empty text="No risk profile history." /> : (d.riskHistory ?? []).map((r: any, idx: number) => (
          <View key={r.id ?? idx} style={idx > 0 ? styles.sep : undefined}>
            <FieldRow label="Profiled" value={fmtDate(r.profileDate ?? r.signedAt)} />
            <FieldRow label="Category" value={titleCase(r.finalCategory)} />
            <FieldRow label="Score" value={r.totalScore != null ? String(r.totalScore) : "—"} />
            {r.signedByName ? <FieldRow label="Signed by" value={r.signedByName} /> : null}
            {r.rmRemarks ? <FieldRow label="RM remarks" value={r.rmRemarks} /> : null}
          </View>
        ))}
      </Section>
    </View>
  );
}

/** The client type's own details — what the CRM's client page shows per type. */
function TypeCard({ type, td, dob }: { type?: string; td: any; dob?: string | null }) {
  const kind = clientKind(type);
  const def = clientTypeDef(type);
  if (kind === "minor") {
    const g = td.guardian ?? {};
    return (
      <Section title="Guardian" icon="shield">
        <FieldRow label="Name" value={g.name} />
        <FieldRow label="Relationship" value={optLabel(GUARDIAN_RELATIONS, g.relation)} />
        <FieldRow label="PAN" value={g.pan} />
        <FieldRow label="Date of birth" value={fmtDate(g.dob)} />
        <FieldRow label="Mobile" value={g.mobile} />
        <FieldRow label="Email" value={g.email} />
        <FieldRow label="Turns 18 on" value={fmtDate(majorityDate(dob))} />
      </Section>
    );
  }
  if (kind === "huf") {
    const k = td.karta ?? {};
    const cops: any[] = td.coparceners ?? [];
    return (
      <Section title="Karta & coparceners" icon="users">
        <FieldRow label="Date formed" value={fmtDate(td.entity?.formedOn)} />
        <FieldRow label="Karta" value={k.name} />
        <FieldRow label="Karta's PAN" value={k.pan} />
        <FieldRow label="Karta's mobile" value={k.mobile} />
        <FieldRow label="Karta's email" value={k.email} />
        {cops.map((c, idx) => <FieldRow key={idx} label={`Coparcener ${idx + 1}`} value={[c.name, c.relation].filter(Boolean).join(" · ")} />)}
      </Section>
    );
  }
  if (kind === "entity") {
    const e = td.entity ?? {};
    const sigs: any[] = td.signatories ?? [];
    const ubos: any[] = td.ubos ?? [];
    return (
      <Section title="Entity" icon="briefcase">
        <FieldRow label={def.formedLabel ?? "Date formed"} value={fmtDate(e.formedOn)} />
        <FieldRow label={def.registrationLabel ?? "Registration no."} value={e.registrationNo} />
        <FieldRow label="Place of incorporation" value={e.placeOfIncorporation} />
        <FieldRow label="Nature of business" value={e.natureOfBusiness} />
        <FieldRow label="Net worth" value={e.netWorth != null && e.netWorth !== "" ? `${inr(e.netWorth)}${e.netWorthAsOn ? ` (as on ${fmtDate(e.netWorthAsOn)})` : ""}` : null} />
        <FieldRow label="FATCA / CRS" value={optLabel(FATCA_ENTITY_CLASSES, e.fatcaClass)} />
        {e.giin ? <FieldRow label="GIIN" value={e.giin} /> : null}
        {sigs.map((x, idx) => <FieldRow key={`s${idx}`} label={`Signatory ${idx + 1}`} value={[x.name, x.designation].filter(Boolean).join(" · ")} />)}
        {ubos.map((x, idx) => <FieldRow key={`u${idx}`} label={`Beneficial owner ${idx + 1}`} value={[x.name, x.holdingPct != null && x.holdingPct !== "" ? `${x.holdingPct}%` : null].filter(Boolean).join(" · ")} />)}
      </Section>
    );
  }
  if (type === "nri") {
    const n = td.nri ?? {};
    return (
      <Section title="Overseas details" icon="globe">
        <FieldRow label="Country of residence" value={n.countryOfResidence} />
        <FieldRow label="Overseas address" value={n.overseasAddress} />
        <FieldRow label="Tax residency" value={n.taxResidencyCountry} />
        <FieldRow label="Foreign TIN" value={n.foreignTin} />
        <FieldRow label="Invests from" value={optLabel(NRI_ACCOUNT_TYPES, n.accountType)} />
      </Section>
    );
  }
  if (type === "sole_proprietor" && td.businessName) {
    return <Section title="Business" icon="briefcase"><FieldRow label="Business name" value={td.businessName} /></Section>;
  }
  return null;
}

const styles = StyleSheet.create({
  sep: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.line },
  compHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  compTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  compFill: { height: 8, borderRadius: 4, backgroundColor: palette.success },
});
