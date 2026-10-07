/**
 * Well-known Indian insurers — the list the proposal builder's Insurer field
 * offers, and the names the policy parser looks for (longest match wins there,
 * so "ICICI Lombard" beats "ICICI").
 */
export const INSURERS = [
  "Life Insurance Corporation of India", "HDFC Life", "HDFC ERGO", "ICICI Prudential", "ICICI Lombard",
  "SBI Life", "SBI General", "Max Life", "Bajaj Allianz", "Tata AIA", "Tata AIG", "Kotak Mahindra",
  "Aditya Birla Sun Life", "Aditya Birla Health", "Star Health", "Care Health", "Niva Bupa", "PNB MetLife",
  "Canara HSBC", "IndiaFirst", "Pramerica", "Exide Life", "Aegon", "Edelweiss", "Bharti AXA", "Future Generali",
  "IFFCO Tokio", "Cholamandalam", "Royal Sundaram", "New India Assurance", "Oriental Insurance", "United India",
  "National Insurance", "ManipalCigna", "Reliance", "Shriram", "Digit", "Acko", "Aviva", "LIC",
] as const;
