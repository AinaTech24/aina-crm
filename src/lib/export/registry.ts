/**
 * Every module the Export button can export. Add a module: write its
 * definition in ./modules/, add it here, and put
 * <ExportButton module="<key>" /> in its list page's header.
 */

import type { ExportModule } from "./types";
import { clientsExport } from "./modules/clients";
import {
  campaignsExport, documentsExport, insuranceClaimsExport, insurancePoliciesExport, insuranceRenewalsExport, templatesExport,
} from "./modules/insurance-marketing";
import {
  clientFeedbackExport, discoveryExport, familiesExport, leadsExport, riskProfilesExport,
} from "./modules/relationships";
import {
  amcEmpanelmentsExport, attendanceExport, leaveExport, legalRegistrationsExport, productOfferingsExport,
  schemeMasterExport, subDistributorsExport, teamMembersExport,
} from "./modules/team-admin";
import {
  businessEntriesExport, financialPlansExport, fixedDepositsExport, goalsExport, proposalsExport,
  sipBookExport, sipRejectionsExport, transactionsExport,
} from "./modules/business";
import {
  activitiesExport, expectedInflowsExport, meetingsExport, serviceRequestsExport, tasksExport,
} from "./modules/work";

const ALL: ExportModule[] = [
  clientsExport,
  leadsExport, familiesExport, riskProfilesExport, discoveryExport, clientFeedbackExport,
  insurancePoliciesExport, insuranceRenewalsExport, insuranceClaimsExport, campaignsExport, templatesExport, documentsExport,
  teamMembersExport, attendanceExport, leaveExport, subDistributorsExport, legalRegistrationsExport,
  schemeMasterExport, amcEmpanelmentsExport, productOfferingsExport,
  sipBookExport, sipRejectionsExport, transactionsExport, businessEntriesExport, fixedDepositsExport,
  goalsExport, financialPlansExport, proposalsExport,
  tasksExport, meetingsExport, serviceRequestsExport, activitiesExport, expectedInflowsExport,
];

export const EXPORT_MODULES: Record<string, ExportModule> = Object.fromEntries(ALL.map((m) => [m.key, m]));
