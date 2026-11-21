/**
 * The calculator maths the app's tests and older call sites import by name.
 * Every symbol is RE-EXPORTED from the web CRM's own module, copied verbatim
 * into ./web by web/sync-from-web.mjs — this file holds no formulas, so the
 * app cannot drift from the CRM's figures. (It used to hold a hand port, which
 * went stale when the web's calculators moved on.)
 *
 * Rate conventions differ per module and are the web's: the goal-planning
 * helpers use a NOMINAL monthly rate r/12; the SIP-360 family (crash-stress,
 * fire, nps, child-education, emi-sip, growingSipSchedule) an EFFECTIVE monthly
 * rate (1 + r)^(1/12) − 1.
 */

export {
  growingSipSchedule, costOfDelay, retirementCorpus, swpDeplete, stpCalculate, cagrCalculate,
  type SipYearRow, type GrowingSipResult, type StpResult, type CagrResult,
} from "./web/goal-planning-calc";
export { monthsToTarget, dateAfterMonths, rentVsBuy, fdVsEquity, croreRace } from "./web/conversion";
export { btid, emergencyFund, doublingTimeline, lumpsumNetOfSavings } from "./web/advisory";
export {
  computeEmi, computeEmiSip, lumpsumNeededToday as emiLumpsumNeededToday,
  type EmiSipMode, type EmiSipInput, type EmiSipResult,
} from "./web/emi-sip";
export { computeCrashStress, type CrashStressInput, type CrashPoint, type CrashStressResult } from "./web/crash-stress";
export { computeFire, type FireInput, type FireResult } from "./web/fire";
export { computeNps, type NpsInput, type NpsResult } from "./web/nps";
export { isDueNow, requiredMonthlySip, lumpsumNeededToday } from "./web/goal-collision";
export {
  computeChildEducation, type EduMilestone, type ChildEducationInput, type EduMilestoneResult, type ChildEducationResult,
} from "./web/child-education";
export { monthlyRate } from "./web/sip360";
