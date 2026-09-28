/**
 * The branch command centre's own components. Parts of one screen, not a
 * shared library — the generic pieces they are built from live in
 * ../my/Shared.tsx and ./RmTable.tsx.
 */
export { ParamSelect } from "./ParamSelect";
export { RmTable, rmRows, peopleRows, type RmCol } from "./RmTable";
export {
  BranchTargets, RmScoreboard, RmTargetMatrix, RmOneOnOne, FyScorecard, ToggleChips,
  SCORE_SORTS, type ScoreSort, type Horizon,
} from "./BranchPerformance";
export { BranchSipPerformance, BranchSipExceptions } from "./BranchSip";
export { BranchInvestmentFlow, BranchRedemptions, BranchAcquisition, HV_PRESETS } from "./BranchFlows";
export { BranchFunnel, BranchProposals, BranchMeetings, BranchReviews } from "./BranchPipeline";
export { BranchActivity, BranchTasks, BranchQueries } from "./BranchWork";
export { BranchInsurance, BranchOps, AttentionCentre } from "./BranchService";
export { ClientBookByRm, ContactByRm, DataQualityByRm, RiskByRm } from "./BranchExtras";
export { ReviewModePanel, BranchQuickActions } from "./BranchReview";
