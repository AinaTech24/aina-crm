/**
 * lib/metrics — the ONE place a number on a dashboard, a sidebar badge, a
 * module page or a report is defined. SERVER-ONLY (imports the DB).
 *
 * Every function takes an explicit MetricScope (tenant + the viewer's access +
 * the dashboard filters), so the same question asked from two screens is the
 * same query. If a screen needs a figure that is not here, add it here — do
 * not write the SQL inside the widget.
 *
 *   getAUM                  clients.ts      Σ investors.aum of live clients
 *   getActiveClients        clients.ts      clients / active / funded
 *   getSipBook              sip.ts          Σ monthly active SIPs of live clients
 *   getBookedBusiness       entries.ts      gross, redemption, net, net SIP — BOOKED; every dashboard
 *   getBookedNetByRm/Branch entries.ts      booked net business per RM / branch
 *   getBookedMonthlyFlows   entries.ts      booked gross / redemption / net by month
 *   getNetBusiness          business.ts     the same from the RTA ledger (matching, incentives) — not dashboards
 *   getNewClients(period)   new-clients.ts  onboarded in the period
 *   getClientHealth(id)     health.ts       live score, cache kept equal
 *   getOpenLeads            leads.ts        open now + follow-ups due
 *   getLeadStageCounts      leads.ts        board columns + conversion
 *   getOpenServiceRequests  service.ts      the SR page's tabs + past SLA
 *   getOverdueTasks         tasks.ts        per person (badge) or scope
 *   getRiskProfileCounts    risk.ts         the Risk Profiles page's tabs
 *   getStockHistory         practice.ts     AUM / SIP book month by month (recorded)
 *   getSipHealth            practice.ts     persistency, started / stopped, rejections
 *   getAumMix               practice.ts     AUM by fund house and client tier
 *   getClientMix            practice.ts     the book by state, and exits
 *   getBrokerage            practice.ts     brokerage by month and fund house
 *   getAutomationMonth      practice.ts     what the workflows did this month
 *   getEntryMatrix          entries.ts      Business Entries: product x asset class flows
 *   getEntrySipFlow         entries.ts      Business Entries: SIP added / stopped / net
 *   getBookBreakdown        book.ts         clients by category / type / status / KYC
 *   getMeetingSummary       meetings.ts     meetings by kind x status
 *   getReviewsDue           meetings.ts     next review overdue / this month / 30 days
 *   getTaskSummary          work-summary.ts tasks created, financial vs non-financial
 *   getSipRejectionSummary  work-summary.ts SIP rejections by recovery status
 *   getPremiumByProduct     insurance-mix.ts new / renewal premium by product
 *   getClaimsByStatus       insurance-mix.ts claims intimated in a period by status
 *   getStockOn              history.ts      AUM / SIP book as recorded on a date
 *   getAumBridge, getSipBridge, getAssetClassMix, getClientConcentration,
 *   getSipRetentionByStart, getAgeBands, getClientGeography
 *                           book-shape.ts   the dashboards' bridge / treemap / curve / map charts
 */

export * from "./scope";
export * from "./clients";
export * from "./sip";
export * from "./business";
export * from "./new-clients";
export * from "./health";
export * from "./leads";
export * from "./service";
export * from "./tasks";
export * from "./risk";
export * from "./insurance";
export * from "./history";
export * from "./attention";
export * from "./targets";
export * from "./compliance";
export * from "./practice";
export * from "./in-order";
export * from "./entries";
export * from "./book";
export * from "./meetings";
export * from "./book-shape";
export * from "./asset-class";
export * from "./work-summary";
export * from "./insurance-mix";
export * from "./opportunities";
export * from "./owner-dependency";
