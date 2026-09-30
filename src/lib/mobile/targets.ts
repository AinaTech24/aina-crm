export const MOBILE_METRICS = [
  { key: "new_meetings", label: "New meetings completed", unit: "count" },
  { key: "review_meetings", label: "Review meetings completed", unit: "count" },
  { key: "sip", label: "New monthly SIP value", unit: "inr" },
  { key: "lumpsum", label: "Lumpsum investments", unit: "inr" },
  { key: "mf_business", label: "MF business booked", unit: "inr" },
  { key: "insurance_premium", label: "Insurance annual premium booked", unit: "inr" },
  { key: "insurance_policies", label: "Insurance policies sold", unit: "count" },
] as const;
export function targetPeriod(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw Object.assign(new Error("Use a month in YYYY-MM format"), { status: 400 });
  const [year, month] = period.split("-").map(Number);
  const fy = month >= 4 ? year : year - 1;
  return { start: `${period}-01`, end: `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`, fiscalYear: `${fy}-${String(fy + 1).slice(-2)}`, prefix: `mobile.${period}.` };
}
