/**
 * NSE MF Invest (NMF II) — the KYC status check by PAN.
 *
 *   POST {host}/nsemfdesk/api/v2/utility/KYC_CHECK   { "pan_no": "ABCDE1234F" }
 *
 * Every call carries the firm's OWN credentials (lib/kyc/credentials.ts) and
 * must leave from an IP the firm has had NSE whitelist against its user — a
 * 403 means the header is wrong or the IP is not mapped. NSE's network (Akamai)
 * also drops requests without browser-like headers, so those are sent too
 * (NSE FAQ 1.4, "connection level" headers). KYC_CHECK answers only in Live.
 *
 * No database here: a call is made OUTSIDE any transaction, and the caller
 * records the answer (lib/kyc/refresh.ts).
 */

import { nseAuthorization, type NseAuthInput } from "./nse-auth";

export const NSE_HOSTS = {
  live: "https://www.nseinvest.com",
  uat: "https://nseinvestuat.nseindia.com",
} as const;
export type NseEnv = keyof typeof NSE_HOSTS;

export type NseCredentials = NseAuthInput & { memberCode: string; env: NseEnv };

export type NseKycAnswer = {
  pan: string | null;
  name: string | null;
  flag: string | null;
  remark: string | null;
  kraName: string | null;
  statusDate: string | null;
};

export type NseCallResult =
  | { ok: true; answer: NseKycAnswer }
  /** auth: 401/403 — wrong credentials or IP not whitelisted; stop calling for this firm. */
  | { ok: false; kind: "auth" | "http" | "network" | "bad_response"; status?: number; message: string };

const TIMEOUT_MS = 20_000;

function headers(creds: NseCredentials): Record<string, string> {
  const host = NSE_HOSTS[creds.env];
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Language": "en-US",
    "Accept-Encoding": "gzip, deflate, br",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Referer: `${host}/`,
    memberId: creds.memberCode,
    Authorization: nseAuthorization(creds),
  };
}

/** One field of a JSON body that may be anything. */
const field = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);

/** The answer may arrive bare, wrapped in `data`, or as a one-element array. */
export function parseKycAnswer(body: unknown): NseKycAnswer | null {
  let o: any = body;
  if (o && typeof o === "object" && !Array.isArray(o) && o.data != null) o = o.data;
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== "object") return null;
  const remark = str(o.kyc_status_remark ?? o.status_remark);
  const flag = str(o.kyc_status);
  if (!remark && !flag) return null;
  return {
    pan: str(o.pan ?? o.pan_no ?? o.client_pan)?.toUpperCase() ?? null,
    name: str(o.name ?? o.holder_name),
    flag,
    remark,
    kraName: str(o.kra_name),
    statusDate: str(o.status_date),
  };
}

export async function nseKycCheck(creds: NseCredentials, pan: string): Promise<NseCallResult> {
  const url = `${NSE_HOSTS[creds.env]}/nsemfdesk/api/v2/utility/KYC_CHECK`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: headers(creds),
      body: JSON.stringify({ pan_no: pan }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, kind: "network", message: (e as Error)?.message ?? "NSE did not answer" };
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.status === 401 || res.status === 403) {
    const msg = str(field(body, "message")) ?? "Invalid authorization header or IP address not mapped with user.";
    return { ok: false, kind: "auth", status: res.status, message: msg };
  }
  if (!res.ok) {
    const msg = str(field(body, "message")) ?? `NSE answered HTTP ${res.status}`;
    return { ok: false, kind: "http", status: res.status, message: msg };
  }
  const answer = parseKycAnswer(body);
  if (!answer) {
    const msg = str(field(body, "message")) ?? str(field(body, "error")) ?? "NSE's answer had no KYC status";
    return { ok: false, kind: "bad_response", status: res.status, message: msg };
  }
  return { ok: true, answer };
}
