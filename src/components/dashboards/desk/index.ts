/**
 * The RM desk's own sections — the action side of the personal cockpit
 * (lib/dashboard/my/desk.ts). Parts of one screen, not a shared library.
 */
export { MyDayPanel, NeedsMyAttention } from "./DeskToday";
export { Worklist } from "./Worklist";
export { UpcomingWeek } from "./UpcomingWeek";
export { DeskMeetings } from "./DeskMeetings";
export { LeadsNeedingAction, SipDebitCheck } from "./DeskLeadsSip";
export { FlowChart } from "./FlowChart";
export { DeskTasks } from "./DeskTasks";
export { OnboardingPipeline, SourceAnalysis } from "./DeskOnboarding";
export { MorningBrief, type BriefAction, type BriefCount } from "./MorningBrief";
export { DeskFilters } from "./DeskFilters";
export { CompleteTaskButton } from "./CompleteTaskButton";
