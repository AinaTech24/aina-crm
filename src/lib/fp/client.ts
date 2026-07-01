/**
 * FintechPrimitives (Cybrilla) API client.
 *
 * FP is a mutual-fund transaction + reporting infrastructure provider. This
 * client wraps the slice we need for the "mailback import" flow — uploading an
 * RTA reverse feed and pulling back structured transactions (with FIFO
 * capital-gains) and folios.
 *
 * Auth: OAuth2 client_credentials → short-lived (30 min) Bearer token. We cache
 * the token in-process per (tenant, clientId) and refresh ~60s before expiry.
 *
 * Endpoint base paths are NOT uniform on FP:
 *   - auth, mf_folios          → /v2/...
 *   - files, file_operations   → root (no /v2)
 *   - transactions             → root (no /v2)
 * so each method spells out its own path.
 *
 * Config is read from the environment (sandbox MVP). When this graduates to
 * per-tenant credentials it should move to `tenant_integrations` (provider
 * "fintech_primitives"), mirroring the Zoho pattern — the call sites here stay
 * the same, only `getFpConfig` changes.
 */

export interface FpConfig {
  baseUrl: string;
  tenant: string;
  clientId: string;
  clientSecret: string;
}

/** Read FP config from the environment. Throws a clear error if unconfigured. */
export function getFpConfig(): FpConfig {
  const baseUrl = (process.env.FP_BASE_URL ?? "https://s.finprim.com").replace(/\/+$/, "");
  const tenant = process.env.FP_TENANT ?? "";
  const clientId = process.env.FP_CLIENT_ID ?? "";
  const clientSecret = process.env.FP_CLIENT_SECRET ?? "";
  if (!tenant || !clientId || !clientSecret) {
    throw new Error(
      "Mailback Import is not configured (missing API credentials)."
    );
  }
  return { baseUrl, tenant, clientId, clientSecret };
}

// ── Token cache ────────────────────────────────────────────────────────────

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

function cacheKey(cfg: FpConfig): string {
  return `${cfg.baseUrl}|${cfg.tenant}|${cfg.clientId}`;
}

/** Get a valid Bearer token, minting (and caching) a fresh one if needed. */
export async function getFpToken(cfg: FpConfig = getFpConfig()): Promise<string> {
  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);
  // Refresh 60s before the real expiry to avoid using a token mid-flight.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const res = await fetch(`${cfg.baseUrl}/v2/auth/${encodeURIComponent(cfg.tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw fpError(`auth failed (HTTP ${res.status})`, res.status, text);
  }
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Mailback auth returned a non-JSON response");
  }
  const token = body.access_token as string | undefined;
  const expiresIn = Number(body.expires_in ?? 1800);
  if (!token) throw new Error("Mailback auth response had no access_token");
  tokenCache.set(key, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

// ── Low-level request helper ─────────────────────────────────────────────────

export class FpApiError extends Error {
  status: number;
  body: string;
  /** 4xx (except 429) are permanent — never auto-retry into the same rejection. */
  permanent: boolean;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "FpApiError";
    this.status = status;
    this.body = body;
    this.permanent = status >= 400 && status < 500 && status !== 429;
  }
}

function fpError(message: string, status: number, body: string): FpApiError {
  // Surface FP's own error message when present — it's far more actionable than
  // a bare status code (e.g. "primary_investor_pan not found").
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message ?? j?.message ?? "";
  } catch {
    /* body wasn't JSON */
  }
  return new FpApiError(detail ? `${message}: ${detail}` : message, status, body);
}

async function fpRequest(
  path: string,
  init: RequestInit & { cfg?: FpConfig } = {}
): Promise<any> {
  const cfg = init.cfg ?? getFpConfig();
  const token = await getFpToken(cfg);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("x-tenant-id", cfg.tenant);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw fpError(`${init.method ?? "GET"} ${path} failed (HTTP ${res.status})`, res.status, text);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Domain types (only the fields we consume) ────────────────────────────────

export interface FpFile {
  object: "file";
  id: string;
  filename?: string;
  content_type?: string;
  byte_size?: number;
}

export type FpFileOperationStatus = "pending" | "processing" | "processed" | "failed" | string;

export interface FpFileOperation {
  object: "file_operation";
  id: string;
  file: string;
  type: "transaction_processing";
  status: FpFileOperationStatus;
  /** Row counters FP reports once processing completes. */
  processed?: number;
  succeeded?: number;
  failed?: number;
}

export interface FpMfFolio {
  object: "mf_folio";
  amc: string;
  number: string;
  primary_investor_pan?: string | null;
  primary_investor_name?: string | null;
  holding_pattern?: string | null;
  [k: string]: unknown;
}

export interface FpTransactionSource {
  days_held?: number;
  units?: number;
  purchased_on?: string;
  purchased_at?: number;
  gain?: number;
}

export interface FpTransaction {
  object: "transaction";
  folio_number: string;
  isin?: string;
  type: string; // purchase | redemption | switch_in | switch_out | transfer_in | transfer_out | dividend_payout | dividend_reinvestment | bonus
  amount?: number;
  units?: number;
  traded_on?: string; // yyyy-MM-dd
  traded_at?: number; // NAV
  rta_order_reference?: string;
  rta_product_code?: string;
  rta_investment_option?: string;
  rta_scheme_name?: string;
  mf_investment_account?: string | null;
  sources?: FpTransactionSource[];
  [k: string]: unknown;
}

// ── API methods ──────────────────────────────────────────────────────────────

/**
 * Map a reverse-feed filename to a content type FP accepts. FP's /files
 * REJECTS `text/plain` ("invalid content type"), so a pipe-delimited .txt feed
 * must be sent as text/csv. Verified against the sandbox.
 */
export function fpContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "csv":
    case "txt":
    case "dat":
    case "tsv":
      return "text/csv";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "dbf":
      return "application/octet-stream";
    default:
      return "text/csv";
  }
}

/** Upload a file to FP. Returns the file object (we need its `id`). */
export async function uploadFpFile(
  bytes: Uint8Array,
  filename: string,
  cfg: FpConfig = getFpConfig()
): Promise<FpFile> {
  const form = new FormData();
  // Node 18+ has global FormData/Blob; FP expects the multipart field "file".
  // The content type MUST be set — FP rejects text/plain / empty types. Cast:
  // TS's DOM lib types BlobPart narrowly, but Uint8Array is a valid BufferSource.
  const blob = new Blob([bytes as unknown as BlobPart], { type: fpContentType(filename) });
  form.append("file", blob, filename);
  const out = (await fpRequest("/files", { method: "POST", body: form, cfg })) as FpFile;
  if (!out?.id) throw new Error("Mailback file upload returned no id");
  return out;
}

/** Create a transaction_processing file operation for an uploaded file. */
export async function createFpFileOperation(
  fileId: string,
  cfg: FpConfig = getFpConfig()
): Promise<FpFileOperation> {
  return (await fpRequest("/file_operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "transaction_processing", file: fileId }),
    cfg,
  })) as FpFileOperation;
}

/** Fetch a file operation by id (for polling). */
export async function getFpFileOperation(
  id: string,
  cfg: FpConfig = getFpConfig()
): Promise<FpFileOperation> {
  return (await fpRequest(`/file_operations/${encodeURIComponent(id)}`, { cfg })) as FpFileOperation;
}

/**
 * List all mf_folios. FP returns `{ object: "list", data: [...] }`. The v2 list
 * supports a `count` cap; we request a high cap and read `data`. (FP does not
 * document an offset cursor for this resource — if a tenant ever exceeds the
 * cap, `result.capHit` lets the caller warn rather than silently truncate.)
 */
export async function listFpMfFolios(
  cfg: FpConfig = getFpConfig()
): Promise<{ folios: FpMfFolio[]; capHit: boolean }> {
  const CAP = 1000;
  const res = await fpRequest(`/v2/mf_folios?count=${CAP}`, { cfg });
  const folios: FpMfFolio[] = Array.isArray(res) ? res : res?.data ?? [];
  return { folios, capHit: folios.length >= CAP };
}

/**
 * List transactions for the given folio NUMBERS. FP's `folios` arg takes a
 * comma-separated list of folio_numbers (NOT ids); `from`/`to` are DATES (not
 * offsets) — and crucially, omitting them returns ONLY the current financial
 * year. To avoid silently dropping older transactions from a multi-year
 * migration feed, we pass an explicit wide [from, to] range by default.
 *
 * We batch folio numbers to keep the URL bounded and concatenate the results.
 */
export async function listFpTransactions(
  folioNumbers: string[],
  opts: { from?: string; to?: string; cfg?: FpConfig } = {}
): Promise<FpTransaction[]> {
  if (!folioNumbers.length) return [];
  const cfg = opts.cfg ?? getFpConfig();
  const from = opts.from ?? "2000-01-01"; // wide lower bound (pre-dates Indian MF dematerialisation)
  const to = opts.to ?? new Date().toISOString().slice(0, 10);
  const out: FpTransaction[] = [];
  const BATCH = 25; // keep each query's folio set modest (URL length)
  for (let i = 0; i < folioNumbers.length; i += BATCH) {
    const batch = folioNumbers.slice(i, i + BATCH);
    const folioParam = encodeURIComponent(batch.join(","));
    const res = await fpRequest(`/transactions?folios=${folioParam}&from=${from}&to=${to}`, { cfg });
    const data: FpTransaction[] = Array.isArray(res) ? res : res?.data ?? [];
    out.push(...data);
  }
  return out;
}
