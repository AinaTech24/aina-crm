/**
 * Today's date in India, 'YYYY-MM-DD', by offset arithmetic — the app's way
 * (features/fixed-deposits/terms.ts). The copied calc / checks read it with
 * toLocaleDateString("en-CA", { timeZone }), whose output Hermes does not
 * promise on every phone, so the screens pass this as `opts.today` instead;
 * both functions take it, and the answers are the CRM's.
 */
export const indiaToday = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
