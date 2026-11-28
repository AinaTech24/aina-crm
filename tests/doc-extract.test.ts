import { describe, expect, it } from "vitest";
import { detectKind, extractFromText, parseAadhaar, parseAddress, parseBank, parsePanCard } from "@/lib/onboarding/doc-extract";

const PAN_NEW = `आयकर विभाग INCOME TAX DEPARTMENT भारत सरकार GOVT. OF INDIA
स्थायी लेखा संख्या कार्ड
Permanent Account Number Card
ABCPS1234K
नाम / Name
RAHUL KUMAR SHARMA
पिता का नाम / Father's Name
SURESH KUMAR SHARMA
जन्म की तारीख / Date of Birth
15/08/1990
हस्ताक्षर / Signature`;

const PAN_OLD = `INCOME TAX DEPARTMENT GOVT. OF INDIA
PRIYA NAIR
GOPALAN NAIR
03/12/1988
Permanent Account Number
BQRPN4321C
Signature`;

const PAN_COMPANY = `INCOME TAX DEPARTMENT GOVT. OF INDIA
Permanent Account Number Card
AAACV1234E
Name
VSN FINANCIAL SERVICES PRIVATE LIMITED
Date of Incorporation/Formation
21/06/2011`;

const AADHAAR_FRONT = `भारत सरकार
Government of India
प्रिया नायर
Priya Nair
जन्म तिथि/DOB: 03/12/1988
महिला/ FEMALE
4567 8912 3456
मेरा आधार, मेरी पहचान`;

const AADHAAR_BACK = `Unique Identification Authority of India
Address: D/O Gopalan Nair, 12, Shanti Kunj, MG Road, Navrangpura, Ahmedabad, Gujarat - 380009
4567 8912 3456
1947`;

const CHEQUE = `HDFC BANK
We understand your world
Branch: Navrangpura, Ahmedabad
IFSC: HDFC0001234
SB A/c No. 50100123456789
PRIYA NAIR
"123456" 380240002: 000123" 10`;

const STATEMENT_OCR = `STATE BANK OF INDIA
Account Statement
Account Number : 3012 3456 789
Account Type : SAVINGS ACCOUNT
IFS Code : SBIN O001234
Address : 45, Ring Road, Satellite, Ahmedabad, Gujarat 380015`;

describe("PAN card", () => {
  it("new format: name and father's name from their labels, DOB, PAN", () => {
    expect(parsePanCard(PAN_NEW)).toEqual({ pan: "ABCPS1234K", name_as_per_pan: "Rahul Kumar Sharma", father_name: "Suresh Kumar Sharma", dob: "1990-08-15" });
  });
  it("old format: the first two name lines", () => {
    expect(parsePanCard(PAN_OLD)).toEqual({ pan: "BQRPN4321C", name_as_per_pan: "Priya Nair", father_name: "Gopalan Nair", dob: "1988-12-03" });
  });
  it("a company PAN gives the incorporation date, not a birthday", () => {
    const f = parsePanCard(PAN_COMPANY);
    expect(f.pan).toBe("AAACV1234E");
    expect(f.date_of_incorporation).toBe("2011-06-21");
    expect(f.dob).toBeUndefined();
    expect(f.name_as_per_pan).toBe("Vsn Financial Services Private Limited");
  });
});

describe("Aadhaar", () => {
  it("front: English name, DOB, gender, number masked to the last four", () => {
    expect(parseAadhaar(AADHAAR_FRONT)).toEqual({ name_as_per_pan: "Priya Nair", dob: "1988-12-03", gender: "Female", aadhaar: "XXXX XXXX 3456" });
  });
  it("never returns the full number", () => {
    expect(JSON.stringify(parseAadhaar(AADHAAR_FRONT + "\n" + AADHAAR_BACK))).not.toContain("4567 8912");
  });
  it("back: the address without the care-of", () => {
    expect(parseAddress(AADHAAR_BACK)).toEqual({
      address_pincode: "380009",
      address_state: "Gujarat",
      address_city: "Ahmedabad",
      address_line1: "12, Shanti Kunj, MG Road, Navrangpura",
    });
  });
  it("a 16-digit VID is not an Aadhaar number", () => {
    expect(parseAadhaar("VID : 9123 4567 8912 3456").aadhaar).toBeUndefined();
  });
});

describe("bank documents", () => {
  it("cheque: IFSC, bank from the IFSC, account number, savings", () => {
    expect(parseBank(CHEQUE)).toEqual({ bank_ifsc: "HDFC0001234", bank_name: "HDFC Bank", bank_account_number: "50100123456789", bank_account_type: "Savings" });
  });
  it("statement OCR: IFSC with an O for the zero, spaced account number", () => {
    expect(parseBank(STATEMENT_OCR)).toEqual({ bank_ifsc: "SBIN0001234", bank_name: "State Bank of India", bank_account_number: "30123456789", bank_account_type: "Savings" });
  });
});

describe("routing a document to the right fields", () => {
  it("recognises each kind, whatever slot it went into", () => {
    expect(detectKind(PAN_NEW)).toBe("pan");
    expect(detectKind(AADHAAR_FRONT)).toBe("aadhaar");
    expect(detectKind(CHEQUE)).toBe("bank");
  });
  it("a guardian's PAN fills the guardian fields", () => {
    expect(extractFromText(PAN_OLD, "guardian_pan").fields).toEqual({ guardian_name: "Priya Nair", guardian_pan: "BQRPN4321C" });
  });
  it("a karta's PAN fills the authorised person; a guardian's Aadhaar fills nothing", () => {
    expect(extractFromText(PAN_NEW, "karta_pan").fields).toEqual({ authorised_person_name: "Rahul Kumar Sharma", authorised_person_pan: "ABCPS1234K" });
    expect(extractFromText(AADHAAR_FRONT, "guardian_aadhar").fields).toEqual({});
  });
  it("an unreadable photo gives nothing, not guesses", () => {
    expect(extractFromText("|||  ~~ blurry ~~ ", "pan").fields).toEqual({});
  });
});
