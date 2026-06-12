/**
 * Field mapping: our domain record (the events_outbox `after` snapshot) → a Zoho
 * record payload. Keyed by our entity type. This is the registry you extend to
 * add a module to the sync — declare the Zoho module, the external-id field, and
 * how to translate fields.
 *
 * The MFD must add a custom single-line field named by `externalIdField`
 * (default "Aina_Record_ID") to each target Zoho module — that's what makes the
 * upsert idempotent. For the modules with no native Zoho object (Insurance,
 * SIPs, Business Entries…) the MFD also has to create a custom module; those are
 * added here in later phases.
 *
 * Phase 1 ships the two fully-native, fully-instrumented modules.
 */
export const EXTERNAL_ID_FIELD = "Aina_Record_ID";

export type ZohoMapping = {
  entityType: string;
  zohoModule: string;
  externalIdField: string;
  /** Build the Zoho payload from our record snapshot (`events_outbox.after`). */
  toZoho: (after: Record<string, any>) => Record<string, any>;
};

/** Drop undefined / null / empty-string fields so we never blank out Zoho data. */
function clean(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

export const ZOHO_MAPPINGS: ZohoMapping[] = [
  {
    entityType: "investor",
    zohoModule: "Contacts",
    externalIdField: EXTERNAL_ID_FIELD,
    toZoho: (a) =>
      clean({
        Last_Name: a.name || "Unknown",
        Email: a.email,
        Phone: a.phone || a.mobile,
        Mailing_City: a.city,
        Description: a.pan ? `PAN: ${a.pan}` : undefined,
        [EXTERNAL_ID_FIELD]: a.id,
      }),
  },
  {
    entityType: "lead",
    zohoModule: "Leads",
    externalIdField: EXTERNAL_ID_FIELD,
    toZoho: (a) =>
      clean({
        Last_Name: a.name || "Unknown",
        Email: a.email,
        Phone: a.phone || a.mobile,
        Lead_Status: a.stage,
        Lead_Source: a.source,
        City: a.city,
        [EXTERNAL_ID_FIELD]: a.id,
      }),
  },
];

const BY_ENTITY = new Map(ZOHO_MAPPINGS.map((m) => [m.entityType, m]));

export function mappingFor(entityType: string): ZohoMapping | undefined {
  return BY_ENTITY.get(entityType);
}

/** Entity types currently eligible for Zoho sync (drives the outbox query). */
export const SYNCED_ENTITY_TYPES: string[] = ZOHO_MAPPINGS.map((m) => m.entityType);
