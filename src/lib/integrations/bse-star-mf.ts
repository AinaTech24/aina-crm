/**
 * BSE Star MF adapter — stub. Real BSE Star uses SOAP with per-tenant member
 * credentials. We define the contract here so action handlers + UI can be
 * coded against it now, and the real SOAP wiring slots in later.
 *
 * Production hookup steps (when ready):
 *   1. Each MFD tenant uploads BSE member code + user_id + password (Module 10
 *      compliance vault) — never stored in env.
 *   2. Use `soap` npm package to call BSE's WSDL. URLs:
 *        Demo:  https://bsestarmfdemo.bseindia.com/MFOrderEntry/MFOrder.svc?singleWsdl
 *        Prod:  https://bsestarmf.in/MFOrderEntry/MFOrder.svc?singleWsdl
 *   3. PASSWORD_GENERATION_REQUEST → fetch ENCRYPTED_PASSWORD (15-min TTL).
 *   4. Wrap each Order_Entry_Param / Lumpsum / SIP / Redemption operation.
 *
 * For now, every method here is a no-op that returns a deterministic stub
 * response. Wired into action handlers via the adapter interface below.
 */

export type BseCredentials = {
  memberCode: string;
  userId: string;
  password: string;
};

export type LumpsumOrder = {
  uccCode: string;
  amcCode: string;
  schemeCode: string;
  amount: number;
  euin: string;
  paymentMode?: "PHYSICAL" | "ONLINE";
};

export type SipOrder = {
  uccCode: string;
  schemeCode: string;
  amount: number;
  frequency: "MONTHLY" | "QUARTERLY";
  startDate: string; // YYYY-MM-DD
  noOfInstallments: number;
  mandateId: string;
  euin: string;
};

export type RedemptionOrder = {
  uccCode: string;
  folioNumber: string;
  schemeCode: string;
  units?: number;
  amount?: number;
  allUnits?: boolean;
  euin: string;
};

export type OrderResult = {
  orderId: string;
  status: "submitted" | "rejected";
  reasonCode?: string;
  reasonDescription?: string;
  raw?: unknown;
};

export interface BseStarAdapter {
  authenticate(creds: BseCredentials): Promise<{ token: string; expiresAt: Date }>;
  createUcc(creds: BseCredentials, params: unknown): Promise<{ uccCode: string }>;
  placeLumpsum(creds: BseCredentials, order: LumpsumOrder): Promise<OrderResult>;
  registerSip(creds: BseCredentials, order: SipOrder): Promise<OrderResult>;
  redeem(creds: BseCredentials, order: RedemptionOrder): Promise<OrderResult>;
  fetchOrderStatus(creds: BseCredentials, orderId: string): Promise<OrderResult>;
}

/**
 * Stub adapter — useful for development before BSE membership is approved.
 * Generates fake order IDs and 90% success rate.
 */
export const stubBseStar: BseStarAdapter = {
  async authenticate() {
    return { token: "stub-token", expiresAt: new Date(Date.now() + 15 * 60 * 1000) };
  },
  async createUcc(_c, _p) {
    return { uccCode: `UCC${Date.now().toString().slice(-8)}` };
  },
  async placeLumpsum(_c, order) {
    return {
      orderId: `LMP${Date.now()}`,
      status: Math.random() > 0.1 ? "submitted" : "rejected",
      reasonCode: Math.random() > 0.1 ? undefined : "INSUFFICIENT_BALANCE",
      reasonDescription: undefined,
    };
  },
  async registerSip(_c, order) {
    return {
      orderId: `SIP${Date.now()}`,
      status: "submitted",
    };
  },
  async redeem(_c, order) {
    return {
      orderId: `RED${Date.now()}`,
      status: "submitted",
    };
  },
  async fetchOrderStatus(_c, orderId) {
    return {
      orderId,
      status: "submitted",
    };
  },
};

/**
 * Real adapter — to be implemented when BSE membership lands.
 * Pseudocode:
 *
 *   const client = await soap.createClientAsync(WSDL);
 *   const [authResult] = await client.getPasswordAsync({
 *     UserId: creds.userId,
 *     Password: creds.password,
 *     PassKey: passkey,
 *   });
 *   ...
 */
export const liveBseStar: BseStarAdapter = {
  async authenticate() {
    throw new Error("BSE Star MF live adapter not implemented — use stubBseStar in development");
  },
  async createUcc() {
    throw new Error("not implemented");
  },
  async placeLumpsum() {
    throw new Error("not implemented");
  },
  async registerSip() {
    throw new Error("not implemented");
  },
  async redeem() {
    throw new Error("not implemented");
  },
  async fetchOrderStatus() {
    throw new Error("not implemented");
  },
};

/**
 * Returns the adapter chosen by env (`BSE_STAR_MODE=stub|live`).
 * Defaults to stub.
 */
export function getBseStarAdapter(): BseStarAdapter {
  return process.env.BSE_STAR_MODE === "live" ? liveBseStar : stubBseStar;
}
