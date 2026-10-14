/**
 * States of India and countries, for the client master's address dropdowns.
 * A plain module (no "use client"), so the forms, the pincode lookup and the
 * imports can all use it.
 *
 * Stored values are the names below. What arrives from elsewhere is spelled
 * many ways — India Post writes "Chattisgarh", registrar files "MH" or
 * "MAHARASHTRA", people type "UAE" — and canonicalState / canonicalCountry map
 * those onto the list, so a value on file shows as the right option.
 */

/** The 28 states, then the 8 union territories. */
export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

/** India first, then the rest A–Z. */
export const COUNTRIES = [
  "India",
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia",
  "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
  "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada", "Cape Verde", "Central African Republic", "Chad",
  "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt",
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau",
  "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "Indonesia", "Iran", "Iraq", "Ireland",
  "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
  "Lithuania", "Luxembourg", "Macau", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
  "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia",
  "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand",
  "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau",
  "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
  "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
  "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
  "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa",
  "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago",
  "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
  "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen",
  "Zambia", "Zimbabwe",
];

/** Lower case, "&" read as "and", punctuation and extra spaces gone. */
function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const STATE_BY_NORM = new Map(INDIAN_STATES.map((s) => [norm(s), s]));
const STATE_ALIASES: Record<string, string> = {
  chattisgarh: "Chhattisgarh", chhatisgarh: "Chhattisgarh", orissa: "Odisha", pondicherry: "Puducherry",
  "nct of delhi": "Delhi", "new delhi": "Delhi", "delhi nct": "Delhi", uttaranchal: "Uttarakhand",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu", "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
  "andaman and nicobar": "Andaman and Nicobar Islands", "andaman nicobar islands": "Andaman and Nicobar Islands",
  "j and k": "Jammu and Kashmir", "jammu kashmir": "Jammu and Kashmir", "tamilnadu": "Tamil Nadu",
};
/** Two-letter state codes as registrar and GST records write them. */
const STATE_CODES: Record<string, string> = {
  ap: "Andhra Pradesh", ar: "Arunachal Pradesh", as: "Assam", br: "Bihar", cg: "Chhattisgarh", ct: "Chhattisgarh",
  ga: "Goa", gj: "Gujarat", hr: "Haryana", hp: "Himachal Pradesh", jh: "Jharkhand", ka: "Karnataka", kl: "Kerala",
  mp: "Madhya Pradesh", mh: "Maharashtra", mn: "Manipur", ml: "Meghalaya", mz: "Mizoram", nl: "Nagaland",
  od: "Odisha", or: "Odisha", pb: "Punjab", rj: "Rajasthan", sk: "Sikkim", tn: "Tamil Nadu", tg: "Telangana",
  ts: "Telangana", tr: "Tripura", up: "Uttar Pradesh", uk: "Uttarakhand", ut: "Uttarakhand", wb: "West Bengal",
  an: "Andaman and Nicobar Islands", ch: "Chandigarh", dn: "Dadra and Nagar Haveli and Daman and Diu",
  dd: "Dadra and Nagar Haveli and Daman and Diu", dh: "Dadra and Nagar Haveli and Daman and Diu", dl: "Delhi",
  jk: "Jammu and Kashmir", la: "Ladakh", ld: "Lakshadweep", py: "Puducherry",
};

/** The list's name for a state written any common way, or null when it is not one. */
export function canonicalState(s: string | null | undefined): string | null {
  const n = norm(s ?? "");
  if (!n) return null;
  return STATE_BY_NORM.get(n) ?? STATE_ALIASES[n] ?? (n.length === 2 ? STATE_CODES[n] : undefined) ?? null;
}

const COUNTRY_BY_NORM = new Map(COUNTRIES.map((c) => [norm(c), c]));
const COUNTRY_ALIASES: Record<string, string> = {
  in: "India", ind: "India", bharat: "India",
  us: "United States", usa: "United States", "u s a": "United States", "united states of america": "United States", america: "United States",
  uk: "United Kingdom", "u k": "United Kingdom", "great britain": "United Kingdom", britain: "United Kingdom", england: "United Kingdom",
  uae: "United Arab Emirates", "u a e": "United Arab Emirates", dubai: "United Arab Emirates",
  ksa: "Saudi Arabia", "republic of korea": "South Korea", korea: "South Korea", holland: "Netherlands",
  "cote d ivoire": "Ivory Coast", "czechia": "Czech Republic", "russian federation": "Russia", swaziland: "Eswatini",
};

/** The list's name for a country written any common way, or null when it is not one. */
export function canonicalCountry(s: string | null | undefined): string | null {
  const n = norm(s ?? "");
  if (!n) return null;
  return COUNTRY_BY_NORM.get(n) ?? COUNTRY_ALIASES[n] ?? null;
}

/** An address in India — blank counts, since most clients' records are. */
export function isIndianAddress(country: string | null | undefined): boolean {
  return !(country ?? "").trim() || canonicalCountry(country) === "India";
}
