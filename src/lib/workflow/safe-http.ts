import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

type Address = { address: string; family: number };
type Reply = { status: number; body: string; location?: string };
type RequestOptions = { method: string; headers: Record<string, string>; body?: string; timeoutMs?: number };
type Dependencies = {
  resolve: (host: string) => Promise<Address[]>;
  send: (url: URL, pinned: Address, options: RequestOptions, signal: AbortSignal) => Promise<Reply>;
};
const denied = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) denied.addSubnet(ip, bits, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  denied.addSubnet(ip, bits, "ipv6");
}
const privateRanges = new BlockList();
privateRanges.addSubnet("10.0.0.0", 8, "ipv4");
privateRanges.addSubnet("172.16.0.0", 12, "ipv4");
privateRanges.addSubnet("192.168.0.0", 16, "ipv4");
privateRanges.addSubnet("fc00::", 7, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  if (family === 6) return globalV6.check(address, "ipv6") && !denied.check(address, "ipv6");
  return false;
}

export async function resolveHttpDestination(url: URL, resolve: Dependencies["resolve"]): Promise<Address> {
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("HTTP action requires an HTTP(S) URL without credentials or fragment");
  }
  // Deployment-admin configuration only; workflow authors cannot approve an origin.
  const privateApproved = (process.env.WORKFLOW_HTTP_ALLOWED_PRIVATE_ORIGINS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean).includes(url.origin);
  if (!privateApproved && url.port && !["80", "443"].includes(url.port)) throw new Error("HTTP destination port is not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost")) throw new Error("Private HTTP destination is not allowed");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!addresses.length || addresses.some(({ address }) => {
    if (isPublicAddress(address)) return false;
    const family = isIP(address);
    return !(privateApproved && family && privateRanges.check(address, family === 4 ? "ipv4" : "ipv6"));
  })) throw new Error("Private or reserved HTTP destination is not allowed");
  return addresses[0];
}

/** Connect directly to the checked IP (no second DNS lookup/rebinding window).
 * TLS still validates the original DNS hostname; Host is controlled by us. */
const sendPinned: Dependencies["send"] = (url, pinned, options, signal) => new Promise((resolve, reject) => {
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const req = send({
    protocol: url.protocol, hostname: pinned.address, family: pinned.family,
    port: url.port || undefined, path: `${url.pathname}${url.search}`,
    servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
    method: options.method, headers: { ...options.headers, host: url.host },
    agent: false, signal, maxHeaderSize: 16 * 1024,
  }, res => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) { res.destroy(new Error("HTTP response exceeds 1 MB")); return; }
      chunks.push(chunk);
    });
    res.on("error", reject);
    res.on("end", () => resolve({ status: res.statusCode ?? 502,
      body: Buffer.concat(chunks).toString("utf8"), location: res.headers.location }));
  });
  req.on("error", reject);
  req.end(options.body);
});

export async function safeWorkflowHttp(urlString: string, options: RequestOptions, dependencies?: Partial<Dependencies>): Promise<Reply> {
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(options.method)) throw new Error("HTTP method is not allowed");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers)) {
    const name = key.toLowerCase();
    if (["host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection", "expect"].includes(name)) {
      throw new Error(`HTTP header ${name} is not allowed`);
    }
    headers[name] = value;
  }
  if (Buffer.byteLength(options.body ?? "") > 1024 * 1024) throw new Error("HTTP request exceeds 1 MB");
  const opts = { ...options, headers };
  const resolve = dependencies?.resolve ?? (host => lookup(host, { all: true, verbatim: true }));
  const send = dependencies?.send ?? sendPinned;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("HTTP action timed out")), Math.min(Math.max(options.timeoutMs ?? 15_000, 1), 30_000));
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
  try {
    let url = new URL(urlString);
    for (let redirects = 0; ; redirects++) {
      const address = await Promise.race([resolveHttpDestination(url, resolve), aborted]);
      const response = await Promise.race([send(url, address, opts, controller.signal), aborted]);
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.location) return response;
      if (redirects >= 3) throw new Error("Too many HTTP redirects");
      const next = new URL(response.location, url);
      // Do not transmit secrets/body to a second authority or downgrade TLS.
      if (next.origin !== url.origin) throw new Error("Cross-origin HTTP redirect is not allowed");
      if (response.status === 303 || ([301, 302].includes(response.status) && opts.method === "POST")) {
        opts.method = "GET"; opts.body = undefined;
      }
      url = next; // Every hop resolves/checks again and is pinned independently.
    }
  } finally { clearTimeout(timeout); }
}
