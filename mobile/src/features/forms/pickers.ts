/**
 * Names for a client / lead preset by id (?investorId= / ?leadId= from that
 * record's page), so a form shows "Rajesh Patel" instead of "Selected" while
 * the page that opened it didn't pass the name. Used as a typeahead's
 * `searchInitialLabel`; null (not found, no access, offline) falls back.
 */

/** The API client, loaded on first use — so a form spec (and its tests) never
 *  pulls the session / storage stack in just by being imported. */
const client = (): typeof import("../../api/client").api => require("../../api/client").api;

export async function clientNameById(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const api = client();
    const r = await api.get<any>(`/api/investors/${encodeURIComponent(id)}`);
    const name = r?.investor?.name ?? r?.name;
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null;
  }
}

export async function leadNameById(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    // GET /api/leads/[id] returns the lead itself (no envelope).
    const api = client();
    const r = await api.get<any>(`/api/leads/${encodeURIComponent(id)}`);
    const name = r?.name ?? r?.lead?.name;
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null;
  }
}

/** A name passed alongside the id (?name=), only when the id itself was passed. */
export function presetName(params: Record<string, string>, idKey: string): string {
  return params[idKey] && params.name ? String(params.name) : "";
}
