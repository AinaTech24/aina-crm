import type { SimCall } from "../../../modules/aina-call-log";

// Android can write a completed call using its START time. Revisit this window
// so a long call isn't lost when an earlier check advanced past its start.
export const CALL_RECHECK_MS = 24 * 60 * 60_000;
export interface CallImportState { cursor: number; seen: Record<string, number>; scanFrom?: number }
export const callIdentity = (call: SimCall) => `${call.id}_${Math.trunc(call.date)}`;
export function callReadFrom(state: CallImportState, optedInAt: number) {
  return Math.max(optedInAt, state.scanFrom ?? state.cursor - CALL_RECHECK_MS);
}
export function parseCallImportState(raw: string | null, cursor: number): CallImportState {
  if (!raw) return { cursor, seen: {} };
  const value = JSON.parse(raw);
  if (!value || !Number.isFinite(value.cursor) || value.cursor < 0 || (value.scanFrom !== undefined && (!Number.isFinite(value.scanFrom) || value.scanFrom < 0)) || !value.seen || typeof value.seen !== "object" || Array.isArray(value.seen)
    || Object.entries(value.seen).some(([id, at]) => !/^\d+_\d+$/.test(id) || typeof at !== "number" || !Number.isFinite(at))) {
    throw new Error("Saved call-import state could not be read. Nothing has been deleted.");
  }
  return value;
}
export function advanceCallImport(state: CallImportState, until: number, calls: SimCall[]): CallImportState {
  const cursor = calls.length >= 5000 ? calls[calls.length - 1].date : until;
  return { cursor: Math.max(state.cursor, cursor), ...(calls.length >= 5000 ? { scanFrom: cursor } : {}), seen: Object.fromEntries(Object.entries(state.seen).filter(([, at]) => at >= cursor - CALL_RECHECK_MS)) };
}
