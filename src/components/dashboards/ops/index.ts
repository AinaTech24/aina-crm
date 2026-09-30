/**
 * The Operations page's sections (lib/dashboard/ops/*). Parts of one screen,
 * not a shared library. Its filters are the shared dashboard filter bar
 * (components/dashboards/system/DashboardFilterBar).
 */
export { AttentionPanel, CommandStripPanel, OpsQuickActions, StandupPanel } from "./OpsTop";
export { ProcessingQueue } from "./ProcessingQueue";
export {
  AgeingPanel, FunnelPanel, ReviewPanel, SlaPanel, TatQualityPanel, TimelinePanel, ValuePanel, VolumePanel,
} from "./OpsFlow";
export { OpsTrend } from "./OpsTrend";
export { RejectionsPanel, SipControlPanel } from "./OpsSip";
export {
  DocsPanel, ExternalPanel, HighValuePanel, NoUpdatePanel, PendingWithPanel, QualityPanel, QueriesPanel, RejectedPanel,
  UnassignedPanel,
} from "./OpsExceptions";
export {
  ApprovalsPanel, BackOfficePanel, BranchRmPanel, ProductivityPanel, TaskQueuePanel, TeamPanel,
} from "./OpsPeople";
