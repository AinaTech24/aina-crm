/**
 * Real-LAYOUT, synthetic-DATA fixtures for the four RTA mailback reports
 * verified in Phase 2B (2026-10-08).
 *
 * The column headers below are copied verbatim, in order, from real mailback
 * files (KFintech MFSD201 87 columns, MFSD211 129, CAMS R2 80, CAMS R9 101).
 * Every VALUE is invented: names, PANs (valid shape, fictitious), folios,
 * amounts. Only the relationships the real files showed are reproduced — a
 * redemption reported lot by lot under one transaction number, letter-spaced
 * "S T P In / Out", Price ≠ Nav on lot rows, CAMS trxn_type_flag wording,
 * a minor folio reported with the guardian's PAN, a zero-balance holding.
 *
 * Passing tests on these files proves the importer handles those layouts and
 * relationships; it is not a substitute for re-running the real files.
 */
import * as XLSX from "xlsx";

export const MFSD201_HEADER = "Product Code|Fund|Folio Number|Scheme Code|Fund Description|Transaction Head|Transaction Number|Switch_Ref. No.|Instrument Number|Investor Name|Transaction Mode|Transaction Status|Branch Name|Branch Transaction No|Transaction Date|Process Date|Price|Units|Amount|Agent Code|Sub-Broker Code|Brokerage Percentage|Commission|Investor ID|Report Date|Report Time|Transaction Sub|Application Number|Transaction ID|Transaction Description|Transaction Type|Instrument Date|Instrument Bank|Dividend Option|Purchase Amount|Purchase Date|Switch Fund Date|Transaction Flag|Nav|Purchase Transaction No|STT|Load Percentage|Load Amount|Purchase Units|Ihno|Branch Code|Inward Number|PAN1|Remarks|Nav Date|PAN2|PAN3|TDSAmount|Scheme|Plan|ToProductCode|td_trxnmode|ClientId|DpId|Status|RejTrnoOrgNo|SubTranType|TrCharges|ATMCardStatus|ATMCardRemarks|NCT Change Date|ISIN|CityCategory|PortDate|NewUnqno|EUIN|Sub Broker ARN Code|EUIN Valid Indicator|EUIN Declaration Indicator|AssetType|SIP Regn Date|DivPer|GuardPanNo|Common Account Number|Exchange OrgTrType|Electronic transaction Flag|sipregslno|chequeclearnce|InvestorState|Retail Flag|Stamp Duty Charges|Feed Type".split("|");

export const MFSD211_HEADER = "Product Code|Fund|Folio|Fund Description|Investor Name|Joint Name 1|Joint Name 2|Address #1|Address #2|Address #3|City|Pincode|State|Country|TPIN|Date of Birth|F Name|M Name|Phone Residence|Phone Res#1|Phone Res#2|Phone Office|Phone Off#1|Phone Off#2|Fax Residence|Fax Office|Tax Status|Occ Code|Email|BankAccno|Bank Name|Account Type|Branch|Bank Address #1|Bank Address #2|Bank Address #3|Bank City|Bank Phone|Bank State|Bank Country|Investor ID|Broker Code|Report Date|Report Time|PAN Number|Mobile Number|Dividend Option|Occupation Description|Mode of Holding Description|Mapin Id|PAN2|PAN3|Category|GuardianName|Nominee|Client ID|DPID|CategoryDesc|StatusDesc|IFSC Code|Nominee2|Nominee3|Kyc1Flag|Kyc2Flag|Kyc3Flag|GuardPanNo|LastUpdatedDate|CommonAccNo|Nominee Relation|Nominee2 Relation|Nominee3 Relation|Nominee Ratio|Nominee2 Ratio|Nominee3 Ratio|Holder 1 Aadhaar info|Holder 2 Aadhaar info|Holder 3 Aadhaar info|Guardian Aadhaar info|Nominee Address1|Nominee Address2|Nominee Address3|Nominee City|Nominee State|Nominee Pin code|Nominee phone residence|Nominee Email|Nominee2 Address1|Nominee2 Address2|Nominee2 Address3|Nominee2 City|Nominee2 State|Nominee2 Pin code|Nominee2 phone residence|Nominee2 Email|Nominee3 Address1|Nominee3 Address2|Nominee3 Address3|Nominee3 City|Nominee3 State|Nominee3 Pin code|Nominee3 phone residence|Nominee3 Email|CKYC NO|JH1 CKYC|JH2 CKYC|Guardian CKYC NO|Joint Holder 1st Resi Phone No|Joint Holder 2nd Resi Phone No|Investors Resi FaxNo|KycGFlag|Demat Folio flag|Nominee Opt Out flag|Nominee DOB|Joint holder 1 contact number|Joint holder 1 Email id|Joint holder 2 contact number|Joint holder 2 Email id|Nominee Guardian Name|emailconcern|emailrelationship|MobileRelationship|UBO Flag|NPO Flag|JH1EmailConcern|JH1EmailRelationship|JH1MobileRelationship|JH2emailconcern|JH2emailrelationship|JH2MobileRelationship".split("|");

export const R2_HEADER = "amc_code|folio_no|prodcode|scheme|inv_name|trxntype|trxnno|trxnmode|trxnstat|usercode|usrtrxno|traddate|postdate|purprice|units|amount|brokcode|subbrok|brokperc|brokcomm|altfolio|rep_date|time1|trxnsubtyp|application_no|trxn_nature|tax|total_tax|te_15h|micr_no|remarks|swflag|old_folio|seq_no|reinvest_flag|mult_brok|stt|location|scheme_type|tax_status|load|scanrefno|pan|inv_iin|targ_src_scheme|trxn_type_flag|ticob_trtype|ticob_trno|ticob_posted_date|dp_id|trxn_charges|eligib_amt|src_of_txn|trxn_suffix|siptrxnno|ter_location|euin|euin_valid|euin_opted|sub_brk_arn|exch_dc_flag|src_brk_code|sys_regn_date|ac_no|bank_name|reversal_code|exchange_flag|ca_initiated_date|gst_state_code|igst_amount|cgst_amount|sgst_amount|rev_remark|original_trxnno|stamp_duty|folio_old|scheme_folio_number|amc_ref_no|request_ref_no|transmission_flag".split("|");

export const R9_HEADER = "foliochk|inv_name|address1|address2|address3|city|pincode|product|sch_name|rep_date|clos_bal|rupee_bal|jnt_name1|jnt_name2|phone_off|phone_res|email|holding_nature|uin_no|pan_no|joint1_pan|joint2_pan|guard_pan|tax_status|broker_code|subbroker|reinv_flag|bank_name|branch|ac_type|ac_no|b_address1|b_address2|b_address3|b_city|b_pincode|inv_dob|mobile_no|occupation|inv_iin|nom_name|relation|nom_addr1|nom_addr2|nom_addr3|nom_city|nom_state|nom_pincode|nom_ph_off|nom_ph_res|nom_email|nom_percentage|nom2_name|nom2_relation|nom2_addr1|nom2_addr2|nom2_addr3|nom2_city|nom2_state|nom2_pincode|nom2_ph_off|nom2_ph_res|nom2_email|nom2_percentage|nom3_name|nom3_relation|nom3_addr1|nom3_addr2|nom3_addr3|nom3_city|nom3_state|nom3_pincode|nom3_ph_off|nom3_ph_res|nom3_email|nom3_percentage|ifsc_code|dp_id|demat|guard_name|brokcode|folio_date|aadhaar|tpa_linked|fh_ckyc_no|jh1_ckyc|jh2_ckyc|g_ckyc_no|jh1_dob|jh2_dob|guardian_dob|amc_code|gst_state_code|folio_old|scheme_folio_number|country|remarks|jh1_email|jh2_email|jh1_mobile_no|jh2_mobile_no".split("|");

// Verified 2026-10-08 on the second set of real mailbacks (Phase 3C): headers
// verbatim, in order. MFSD211_V2 is the newer MFSD211 — the same report with two
// columns added at the end (FOLIO_LOCK, LockType).
export const MFSD203_HEADER = "Product Code|Fund|Folio Number|Scheme Code|Fund Description|Balance|Pledged|Transaction Date|Transaction Type|Hold Mode|Agent Code|Broker Code|P-OUT Code|Investor ID|Investor Name|Address #1|Address #2|Address #3|City|Pincode|Phone Residence|Phone Office|Fax|Email|AUM|NAV|Report Date|Report Time|Dividend Option|PldgBank|PAN|Plan|SchemeISIN|ClientID|DPID|To Date|Mobile No".split("|");
export const MFSD230_HEADER = "Prodcode|Agent|Fund|Acno|SchCode|SchDesc|InvName|Add1|Add2|Add3|City|State|Pin|Email|OffPhone|ResPhone|TrType|Freq|STARTDATE|ENDDATE|PAIDINST|PENDINST|INSTALNO|AMOUNT|ChqType|SubBroker|IHNO|REMARKS|RegDate|ECSNO|ECSBANKNAMe|ECSACNO|ECSHolderName|SIPType|STPInScheme|StpInPlan|StpInProdCode|CityCategory".split("|");
export const MFSD243_HEADER = "Zone|Branch|Location|Ihno|Folio|Investor Name|RegistrationDate|Start Date|End Date|No Of Installments|Amount|Scheme|Plan|AgentCode|AgentName|Subbroker|Scheme Name|PAN|SipType|SIP Mode|Fund Code|Product Code|Frequency|Trtype|To Scheme|To Plan|TerminateDate|Status|ToProductCode|ToSchemeName|ECSNO|ECSBankName|ECSAcno|ECSHolderName|RegSlno|InvDpId|InvClientId|DP_InvName|ModifyFlag|umrncode".split("|");
export const MFSD211_V2_HEADER = "Product Code|Fund|Folio|Fund Description|Investor Name|Joint Name 1|Joint Name 2|Address #1|Address #2|Address #3|City|Pincode|State|Country|TPIN|Date of Birth|F Name|M Name|Phone Residence|Phone Res#1|Phone Res#2|Phone Office|Phone Off#1|Phone Off#2|Fax Residence|Fax Office|Tax Status|Occ Code|Email|BankAccno|Bank Name|Account Type|Branch|Bank Address #1|Bank Address #2|Bank Address #3|Bank City|Bank Phone|Bank State|Bank Country|Investor ID|Broker Code|Report Date|Report Time|PAN Number|Mobile Number|Dividend Option|Occupation Description|Mode of Holding Description|Mapin Id|PAN2|PAN3|Category|GuardianName|Nominee|Client ID|DPID|CategoryDesc|StatusDesc|IFSC Code|Nominee2|Nominee3|Kyc1Flag|Kyc2Flag|Kyc3Flag|GuardPanNo|LastUpdatedDate|CommonAccNo|Nominee Relation|Nominee2 Relation|Nominee3 Relation|Nominee Ratio|Nominee2 Ratio|Nominee3 Ratio|Holder 1 Aadhaar info|Holder 2 Aadhaar info|Holder 3 Aadhaar info|Guardian Aadhaar info|Nominee Address1|Nominee Address2|Nominee Address3|Nominee City|Nominee State|Nominee Pin code|Nominee phone residence|Nominee Email|Nominee2 Address1|Nominee2 Address2|Nominee2 Address3|Nominee2 City|Nominee2 State|Nominee2 Pin code|Nominee2 phone residence|Nominee2 Email|Nominee3 Address1|Nominee3 Address2|Nominee3 Address3|Nominee3 City|Nominee3 State|Nominee3 Pin code|Nominee3 phone residence|Nominee3 Email|CKYC NO|JH1 CKYC|JH2 CKYC|Guardian CKYC NO|Joint Holder 1st Resi Phone No|Joint Holder 2nd Resi Phone No|Investors Resi FaxNo|KycGFlag|Demat Folio flag|Nominee Opt Out flag|Nominee DOB|Joint holder 1 contact number|Joint holder 1 Email id|Joint holder 2 contact number|Joint holder 2 Email id|Nominee Guardian Name|emailconcern|emailrelationship|MobileRelationship|UBO Flag|NPO Flag|JH1EmailConcern|JH1EmailRelationship|JH1MobileRelationship|JH2emailconcern|JH2emailrelationship|JH2MobileRelationship|FOLIO_LOCK|LockType".split("|");
export const WBR4_HEADER = "foliochk|inv_name|address1|address2|address3|city|pincode|product|sch_name|rep_date|clos_bal|rupee_bal|subbrok|reinv_flag|joint1_name|joint2_name|phone_off|phone_res|email|holding_nature|uin_no|broker_code|pan_no|joint1_pan|joint2_pan|guard_pan|tax_status|inv_iin|altfolio|euin|exchange_flag|tpa_linked|fh_ckyc_no|jh1_ckyc|jh2_ckyc|g_ckyc_no|jh1_dob|jh2_dob|guardian_dob|amc_code|gst_state_code|folio_old|scheme_folio_number|country".split("|");
export const WBR10_HEADER = "amc_code|folio_chk|sch_code|inv_name|trxntype|trxnno|trxnmode|trxnstat|usercode|usrtrxno|traddate|postdate|purprice|units|amount|brokcode|subbrok|brokperc|brokcomm|altfolio|rep_date|dummy1|trxnsubtyp|seq_no|mult_brok|tax|stt|tax_status|trxn_sign|inv_iin|sub_brk_arn|euin|broker_code|gst_state_code|igst_amount|cgst_amount|sgst_amount|stamp_duty".split("|");
export const WBR49_HEADER = "product|scheme|folio_no|inv_name|aut_trntyp|auto_trno|auto_amount|from_date|to_date|cease_date|periodicity|period_day|inv_iin|payment_mode|target_scheme|reg_date|subbroker|remarks|top_up_frq|top_up_amt|ac_type|bank|branch|instrm_no|cheq_micr_no|ac_holder_name|pan|top_up_perc|euin|sub_arn_code|ter_location|scheme_code|target_scheme_code|amc_code|user_code|package_name|special_product|subtrxndesc|pause_from_date|pause_to_date|folio_old|ft_sip_regno|scheme_folio_number|request_ref_no".split("|");

/** A row as an array in header order; unknown keys are an error (catches typos). */
export function rowOf(header: string[], values: Record<string, string | number>): (string | number)[] {
  for (const k of Object.keys(values)) if (!header.includes(k)) throw new Error(`fixture column not in header: ${k}`);
  return header.map((h) => values[h] ?? "");
}

/** KFintech CSVs are plain comma-separated text with a header row. */
export function csvOf(header: string[], rows: Record<string, string | number>[]): Buffer {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return Buffer.from([header, ...rows.map((r) => rowOf(header, r))].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n", "latin1");
}

/** CAMS ships BIFF8 .xls; date columns are serial numbers with a date format. */
export function xlsOf(header: string[], rows: Record<string, string | number>[], dateColumns: string[]): Buffer {
  const aoa = [header, ...rows.map((r) => rowOf(header, r))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const col of dateColumns) {
    const c = header.indexOf(col);
    for (let r = 1; r < aoa.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (cell && typeof cell.v === "number") cell.z = "dd-mmm-yyyy";
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
}

/** Excel serial for a calendar date (1900 system). */
export const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);

// ── Synthetic parties (fictitious PANs of valid shape) ─────────────────────
export const P = {
  adult: "AAAPZ1001A",
  adult2: "BBBPZ2002B",
  guardian: "CCCPZ3003C",
};
