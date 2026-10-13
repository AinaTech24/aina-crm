/**
 * City and state for an Indian pincode — India Post's public directory
 * (api.postalpincode.in), asked by the server and remembered in memory, so a
 * pincode is looked up once per process. A slow or failed lookup answers
 * null: the person types the city and state themselves, nothing breaks.
 */

export type PincodePlace = { city: string; state: string };

const cache = new Map<string, PincodePlace | null>();

export async function lookupPincode(pin: string): Promise<PincodePlace | null> {
  if (!/^[1-9]\d{5}$/.test(pin)) return null;
  if (cache.has(pin)) return cache.get(pin)!;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as Array<{ Status?: string; PostOffice?: Array<{ District?: string; State?: string }> | null }>;
    const po = j?.[0]?.Status === "Success" ? j[0].PostOffice?.[0] : undefined;
    const place = po?.District && po?.State ? { city: po.District, state: po.State } : null;
    // Remember a definite answer, including "no such pincode"; a network
    // failure (thrown above) is not remembered, so it is tried again.
    cache.set(pin, place);
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
    return place;
  } catch {
    return null;
  }
}
