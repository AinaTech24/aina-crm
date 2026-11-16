/**
 * The Clients list's built-in columns in their default order. A plain module on
 * purpose: the server page reads it, and a value exported from a "use client"
 * file reaches a server component as a proxy, not the array.
 */
export const INVESTOR_DEFAULT_COLUMNS = ["name", "pan", "category", "tier", "segment", "aum", "sip", "kyc", "health", "complete", "status", "actions"];
