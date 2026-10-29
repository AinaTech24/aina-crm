/**
 * Placing clients on the India map (lib/geo/india-map.ts): today's state
 * names onto the map's shapes, and the cities the firms' clients live in onto
 * map coordinates. Pure.
 *
 * Cities are a curated list of where Indian MFD clients mostly are, each
 * checked to fall inside its own state's shape. A city not on the list still
 * counts toward its state; it is simply not drawn as a dot (the card lists
 * every city by name).
 */

import { canonicalState } from "./places";

/** The map predates 2019: Ladakh sits in J&K, and DNH / Daman and Diu are two shapes. */
const STATE_SHAPES: Record<string, string[]> = {
  "Andaman and Nicobar Islands": ["an"], "Andhra Pradesh": ["ap"], "Arunachal Pradesh": ["ar"], "Assam": ["as"],
  "Bihar": ["br"], "Chandigarh": ["ch"], "Chhattisgarh": ["ct"], "Dadra and Nagar Haveli and Daman and Diu": ["dn", "dd"],
  "Delhi": ["dl"], "Goa": ["ga"], "Gujarat": ["gj"], "Haryana": ["hr"], "Himachal Pradesh": ["hp"],
  "Jammu and Kashmir": ["jk"], "Ladakh": ["jk"], "Jharkhand": ["jh"], "Karnataka": ["ka"], "Kerala": ["kl"],
  "Lakshadweep": ["ld"], "Madhya Pradesh": ["mp"], "Maharashtra": ["mh"], "Manipur": ["mn"], "Meghalaya": ["ml"],
  "Mizoram": ["mz"], "Nagaland": ["nl"], "Odisha": ["or"], "Puducherry": ["py"], "Punjab": ["pb"],
  "Rajasthan": ["rj"], "Sikkim": ["sk"], "Tamil Nadu": ["tn"], "Telangana": ["tg"], "Tripura": ["tr"],
  "Uttar Pradesh": ["up"], "Uttarakhand": ["ut"], "West Bengal": ["wb"],
};

/** The map shapes a state (any spelling canonicalState knows) is drawn on; [] when unknown. */
export function mapShapesForState(state: string | null | undefined): string[] {
  const c = canonicalState(state);
  return c ? STATE_SHAPES[c] ?? [] : [];
}

/** The canonical state name, for grouping. */
export function stateKey(state: string | null | undefined): string | null {
  const c = canonicalState(state);
  return c && STATE_SHAPES[c] ? c : null;
}

/** [name, state, lat, lon] */
const CITIES: Array<[string, string, number, number]> = [
  ["Mumbai", "Maharashtra", 19.08, 72.88], ["Thane", "Maharashtra", 19.22, 72.98], ["Navi Mumbai", "Maharashtra", 19.03, 73.03],
  ["Pune", "Maharashtra", 18.52, 73.86], ["Nagpur", "Maharashtra", 21.15, 79.09], ["Nashik", "Maharashtra", 20.0, 73.79],
  ["Chhatrapati Sambhajinagar", "Maharashtra", 19.88, 75.34], ["Kolhapur", "Maharashtra", 16.7, 74.24],
  ["Solapur", "Maharashtra", 17.66, 75.91], ["Ahmednagar", "Maharashtra", 19.09, 74.74], ["Amravati", "Maharashtra", 20.93, 77.75],
  ["Nanded", "Maharashtra", 19.15, 77.31], ["Jalgaon", "Maharashtra", 21.0, 75.56], ["Sangli", "Maharashtra", 16.85, 74.58],
  ["Satara", "Maharashtra", 17.68, 74.02],
  ["Ahmedabad", "Gujarat", 23.02, 72.57], ["Surat", "Gujarat", 21.17, 72.83], ["Vadodara", "Gujarat", 22.31, 73.18],
  ["Rajkot", "Gujarat", 22.3, 70.8], ["Bhavnagar", "Gujarat", 21.76, 72.15], ["Jamnagar", "Gujarat", 22.47, 70.06],
  ["Gandhinagar", "Gujarat", 23.22, 72.65], ["Anand", "Gujarat", 22.56, 72.95], ["Navsari", "Gujarat", 20.95, 72.92],
  ["Valsad", "Gujarat", 20.61, 72.93], ["Vapi", "Gujarat", 20.37, 72.9], ["Junagadh", "Gujarat", 21.52, 70.46],
  ["Bharuch", "Gujarat", 21.71, 72.98], ["Mehsana", "Gujarat", 23.6, 72.37], ["Nadiad", "Gujarat", 22.69, 72.86],
  ["Morbi", "Gujarat", 22.82, 70.84], ["Bhuj", "Gujarat", 23.24, 69.67], ["Palanpur", "Gujarat", 24.17, 72.43],
  ["Gandhidham", "Gujarat", 23.08, 70.13],
  ["Delhi", "Delhi", 28.61, 77.21], ["Gurugram", "Haryana", 28.46, 77.03], ["Faridabad", "Haryana", 28.41, 77.32],
  ["Panipat", "Haryana", 29.39, 76.97], ["Ambala", "Haryana", 30.38, 76.78],
  ["Noida", "Uttar Pradesh", 28.54, 77.39], ["Ghaziabad", "Uttar Pradesh", 28.67, 77.45], ["Lucknow", "Uttar Pradesh", 26.85, 80.95],
  ["Kanpur", "Uttar Pradesh", 26.45, 80.33], ["Agra", "Uttar Pradesh", 27.18, 78.01], ["Varanasi", "Uttar Pradesh", 25.32, 82.97],
  ["Prayagraj", "Uttar Pradesh", 25.44, 81.85], ["Meerut", "Uttar Pradesh", 28.98, 77.71],
  ["Bengaluru", "Karnataka", 12.97, 77.59], ["Mysuru", "Karnataka", 12.3, 76.64], ["Mangaluru", "Karnataka", 12.91, 74.86],
  ["Hubballi", "Karnataka", 15.36, 75.12], ["Belagavi", "Karnataka", 15.85, 74.5],
  ["Chennai", "Tamil Nadu", 13.08, 80.27], ["Coimbatore", "Tamil Nadu", 11.02, 76.96], ["Madurai", "Tamil Nadu", 9.93, 78.12],
  ["Tiruchirappalli", "Tamil Nadu", 10.79, 78.7], ["Salem", "Tamil Nadu", 11.66, 78.15],
  ["Hyderabad", "Telangana", 17.39, 78.49], ["Warangal", "Telangana", 17.97, 79.59],
  ["Visakhapatnam", "Andhra Pradesh", 17.69, 83.22], ["Vijayawada", "Andhra Pradesh", 16.51, 80.65],
  ["Guntur", "Andhra Pradesh", 16.31, 80.44], ["Tirupati", "Andhra Pradesh", 13.63, 79.42],
  ["Kochi", "Kerala", 9.93, 76.27], ["Thiruvananthapuram", "Kerala", 8.52, 76.94], ["Kozhikode", "Kerala", 11.26, 75.78],
  ["Thrissur", "Kerala", 10.53, 76.21],
  ["Kolkata", "West Bengal", 22.57, 88.36], ["Howrah", "West Bengal", 22.59, 88.31], ["Siliguri", "West Bengal", 26.73, 88.4],
  ["Durgapur", "West Bengal", 23.52, 87.31],
  ["Jaipur", "Rajasthan", 26.91, 75.79], ["Jodhpur", "Rajasthan", 26.24, 73.02], ["Udaipur", "Rajasthan", 24.59, 73.71],
  ["Kota", "Rajasthan", 25.21, 75.86], ["Ajmer", "Rajasthan", 26.45, 74.64], ["Bikaner", "Rajasthan", 28.02, 73.31],
  ["Indore", "Madhya Pradesh", 22.72, 75.86], ["Bhopal", "Madhya Pradesh", 23.26, 77.41], ["Jabalpur", "Madhya Pradesh", 23.18, 79.99],
  ["Gwalior", "Madhya Pradesh", 26.22, 78.18], ["Ujjain", "Madhya Pradesh", 23.18, 75.78],
  ["Ludhiana", "Punjab", 30.9, 75.85], ["Amritsar", "Punjab", 31.63, 74.87], ["Jalandhar", "Punjab", 31.33, 75.58],
  ["Patiala", "Punjab", 30.34, 76.39], ["Chandigarh", "Chandigarh", 30.73, 76.78],
  ["Patna", "Bihar", 25.59, 85.14], ["Ranchi", "Jharkhand", 23.34, 85.31], ["Jamshedpur", "Jharkhand", 22.8, 86.2],
  ["Dhanbad", "Jharkhand", 23.8, 86.43], ["Bhubaneswar", "Odisha", 20.3, 85.82], ["Cuttack", "Odisha", 20.46, 85.88],
  ["Raipur", "Chhattisgarh", 21.25, 81.63], ["Bhilai", "Chhattisgarh", 21.21, 81.38], ["Guwahati", "Assam", 26.14, 91.74],
  ["Dehradun", "Uttarakhand", 30.32, 78.03], ["Haridwar", "Uttarakhand", 29.95, 78.16], ["Shimla", "Himachal Pradesh", 31.1, 77.17],
  ["Srinagar", "Jammu and Kashmir", 34.08, 74.8], ["Jammu", "Jammu and Kashmir", 32.73, 74.86],
  ["Panaji", "Goa", 15.49, 73.83], ["Margao", "Goa", 15.27, 73.96], ["Puducherry", "Puducherry", 11.94, 79.81],
  ["Silvassa", "Dadra and Nagar Haveli and Daman and Diu", 20.27, 73.01],
];

const ALIASES: Record<string, string> = {
  bombay: "mumbai", poona: "pune", bangalore: "bengaluru", "bengaluru urban": "bengaluru", "bangalore urban": "bengaluru",
  calcutta: "kolkata", madras: "chennai", baroda: "vadodara", gurgaon: "gurugram", "new delhi": "delhi",
  "delhi ncr": "delhi", trivandrum: "thiruvananthapuram", cochin: "kochi", ernakulam: "kochi", mysore: "mysuru",
  mangalore: "mangaluru", hubli: "hubballi", belgaum: "belagavi", vizag: "visakhapatnam", allahabad: "prayagraj",
  trichy: "tiruchirappalli", aurangabad: "chhatrapati sambhajinagar", panjim: "panaji", pondicherry: "puducherry",
  bhubaneshwar: "bhubaneswar", calicut: "kozhikode", "navi mumbai": "navi mumbai", "greater noida": "noida",
  ahmadabad: "ahmedabad", "mumbai suburban": "mumbai",
};

/** A city's grouping key: lower case, punctuation and "city"/"district" dropped, aliases applied. */
export function cityKey(city: string | null | undefined): string | null {
  if (!city) return null;
  let k = city.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim().replace(/ (city|district|dist)$/, "");
  if (!k || k === "na" || k === "n a") return null;
  k = ALIASES[k] ?? k;
  return k;
}

const BY_KEY = new Map(CITIES.map(([name, state, lat, lon]) => [name.toLowerCase(), { name, state, lat, lon }]));

/** The curated city for a key, or null (it still counts toward its state). */
export function knownCity(key: string | null): { name: string; state: string; lat: number; lon: number } | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

/** Title case for a city the list does not know ("navsari" → "Navsari"). */
export function cityLabel(key: string): string {
  return knownCity(key)?.name ?? key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Every curated city — for the test that each sits inside its own state. */
export const CURATED_CITIES = CITIES.map(([name, state, lat, lon]) => ({ name, state, lat, lon }));

// Mercator, calibrated to the map's edges (Gujarat's west tip, Arunachal's
// east, J&K's north, Kanyakumari) and checked city by city.
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const Y_TOP = merc(37.08);
const Y_BOTTOM = merc(8.08);

/** Latitude / longitude → the map's x / y (viewBox 0 0 612 696). */
export function projectToMap(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon - 68.17) / (97.4 - 68.17)) * 611.9, y: ((Y_TOP - merc(lat)) / (Y_TOP - Y_BOTTOM)) * 667.3 };
}
