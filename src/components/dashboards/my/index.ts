/**
 * The personal cockpit's components, in the order the page uses them.
 *
 * A barrel here rather than eleven deep imports in MyBusinessDashboard, since
 * the page's import block was becoming longer than its render tree. Nothing
 * else in the app should import from here — these are parts of one screen, not
 * a shared library.
 */
export { QuickActions } from "./QuickActions";
export { ActionCentre } from "./ActionCentre";
export { MyKpiStrip } from "./MyKpiStrip";
export { MyTargets } from "./MyTargets";
export { MyTrendChart } from "./MyTrend";
export { MyClientBook, MyKeyClients } from "./MyClientBook";
export { MyReviewDesk } from "./MyReviewDesk";
export { MyFunnel, MyMeetings, MyProposals } from "./MyPipeline";
export { MyRedemptions, MySipHealth } from "./MyExceptions";
export { MyQueryPanel, MyTaskPanel } from "./MyWork";
export { MyContactGap, MyDataQuality, MyInsurance, MyOpportunities, MyRiskDesk } from "./MyRelationships";
export { MyMonthlySummary } from "./MyMonthlySummary";
