/**
 * The FD form's value shape and its blank state. A plain module (not
 * "use client") because the server pages build the initial value — a server
 * component cannot call a function exported from a client module.
 */

import { indiaToday, maturityDateFor } from "./terms";

export type FdFormValue = {
  id?: string;
  investorId: string;
  investorName: string;
  rmId: string;
  issuer: string;
  issuerType: string;
  schemeName: string;
  fdNumber: string;
  depositDate: string;
  maturityDate: string;
  principal: string;
  interestRate: string;
  payout: string;
  compounding: string;
  maturityAmount: string;
  holding: string;
  jointHolders: string;
  nomineeName: string;
  seniorCitizen: boolean;
  taxForm: string;
  autoRenew: boolean;
  status: string;
  commissionRate: string;
  commissionAmount: string;
  remarks: string;
  renewedFromId?: string | null;
};

export function emptyFd(over: Partial<FdFormValue> = {}): FdFormValue {
  const today = indiaToday();
  return {
    investorId: "", investorName: "", rmId: "", issuer: "", issuerType: "bank", schemeName: "", fdNumber: "",
    depositDate: today, maturityDate: maturityDateFor(today, 12, 0), principal: "", interestRate: "", payout: "cumulative",
    compounding: "quarterly", maturityAmount: "", holding: "single", jointHolders: "", nomineeName: "",
    seniorCitizen: false, taxForm: "none", autoRenew: false, status: "active", commissionRate: "", commissionAmount: "",
    remarks: "", ...over,
  };
}
