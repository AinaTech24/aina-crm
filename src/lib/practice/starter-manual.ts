/**
 * The starter operations manual — the "franchise prototype" half-built.
 *
 * Gerber's point in The E-Myth Revisited is that a firm should run on a
 * written system, not on the owner's memory. A new MFD firm should not start
 * that system from a blank page, so this is a curated manual for an Indian
 * mutual fund distribution practice: the core SOPs, plus a short call script
 * for each main stage of the Lead → Client journey. The firm installs it with
 * one click (lib/practice/install-starter-manual.ts) and then edits every SOP
 * to fit — each one is an ordinary SOP afterwards, versioned and signed off.
 *
 * Written for a DISTRIBUTOR (ARN holder): the firm recommends through
 * suitability and the client's risk profile, never promises a return, and
 * never describes what it does as investment advisory work. The flow matches
 * the task template library (lib/tasks/mfd-template-library.ts): KYC → UCC →
 * mandate before any order, execution on BSE StAR MF / NSE NMF II before the
 * cut-off, confirmation from the RTA (CAMS / KFintech), and the record in the
 * CRM.
 *
 * Pure data, no I/O. `appliesTo` attaches each SOP to where the work happens
 * (sop_links, migration 0234): a core process (PRACTICE_PROCESSES), a position
 * (DEFAULT_POSITIONS key — stored as the firm's position id at install), a
 * task type, a service-request type or a journey stage ("lead:<stageKey>").
 */

import type { SopLinkKind } from "@/db/schema/practice";

export type StarterLink = { kind: Exclude<SopLinkKind, "task_template">; key: string };

export type StarterSop = {
  /** Stable key — matched against sops.key so an install never duplicates. */
  key: string;
  title: string;
  category: StarterCategory;
  appliesTo: StarterLink[];
  /** CRM roles that must sign it off, on top of those implied by its positions. */
  extraRoles?: string[];
  markdown: string;
};

export const STARTER_CATEGORIES = [
  "Client acquisition",
  "Onboarding",
  "Transactions",
  "Service",
  "Reviews",
  "Compliance",
  "Operations",
  "Insurance",
  "Team",
  "Scripts",
] as const;
export type StarterCategory = (typeof STARTER_CATEGORIES)[number];

/** The headings every SOP carries, in order (the test checks them). */
export const SOP_HEADINGS = ["Purpose", "When", "Who", "Steps", "Done means", "Common mistakes"] as const;
/** The headings every call script carries, in order. */
export const SCRIPT_HEADINGS = ["Opener", "Questions", "Objections", "Next step", "What to log"] as const;

// ─────────────────────────────────────────────────────────── builders ──

function sopMd(s: {
  purpose: string;
  when: string;
  who: string;
  steps: string[];
  done: string[];
  mistakes: string[];
}): string {
  return [
    "## Purpose",
    s.purpose,
    "",
    "## When",
    s.when,
    "",
    "## Who",
    s.who,
    "",
    "## Steps",
    ...s.steps.map((x, i) => `${i + 1}. ${x}`),
    "",
    "## Done means",
    ...s.done.map((x) => `- ${x}`),
    "",
    "## Common mistakes",
    ...s.mistakes.map((x) => `- ${x}`),
  ].join("\n");
}

function scriptMd(s: {
  goal: string;
  opener: string;
  questions: string[];
  objections: Array<[string, string]>;
  next: string;
  log: string[];
}): string {
  return [
    s.goal,
    "",
    "## Opener",
    s.opener,
    "",
    "## Questions",
    ...s.questions.map((x, i) => `${i + 1}. ${x}`),
    "",
    "## Objections",
    ...s.objections.map(([o, r]) => `- **"${o}"** — ${r}`),
    "",
    "## Next step",
    s.next,
    "",
    "## What to log",
    ...s.log.map((x) => `- ${x}`),
    "",
    "**Never promise or imply a return.** Past performance may or may not be sustained in future, and mutual fund investments are subject to market risks — say so whenever performance comes up.",
  ].join("\n");
}

const P = (key: string): StarterLink => ({ kind: "process", key });
const POS = (key: string): StarterLink => ({ kind: "position", key });
const TT = (key: string): StarterLink => ({ kind: "task_type", key });
const SR = (key: string): StarterLink => ({ kind: "sr_type", key });
const STAGE = (key: string): StarterLink => ({ kind: "blueprint_stage", key: `lead:${key}` });

const CUTOFF =
  "Check the cut-off: 1:30 PM for liquid and overnight funds, 3:00 PM for every other scheme. Units are allotted at the NAV of the day the money reaches the AMC (on the exchange route, the clearing corporation) before the cut-off — so collect the payment early, and remember the platforms close order entry a little before the SEBI cut-off.";

// ───────────────────────────────────────────────────────────── the SOPs ──

export const STARTER_SOPS: StarterSop[] = [
  // ───────────────────────────── Client acquisition ─────────────────────────────
  {
    key: "mfd_first_call_new_enquiry",
    title: "First call to a new enquiry",
    category: "Client acquisition",
    appliesTo: [P("lead_to_client"), POS("relationship_manager"), TT("follow_up")],
    markdown: sopMd({
      purpose:
        "Turn every new enquiry into a conversation within one working day, and into a clear next step — a meeting, a call-back date or a polite close.",
      when: "As soon as a lead is created (website form, referral, campaign, walk-in or a colleague's entry). Call within 4 working hours; never later than the next working day.",
      who: "Relationship Manager who owns the lead. The Branch Head picks up any lead not called within a day.",
      steps: [
        "Open the lead in the CRM and read its source, notes and any referral before you dial.",
        "Check it is not an existing client: if the person already invests with the firm, start an opportunity on their client record instead of working a new lead.",
        "Call from the lead page (Call / WhatsApp buttons) so the CRM asks \"How did it go?\" and logs the attempt.",
        "Introduce yourself, the firm and its ARN; say how you got their details.",
        "Ask the stage script's questions (the \"Script for this stage\" panel on the lead page): what prompted the enquiry, goals, time horizon, current investments.",
        "Agree one next step: a discovery meeting (in person or video) with date and time, or a call-back date the client chose.",
        "Move the lead journey stage: Call Done, Call Back Later, Call Not Connected or Contact in Future.",
        "Set the follow-up task with a due date — every open lead must have one.",
        "Send the approved welcome / meeting-confirmation template on WhatsApp or email (only templates approved in the CRM).",
      ],
      done: [
        "The call outcome is logged, the stage is moved and a dated follow-up exists.",
        "A not-connected lead has had three attempts on different days and times before it is moved to Contact in Future.",
      ],
      mistakes: [
        "Pitching a scheme on the first call. The first call is for understanding the person, not for products.",
        "Leaving a lead with no follow-up date — it silently goes cold.",
        "Creating a duplicate lead for an existing client instead of an opportunity.",
        "Quoting past returns as if they will repeat.",
      ],
    }),
  },
  {
    key: "mfd_discovery_meeting",
    title: "Discovery and fact-find meeting",
    category: "Client acquisition",
    appliesTo: [P("lead_to_client"), POS("relationship_manager"), TT("follow_up")],
    markdown: sopMd({
      purpose:
        "Understand the client's goals, finances and attitude to risk well enough that anything the firm later recommends is suitable and can be shown to be.",
      when: "The first meeting with a new prospect, and again with an existing client whose circumstances have changed (marriage, child, job change, inheritance, retirement).",
      who: "Relationship Manager. A Branch Head joins for a large or complex family.",
      steps: [
        "Before the meeting: ask the client to bring (or email) their Consolidated Account Statement (CAS) from CAMS / KFintech, recent bank statement of the investing account, PAN and Aadhaar, and any insurance policies.",
        "Confirm the meeting the day before with the approved reminder template.",
        "Open with the agenda: understand goals, look at what they already hold, explain how the firm works and how it is paid (commission from the AMC in regular plans).",
        "Record goals with amount and year (child's education 2034, house down-payment 2029, retirement 2045), in today's money.",
        "Record the facts: income, fixed expenses, EMIs and loans, emergency fund, dependents, existing investments (from the CAS), insurance cover, tax bracket.",
        "Discuss experience: has the client lived through a market fall with equity money? What did they do?",
        "Send the risk profile questionnaire from the lead / client page (Send risk profile) or complete it together; never fill it in for the client.",
        "Agree the next step: proposal discussion date, and the documents still needed.",
        "Log the meeting, its notes and the follow-up task in the CRM; move the journey to Meeting Done.",
      ],
      done: [
        "Goals, facts and the existing portfolio are recorded on the lead / client record.",
        "A risk profile has been sent or completed, and a dated next step exists.",
      ],
      mistakes: [
        "Skipping the existing portfolio — overlap and concentration are only visible from the CAS.",
        "Recording goals with no amount or year, which makes any later suitability check impossible.",
        "Inferring the client's risk appetite from age or income instead of asking.",
        "Talking about schemes before the risk profile is done.",
      ],
    }),
  },
  {
    key: "mfd_risk_profile_suitability",
    title: "Risk profiling and suitability before any proposal",
    category: "Client acquisition",
    appliesTo: [P("lead_to_client"), P("first_investment"), P("periodic_review"), POS("relationship_manager"), POS("compliance_officer")],
    markdown: sopMd({
      purpose:
        "Make sure every scheme put in front of a client matches the client's confirmed risk profile, horizon and goal — and that the firm can prove it.",
      when: "Before the first proposal to any client, before any new scheme for an existing client, and every 12 months (or sooner when circumstances change).",
      who: "Relationship Manager runs it; the Compliance Officer checks a sample every month.",
      steps: [
        "Send the risk profile questionnaire link from the CRM; the client answers it themselves.",
        "Review the result with the client and confirm it: the CRM only accepts a client-confirmed profile signed in the last 12 months for a mutual fund proposal.",
        "Map the profile to an asset-allocation band (equity / debt / hybrid share) and note the horizon for each goal.",
        "For every scheme you consider, compare the scheme's riskometer with the client's profile; a scheme riskier than the profile needs the client's written, informed acknowledgement — or a different scheme.",
        "Check concentration: no single scheme, AMC or sector out of proportion to the portfolio.",
        "Record the suitability rationale in the proposal: why this scheme, for which goal, over what horizon.",
        "If the client insists on a scheme outside their profile, record it as client-initiated with their signed acknowledgement.",
      ],
      done: [
        "A confirmed, dated risk profile is on the client record.",
        "Every proposed scheme carries a written suitability reason, and any mismatch has a signed client acknowledgement.",
      ],
      mistakes: [
        "Using an age-suggested (provisional) profile as if the client had confirmed it.",
        "Re-doing the questionnaire until the answer fits the product.",
        "Forgetting the annual refresh — an expired profile blocks the next proposal.",
      ],
    }),
  },
  {
    key: "mfd_proposal_preparation",
    title: "Preparing and sharing a proposal",
    category: "Client acquisition",
    appliesTo: [P("lead_to_client"), P("first_investment"), POS("relationship_manager"), POS("branch_head")],
    markdown: sopMd({
      purpose:
        "Put a clear, suitable and compliant recommendation in writing, so the client can decide with the facts in front of them.",
      when: "After the discovery meeting and a confirmed risk profile; and for any new investment or rebalancing for an existing client.",
      who: "Relationship Manager prepares it; the Branch Head reviews any proposal above the firm's high-value threshold before it is shared.",
      steps: [
        "Create the proposal in the CRM from the lead or client (Proposals). For an existing client, link it to the open opportunity.",
        "For each goal: the scheme(s), plan (regular), option, amount, SIP or lumpsum, and the suitability reason against the risk profile.",
        "Show the scheme's riskometer, category, expense ratio, exit load and lock-in (ELSS: 3 years).",
        "Disclose how the firm is paid: commission from the AMC, and that a direct plan of the same scheme exists with a lower expense ratio.",
        "Use only illustrative figures labelled as such; never a promised or projected return presented as certain.",
        "Add the standard disclaimer: \"Mutual fund investments are subject to market risks, read all scheme related documents carefully.\" Attach or link the SID / KIM.",
        "Share it from the CRM (so the proposal is marked Sent and the journey moves to Proposal Sent) and agree a date to discuss it.",
        "Record the client's acceptance in the CRM; only then start onboarding or the transaction.",
      ],
      done: [
        "The proposal is marked Sent in the CRM with a follow-up task, and later Accepted or Declined with a reason.",
      ],
      mistakes: [
        "Sharing a proposal over WhatsApp as a screenshot — it leaves no record that it was sent.",
        "Recommending a scheme because of its recent one-year return.",
        "Leaving out the commission disclosure or the direct-plan statement.",
      ],
    }),
  },

  // ───────────────────────────────────── Onboarding ─────────────────────────────────────
  {
    key: "mfd_kyc_new_modify_ckyc",
    title: "KYC — new, modification and CKYC",
    category: "Onboarding",
    appliesTo: [
      P("onboarding"), P("kyc_compliance"), POS("operations_executive"),
      TT("collect_document"), TT("kyc_renewal"), SR("kyc_update"), SR("physical_kyc"), SR("video_kyc"),
      STAGE("documents_pending"),
    ],
    markdown: sopMd({
      purpose: "Get every client to a KRA status of \"KYC Validated\" so they can invest with any AMC without delay.",
      when: "For every new client before the first order; whenever a client's address, name, mobile, email or bank changes; and when the KRA shows a status other than Validated.",
      who: "Operations Executive. The Relationship Manager collects documents from the client.",
      steps: [
        "Check the PAN on a KRA (CVL, NDML, CAMS KRA, KFin KRA or DotEx). Note the status: Validated, Registered, On Hold or Not available.",
        "Check the PAN is linked to Aadhaar — an unlinked PAN puts the KYC on hold.",
        "Validated: record it and move on. Registered: the client can transact in existing folios; do a modification with Aadhaar-based proof to reach Validated before a new AMC.",
        "On Hold: find the reason on the KRA (mobile / email not validated, PAN–Aadhaar not linked, document missing) and fix that specific item.",
        "New KYC: collect PAN, address proof (Aadhaar preferred, masked except the last four digits), photograph, signature and bank proof. Use online e-KYC (Aadhaar OTP / DigiLocker) with in-person verification (IPV) by video, or a physical form with IPV by the ARN holder or an employee with a valid EUIN.",
        "Fetch or upload the CKYC record: if the client has a 14-digit CKYC number (KIN), use it; the KRA uploads new KYC to the CKYC registry (CERSAI).",
        "Track the status on the KRA until it shows Validated (usually 2–5 working days) and record the date in the CRM.",
        "Update the client's KYC fields and attach the documents to the client record.",
      ],
      done: ["The KRA shows KYC Validated, and the CRM records the status, the date checked and the documents."],
      mistakes: [
        "Placing an order for a client whose KYC is On Hold — it will be rejected.",
        "Storing full Aadhaar numbers or sending documents over personal WhatsApp.",
        "Doing IPV without a valid EUIN on record.",
      ],
    }),
  },
  {
    key: "mfd_ucc_creation",
    title: "Creating the client code (UCC / IIN / CAN)",
    category: "Onboarding",
    appliesTo: [P("onboarding"), POS("operations_executive"), SR("iin"), SR("can")],
    markdown: sopMd({
      purpose: "Register the client on the transaction platforms so orders can be placed the day the client decides.",
      when: "Right after KYC is Validated for a new client, or when a client needs a new holding pattern (joint, minor, HUF, NRI).",
      who: "Operations Executive.",
      steps: [
        "Confirm the holding pattern, tax status (resident individual, NRI, minor through guardian, HUF), and the bank account(s) to register.",
        "Collect FATCA / CRS details and the nomination (nominee details with share, or the signed opt-out declaration).",
        "Create the UCC on BSE StAR MF and / or the IIN on NSE NMF II (and the CAN on MF Utility if the firm uses it).",
        "Trigger the client's authentication: the platform sends an email / SMS link or OTP that the client must approve. The code is not usable until they do.",
        "Check the bank account is verified (penny drop) on the platform.",
        "Record the UCC / IIN number and activation date on the client record in the CRM.",
      ],
      done: ["The code is Active on the platform and recorded in the CRM, with the bank verified and nomination captured."],
      mistakes: [
        "Creating a code with a different holding pattern from the existing folios — orders then open new folios.",
        "Not following up the client's authentication link, leaving the code pending for weeks.",
        "Skipping the nomination step; it then has to be done folio by folio later.",
      ],
    }),
  },
  {
    key: "mfd_mandate_registration",
    title: "Bank mandate (e-NACH) registration",
    category: "Onboarding",
    appliesTo: [P("onboarding"), P("sip_rejection"), POS("operations_executive")],
    markdown: sopMd({
      purpose: "Put an auto-debit mandate in place that covers every SIP and planned purchase, so instalments never fail for want of a mandate.",
      when: "During onboarding, before the first SIP; when a SIP increase or top-up would exceed the existing mandate limit; after a mandate is rejected.",
      who: "Operations Executive.",
      steps: [
        "Agree the bank account and a mandate limit that comfortably covers all planned SIPs and step-ups (not just today's SIP).",
        "Register the mandate on the platform the SIPs will run on: e-NACH by net banking or debit card, Aadhaar-based e-Sign, UPI AutoPay for small amounts, or a physical NACH form when online is not possible.",
        "Send the approval link to the client and stay on the call while they authorise it where possible.",
        "Track the status: online mandates usually activate in a few working days; a physical NACH can take 2–3 weeks.",
        "If rejected, read the reason (signature mismatch, account details, limit) and redo it the same day.",
        "Link the active mandate to any pending SIP; record the mandate ID, bank, limit and status in the CRM.",
      ],
      done: ["The mandate shows Approved / Active on the platform and in the CRM, and its limit covers every SIP it backs."],
      mistakes: [
        "Registering a SIP whose first instalment falls before the mandate is active.",
        "Setting the limit equal to today's SIP, so the first step-up fails.",
        "Registering the mandate on one platform and the SIP on the other.",
      ],
    }),
  },
  {
    key: "mfd_first_investment_welcome",
    title: "First investment confirmation and welcome",
    category: "Onboarding",
    appliesTo: [P("first_investment"), POS("relationship_manager"), POS("operations_executive")],
    markdown: sopMd({
      purpose: "Close onboarding properly: the first investment is confirmed by the RTA, the client knows what they hold and what happens next.",
      when: "When the first lumpsum is allotted or the first SIP instalment is processed.",
      who: "Operations Executive confirms; the Relationship Manager makes the welcome call.",
      steps: [
        "Confirm allotment from the RTA (CAMS / KFintech) feed or the AMC's confirmation, not only from the platform order status.",
        "Check the Business Entry for the order shows the RTA outcome Confirmed.",
        "Send the welcome message with what they hold, the folio number(s), how to reach the firm and the service promise of their tier.",
        "RM welcome call within 3 working days: confirm the client received the AMC's statement, explain how to read it, agree the first review date.",
        "Map the client to their family in the CRM and set the review frequency.",
        "Close the onboarding tasks and the lead journey (Active Client).",
      ],
      done: ["RTA-confirmed first investment, welcome sent, review date set, family mapped."],
      mistakes: [
        "Treating a placed order as done before the RTA confirms it.",
        "Forgetting to set the first review — the client's next contact is then a market fall.",
      ],
    }),
  },

  // ───────────────────────────────────── Transactions ─────────────────────────────────────
  {
    key: "mfd_lumpsum_purchase",
    title: "Lumpsum purchase",
    category: "Transactions",
    appliesTo: [P("first_investment"), POS("operations_executive"), STAGE("make_transaction")],
    markdown: sopMd({
      purpose: "Execute a client's one-time purchase on the day they ask, at the right NAV, with suitability on record.",
      when: "When an accepted proposal or the client's written instruction asks for a fresh or additional purchase.",
      who: "Operations Executive executes; the Relationship Manager confirms the instruction and suitability.",
      steps: [
        "Confirm the instruction in writing (email / WhatsApp from the registered number): scheme, plan, option, amount, folio (new or existing).",
        "Check KYC is Validated, the UCC / IIN is active and the scheme suits the client's confirmed risk profile.",
        CUTOFF,
        "Place the order on BSE StAR MF / NSE NMF II; send the payment link (net banking / UPI) or debit the mandate. Third-party payments are not allowed — the money must come from the client's own registered account.",
        "Confirm the payment succeeded on the platform the same day.",
        "Book the Business Entry in the CRM the same day (Targets count booked business).",
        "When the RTA feed arrives, check the units and NAV; the Business Entry's RTA outcome moves to Confirmed.",
        "Share the confirmation with the client and file the order and payment proof on the client record.",
      ],
      done: ["Payment realised, units allotted per the RTA, Business Entry Confirmed, client informed."],
      mistakes: [
        "Collecting the payment after the cut-off and telling the client they got today's NAV.",
        "Accepting money from a spouse's or company account (third-party payment).",
        "Booking business without the client's written instruction.",
      ],
    }),
  },
  {
    key: "mfd_sip_registration",
    title: "SIP registration",
    category: "Transactions",
    appliesTo: [P("first_investment"), POS("operations_executive")],
    markdown: sopMd({
      purpose: "Start a SIP that debits correctly from the first instalment.",
      when: "When the client accepts a SIP in a proposal or asks for a new SIP or a step-up.",
      who: "Operations Executive; the Relationship Manager confirms the instruction.",
      steps: [
        "Confirm scheme, plan, amount, frequency, SIP date, tenure (or perpetual) and any step-up, in writing.",
        "Check suitability against the risk profile, KYC Validated and the UCC / IIN active.",
        "Check an active mandate covers the amount (plus all other SIPs on it). If not, register or raise the mandate first.",
        "Pick a first instalment date at least 7–10 days after mandate activation, and a SIP date a few days after the client's salary credit.",
        "Register the SIP on the platform; send the client any authentication link and follow it up.",
        "Book the Business Entry; record the SIP in the CRM with the first-debit date.",
        "After the first debit date, confirm the first instalment from the RTA feed; a rejected first debit goes straight to the SIP rejection SOP.",
      ],
      done: ["The first instalment is processed per the RTA and the SIP shows active in the CRM."],
      mistakes: [
        "A SIP date two days before salary credit — the classic cause of bounces.",
        "Registering a SIP before the mandate is active.",
        "Not telling the client the date and amount that will be debited.",
      ],
    }),
  },
  {
    key: "mfd_sip_rejection_recovery",
    title: "SIP rejection recovery",
    category: "Transactions",
    appliesTo: [P("sip_rejection"), POS("operations_executive"), POS("relationship_manager"), TT("follow_up")],
    markdown: sopMd({
      purpose: "Recover every bounced or rejected SIP instalment and stop it from happening again, without embarrassing the client.",
      when: "The day a SIP rejection appears in the RTA feed or the CRM's SIP rejection register.",
      who: "Operations Executive diagnoses and fixes; the Relationship Manager speaks to the client.",
      steps: [
        "Read the rejection reason: insufficient balance, mandate not registered / expired / limit exceeded, account closed or frozen, KYC on hold, or a technical failure.",
        "Call the client within 2 working days (not a cold message). Be factual and helpful; never blame.",
        "Insufficient funds: ask whether it was a one-off or whether the SIP date or amount should change. Offer an additional purchase to make up the missed instalment if the client wants.",
        "Mandate problem: register a new mandate or raise the limit (mandate SOP), then confirm the next instalment will debit.",
        "Account closed / changed: start the bank mandate change SOP.",
        "Note that three consecutive failures can lead the AMC to cancel the SIP — tell the client before that point.",
        "Record the reason, the client's decision and the fix on the SIP rejection in the CRM; close it as recovered, rescheduled or stopped at the client's request.",
      ],
      done: ["The rejection is closed with a reason and an outcome, and the next instalment's debit is confirmed or the SIP is formally stopped."],
      mistakes: [
        "Only sending an automated message and never calling.",
        "Fixing the symptom (a top-up) and not the cause (the SIP date or mandate).",
        "Letting the SIP lapse after three failures without the client's decision on record.",
      ],
    }),
  },
  {
    key: "mfd_redemption_retention",
    title: "Redemption request with a retention conversation",
    category: "Transactions",
    appliesTo: [
      P("redemption_retention"), P("service_requests"), POS("relationship_manager"), POS("operations_executive"),
      SR("redemption_request"), SR("redemption_help"),
    ],
    markdown: sopMd({
      purpose: "Process a client's redemption promptly and correctly, after making sure they have considered the consequences — the decision stays the client's.",
      when: "Every redemption request; every large redemption seen in the RTA feed that the firm did not process.",
      who: "Relationship Manager has the conversation; Operations Executive executes.",
      steps: [
        "Acknowledge the request the same day and open a service request.",
        "RM call within 1 working day (before executing, where the client allows): understand the need — an expense, a goal reached, worry about markets, dissatisfaction.",
        "Lay out the facts: exit load, the holding period and capital-gains tax impact (from the CRM's capital-gains view), ELSS lock-in, effect on the goal it was meant for.",
        "Where it fits the need, mention alternatives factually: partial redemption, redeeming from the scheme with the lowest tax impact, an SWP, or a loan against units. Do not pressure; if the client wants to redeem, redeem.",
        "Get the instruction in writing: scheme, units or amount, full or partial, bank account for credit (must be a registered account).",
        "Place it before the 3:00 PM redemption cut-off (the same for every scheme, liquid included) to get that day's NAV; platforms close order entry a little earlier.",
        "Place the order on the platform (or submit to the RTA) and note the expected credit: usually T+1 for liquid and debt schemes, T+2 for equity schemes.",
        "Confirm the credit with the client, update the CRM and record the reason for redemption and the outcome of the conversation.",
      ],
      done: ["The redemption is credited, the client confirmed it, and the reason and conversation are on the client record."],
      mistakes: [
        "Delaying a redemption to \"retain\" the money — it is the client's money and decision.",
        "Not checking ELSS lock-in or exit load before placing the order.",
        "Sending proceeds to an unregistered bank account.",
      ],
    }),
  },
  {
    key: "mfd_switch_stp_swp",
    title: "Switch, STP and SWP",
    category: "Transactions",
    appliesTo: [
      P("service_requests"), POS("operations_executive"), POS("relationship_manager"),
      SR("switch_request"), SR("switch_help"), SR("swp"), SR("swp_stop"),
    ],
    markdown: sopMd({
      purpose: "Move money between schemes or set up regular transfers and withdrawals correctly, with the tax and load consequences understood.",
      when: "A client asks to switch, to stagger a lumpsum into equity (STP), to draw a regular income (SWP), or to stop one.",
      who: "Relationship Manager confirms suitability; Operations Executive executes.",
      steps: [
        "Confirm the instruction in writing: source and target scheme (same AMC for a switch / STP), amount or units, frequency, start date and end date.",
        "Check the target scheme suits the client's risk profile and goal.",
        "Explain that a switch, every STP transfer and every SWP payout is a redemption for tax: capital gains and exit load may apply.",
        "SWP: agree an amount the corpus can sustain; show an illustration labelled as illustrative, never as a promise.",
        "Check the source folio has enough balance for the switch or for the STP's tenure.",
        "Register it on the platform or with the RTA before the cut-off; note the first transfer / payout date.",
        "Record it in the CRM and set a reminder at the first transfer / payout to confirm it happened, and a review reminder before the STP / SWP ends.",
      ],
      done: ["The first transfer / payout is confirmed from the RTA feed and the plan is recorded in the CRM."],
      mistakes: [
        "Not mentioning that switching out of a scheme within the exit-load period costs the client money.",
        "Setting an SWP that will exhaust the corpus long before the client expects.",
        "Forgetting to stop an STP / SWP the client asked to end.",
      ],
    }),
  },

  // ───────────────────────────────────── Service ─────────────────────────────────────
  {
    key: "mfd_service_request_handling",
    title: "Handling any service request",
    category: "Service",
    appliesTo: [P("service_requests"), POS("service_desk"), SR("other"), SR("transaction_query"), SR("feedback")],
    extraRoles: ["service_team"],
    markdown: sopMd({
      purpose: "Every client request is logged, owned, acknowledged and resolved within its SLA — whoever happens to receive it.",
      when: "Any client request by phone, WhatsApp, email, the portal or in person.",
      who: "Service Desk owns it end to end; whoever receives the request logs it.",
      steps: [
        "Log a service request in the CRM the moment it is received, with the right type, the client, the channel and the client's words.",
        "Acknowledge to the client the same working day with the ticket number and the expected date.",
        "Verify identity before any change: requests must come from the registered email or mobile, or be signed.",
        "Follow the SOP for the request type (nominee, bank, transmission, statement …). If there is none, record the steps you took so one can be written.",
        "Update the ticket at every step; set it to Waiting on client when you are waiting on them.",
        "Confirm the outcome to the client in writing, then resolve the ticket; ask for feedback.",
      ],
      done: ["The ticket is resolved within its SLA, the client was told the outcome in writing, and the trail is on the ticket."],
      mistakes: [
        "Handling a request on WhatsApp and never logging it — it then has no SLA and no owner.",
        "Acting on an instruction from an unregistered number or email.",
        "Closing the ticket before the RTA has actually processed the change.",
      ],
    }),
  },
  {
    key: "mfd_nominee_update",
    title: "Nominee registration and update",
    category: "Service",
    appliesTo: [P("service_requests"), P("kyc_compliance"), POS("service_desk"), SR("nominee_update")],
    markdown: sopMd({
      purpose: "Every folio has a nomination (or a recorded opt-out), so the family is spared a long transmission process.",
      when: "At onboarding, when the CRM flags a folio without a nominee, and when a client's family situation changes (marriage, birth, death of a nominee).",
      who: "Service Desk.",
      steps: [
        "List the client's folios from the CRM / CAS and which have nominees.",
        "Collect each nominee's name, relationship, date of birth, share (adding up to 100%), and identity / contact details as the RTA form asks; a guardian for a minor nominee.",
        "If the client chooses not to nominate, get the signed opt-out declaration.",
        "Submit online through the RTA / AMC (client authenticates by OTP) or with a signed form to CAMS / KFintech, covering every folio.",
        "Confirm from the RTA that the nomination is registered on each folio; update the CRM nominee fields.",
        "Tell the client in writing which folios are covered.",
      ],
      done: ["Every folio shows a registered nomination or opt-out at the RTA and in the CRM."],
      mistakes: [
        "Updating one AMC and forgetting the client's other folios.",
        "Shares that do not add up to 100%, which gets the request rejected.",
      ],
    }),
  },
  {
    key: "mfd_bank_mandate_change",
    title: "Bank account and mandate change",
    category: "Service",
    appliesTo: [P("service_requests"), POS("service_desk"), POS("operations_executive"), SR("bank_update")],
    markdown: sopMd({
      purpose: "Change the client's registered bank account safely, without breaking their SIPs.",
      when: "A client changes or closes the bank account their folios and SIPs use.",
      who: "Service Desk for the folio change; Operations Executive for the mandate.",
      steps: [
        "Verify the request comes from the client (registered email / mobile, or signed form). Bank changes are a common fraud route — never act on a phone call alone.",
        "Collect proof of the new account: cancelled cheque with the client's name printed, or a bank statement / letter; proof of the old account if the RTA asks.",
        "Submit the change of bank mandate to CAMS / KFintech for every folio (the RTAs observe a cooling period on payouts after a bank change).",
        "Register a new e-NACH mandate on the new account before the next SIP date; move each SIP to it.",
        "Cancel the old mandate only after the new one is active and the SIPs are moved.",
        "Update the UCC / IIN bank details and the CRM; confirm to the client.",
      ],
      done: ["All folios show the new bank at the RTA, every SIP debits from the new mandate, the old mandate is cancelled."],
      mistakes: [
        "Closing the old mandate first, so the next SIP bounces.",
        "Accepting a bank change by WhatsApp from an unknown number.",
      ],
    }),
  },
  {
    key: "mfd_client_details_change",
    title: "Contact, name and status changes",
    category: "Service",
    appliesTo: [
      P("service_requests"), POS("service_desk"),
      SR("mobile_update"), SR("email_update"), SR("name_change"), SR("minor_to_major"), SR("folio_correction"),
    ],
    markdown: sopMd({
      purpose: "Keep the client's details right at the KRA, the RTA and in the CRM, so statements and OTPs reach them.",
      when: "A client changes mobile, email or name, a minor turns 18, or a folio has wrong details.",
      who: "Service Desk.",
      steps: [
        "Verify the request (registered email / mobile, or signed form with ID).",
        "Mobile / email: update at the KRA first (KYC modification), then the RTA folios; the new number / email must belong to the client or their immediate family as declared.",
        "Name change: collect the gazette / marriage certificate and updated PAN; modify KYC, then the folios.",
        "Minor to major: on turning 18 the AMC stops SIPs in the minor's folio; collect the now-major's KYC, bank and signature, submit the change of status form, and register fresh SIPs and mandate in their name.",
        "Folio correction: submit the correction with proof to the RTA.",
        "Update the CRM and confirm to the client.",
      ],
      done: ["The KRA, every folio and the CRM agree, and the client has confirmed receipt of a test communication or statement."],
      mistakes: [
        "Updating the CRM only — statements and OTPs still go to the old details.",
        "Missing a minor's 18th birthday, so their SIPs stop without warning.",
      ],
    }),
  },
  {
    key: "mfd_transmission_case",
    title: "Transmission after a client's death",
    category: "Service",
    appliesTo: [P("service_requests"), POS("service_desk"), POS("branch_head"), SR("transmission_case")],
    markdown: sopMd({
      purpose: "Help a bereaved family claim the units with as little difficulty as possible, correctly and with compassion.",
      when: "The firm learns of a client's death.",
      who: "Service Desk runs the case; the Branch Head or the RM makes the first contact with the family.",
      steps: [
        "First contact by the RM or Branch Head: condolences first; no paperwork on that call beyond explaining that the firm will help.",
        "Stop any outflows that would cause confusion (SIPs on the deceased's mandate) once the family asks.",
        "List all folios and holdings, and the registered nominee or joint holder on each.",
        "Explain the path: a surviving joint holder or a registered nominee needs the transmission form, the death certificate (attested copy), the claimant's KYC and bank proof. Without a nominee, the legal heirs also need documents such as a legal heir certificate, succession certificate or probate, with indemnity and NOC from other heirs — the RTA's thresholds decide which.",
        "Check every document before submission; submit to CAMS / KFintech folio by folio, or through the RTAs' combined transmission facility.",
        "Track each folio to completion and keep the family informed weekly.",
        "Once complete, mark the deceased client's record closed and, with the family's consent, onboard the claimant as a client.",
      ],
      done: ["Units transmitted on every folio, the family informed, the deceased's record closed."],
      mistakes: [
        "Pressing the family for documents in the first conversation.",
        "Submitting incomplete packs, which restarts the RTA's clock each time.",
      ],
    }),
  },
  {
    key: "mfd_statement_capital_gains",
    title: "Statement and capital-gains requests",
    category: "Service",
    appliesTo: [P("service_requests"), POS("service_desk"), SR("statement_request"), SR("capital_gain_report")],
    markdown: sopMd({
      purpose: "Get clients accurate statements and capital-gains reports quickly — especially before the tax-filing deadline.",
      when: "A client asks for a statement or a capital-gains report; and proactively every April–July for the previous financial year.",
      who: "Service Desk.",
      steps: [
        "Confirm the period (financial year) and the type: account statement, Consolidated Account Statement (CAS), or realised / unrealised capital gains.",
        "Generate it from the CRM, or request it from CAMS / KFintech (the RTA mailback services send it to the registered email).",
        "Check it covers all the client's folios across both RTAs.",
        "Send it only to the registered email (password-protected where the RTA does so) — never to a third party without the client's written consent.",
        "Remind the client that the report shows gains; their tax professional decides the tax treatment.",
        "Log the request and the date sent.",
      ],
      done: ["The client has the statement on their registered email and the request is logged and resolved."],
      mistakes: [
        "Sending only one RTA's report, which understates the gains.",
        "Emailing a CA or relative directly without the client's written consent.",
      ],
    }),
  },
  {
    key: "mfd_birthday_milestones",
    title: "Birthday and milestone touchpoints",
    category: "Service",
    appliesTo: [P("client_delight"), POS("relationship_manager"), POS("marketing_executive")],
    markdown: sopMd({
      purpose: "Make clients feel known: no birthday, anniversary or milestone passes unremarked.",
      when: "Client birthdays, wedding anniversaries, the anniversary of becoming a client, a goal reached, a SIP that completes a year or a portfolio milestone.",
      who: "Relationship Manager; the Marketing Executive keeps the templates and automations up to date.",
      steps: [
        "Keep date of birth and anniversary filled on every client record — a blank field means a missed touchpoint.",
        "Make sure the birthday and anniversary automations are enabled with approved templates.",
        "Each morning, check today's touchpoints in the briefing; a personal call or voice note for top-tier clients, the automated wish for others.",
        "For a milestone (goal reached, SIP anniversary), call and congratulate; offer a review if one is due. Do not use the call to sell.",
        "Log the call in the CRM (the one-tap \"How did it go?\").",
      ],
      done: ["Every client had their touchpoint on the day, and calls are logged."],
      mistakes: [
        "Mentioning returns or schemes in a birthday message.",
        "Wishing a client whose family member has recently died — read the notes first.",
      ],
    }),
  },

  // ───────────────────────────────────── Reviews ─────────────────────────────────────
  {
    key: "mfd_periodic_review",
    title: "Quarterly / half-yearly review meeting",
    category: "Reviews",
    appliesTo: [P("periodic_review"), POS("relationship_manager"), TT("review_meeting")],
    markdown: sopMd({
      purpose: "Keep every client's portfolio aligned with their goals and risk profile, on the cadence their service tier promises.",
      when: "Tier A every quarter, Tier B every six months, Tier C every year (the firm's service promise); also after a large market move or a life event.",
      who: "Relationship Manager.",
      steps: [
        "A week before: schedule the meeting in the CRM (Meetings) and send the confirmation.",
        "Prepare: current value, invested amount and XIRR, asset allocation versus the profile's band, progress per goal, SIPs active / stopped / rejected, KYC, nominee and risk-profile validity.",
        "In the meeting: ask what has changed in the client's life first. Then goals, then the portfolio.",
        "Discuss any scheme that no longer fits the profile or goal; any change goes through the proposal and suitability SOPs.",
        "Fix the hygiene gaps on the spot: nominee, KYC, mandate, risk profile older than 12 months.",
        "Record notes and action items in the meeting; every action item becomes a task with an owner and a date.",
        "Send a short written summary and set the next review date.",
      ],
      done: ["The review is marked complete, its action items are tasks, and the next review is scheduled."],
      mistakes: [
        "A review that is only a performance report.",
        "Recommending changes without re-checking the risk profile.",
        "Not setting the next review date before the client leaves.",
      ],
    }),
  },

  // ───────────────────────────────────── Compliance ─────────────────────────────────────
  {
    key: "mfd_complaint_handling",
    title: "Complaint handling within 21 days",
    category: "Compliance",
    appliesTo: [P("complaints"), POS("compliance_officer"), POS("owner_director"), SR("complaint")],
    markdown: sopMd({
      purpose: "Every complaint is acknowledged at once, investigated fairly and resolved within 21 calendar days, and the client knows how to escalate.",
      when: "Any expression of dissatisfaction that the client wants addressed — by any channel, including the website complaint form.",
      who: "Compliance Officer owns every complaint (never the RM it is about); the Owner is informed of each one.",
      steps: [
        "Log it as a complaint service request the same day, in the client's own words.",
        "Acknowledge in writing within 1 working day with the ticket number and the 21-day resolution timeline.",
        "Investigate: the CRM trail, communications, order and RTA records; speak to the staff involved. If the issue sits with an AMC or RTA, raise it with them and track it.",
        "Decide and respond in writing with the facts, the outcome and any remedy, within 21 calendar days.",
        "In every final reply, give the escalation path: the AMC's investor-service officer, SEBI's SCORES portal (scores.sebi.gov.in) and, after that, the Online Dispute Resolution (SMART ODR) portal.",
        "Record the root cause and the fix to the process (update the SOP if needed); close the ticket only when the client has the reply.",
        "Review all complaints monthly with the Owner.",
      ],
      done: ["Reply sent within 21 days with the escalation path, root cause recorded, ticket closed."],
      mistakes: [
        "Letting the RM the complaint is about handle it.",
        "Treating a complaint as a service request and missing the 21-day clock.",
        "Leaving the escalation path out of the reply.",
      ],
    }),
  },
  {
    key: "mfd_kyc_expiry_rekyc",
    title: "KYC on hold, expiry and re-KYC",
    category: "Compliance",
    appliesTo: [P("kyc_compliance"), POS("compliance_officer"), POS("operations_executive"), TT("kyc_renewal")],
    markdown: sopMd({
      purpose: "No client is blocked from transacting because a KYC lapsed or went on hold unnoticed.",
      when: "Monthly KRA status check of the whole book; whenever a transaction is rejected for KYC; when the CRM flags a KYC due for renewal.",
      who: "Compliance Officer runs the check; Operations Executive fixes each case.",
      steps: [
        "Once a month, check KRA status for every live client (bulk check where the KRA allows) and record it.",
        "List clients whose status is On Hold, Registered (not Validated) or due for periodic update.",
        "For each, find the exact reason and the fix (PAN–Aadhaar link, mobile / email validation, fresh address proof, re-KYC).",
        "The RM contacts the client with a clear, short explanation and the link or documents needed.",
        "Operations submits the modification and tracks it to Validated (KYC SOP).",
        "Record the new status and date; close the KYC renewal task.",
      ],
      done: ["Every live client's KRA status is Validated, or has an open task with a date."],
      mistakes: [
        "Discovering a KYC problem only when a SIP or redemption is rejected.",
        "Asking the client for every document again instead of the one item missing.",
      ],
    }),
  },
  {
    key: "mfd_arn_nism_euin_renewal",
    title: "ARN, NISM and EUIN renewal",
    category: "Compliance",
    appliesTo: [P("kyc_compliance"), POS("compliance_officer"), POS("owner_director")],
    markdown: sopMd({
      purpose: "The firm never loses the right to earn commission or to sell because a registration lapsed.",
      when: "Track every expiry date; start renewals at least 3 months before expiry.",
      who: "Compliance Officer; the Owner signs the ARN renewal.",
      steps: [
        "Keep a register (Compliance in the CRM) of the firm's ARN, each person's NISM Series V-A certificate and EUIN, with expiry dates.",
        "NISM V-A is valid for 3 years: renew by the Continuing Professional Education (CPE) programme or by passing the exam again, before expiry.",
        "EUIN: every employee who interacts with clients or sells needs one, linked to the firm's ARN and a valid NISM certificate; renew it with AMFI when the certificate is renewed.",
        "ARN is valid for 3 years: apply for renewal with AMFI (through CAMS) with the renewed NISM certificate, well before expiry.",
        "Complete the Know Your Distributor (KYD) update whenever the firm's details change.",
        "Upload the renewed certificates to the CRM; update the expiry dates.",
        "No one without a valid EUIN may recommend schemes to clients or do IPV — check before assigning work to a new joiner.",
      ],
      done: ["Every licence in the register is valid for at least the next 90 days, or a renewal is in progress with a date."],
      mistakes: [
        "Waiting for the expiry email; AMCs stop paying commission on a lapsed ARN.",
        "Letting a new hire handle clients before their EUIN is active.",
      ],
    }),
  },
  {
    key: "mfd_data_privacy_records",
    title: "Client data privacy and record keeping",
    category: "Compliance",
    appliesTo: [P("kyc_compliance"), POS("compliance_officer"), POS("owner_director")],
    markdown: sopMd({
      purpose: "Protect clients' personal data and keep the records a regulator or auditor will ask for.",
      when: "Always. Reviewed every quarter by the Compliance Officer.",
      who: "Everyone in the firm; the Compliance Officer owns the policy.",
      steps: [
        "Collect only what the work needs, with the client's consent for its purpose (Digital Personal Data Protection Act, 2023).",
        "Store client documents only on the client record in the CRM — not in personal phones, email drafts or WhatsApp groups.",
        "Mask Aadhaar (only the last four digits visible) in anything stored or shared.",
        "Share client data only with the AMC, RTA, KRA or platform that needs it for the client's transaction, or with the client's written consent.",
        "Give each person only the CRM access their role needs; remove access the day someone leaves.",
        "Keep KYC and transaction records for at least the period the law requires (PMLA: five years after the relationship ends; the firm may keep longer).",
        "Report a suspected data leak to the Owner and Compliance Officer the same day.",
        "Every quarter, review user access and a sample of records for completeness.",
      ],
      done: ["Records are complete and stored in the CRM, access is current, and no client data lives outside approved systems."],
      mistakes: [
        "Forwarding PAN / Aadhaar copies in WhatsApp groups.",
        "Leaving a departed employee's login active.",
      ],
    }),
  },
  {
    key: "mfd_client_communications",
    title: "Client communications and marketing",
    category: "Compliance",
    appliesTo: [P("client_delight"), POS("marketing_executive"), POS("compliance_officer")],
    markdown: sopMd({
      purpose: "Everything the firm sends clients is approved, consented and compliant with SEBI and AMFI rules on communication.",
      when: "Before any campaign, template, social post or bulk message.",
      who: "Marketing Executive drafts; the Compliance Officer approves.",
      steps: [
        "Draft in the CRM's Templates; use the merge fields, not hand-typed client data.",
        "Never promise or imply a return; use performance only as the AMC presents it, with the period, the benchmark and the line \"Past performance may or may not be sustained in future\".",
        "Include \"Mutual fund investments are subject to market risks, read all scheme related documents carefully.\" wherever schemes are mentioned, and the firm's ARN.",
        "Describe what the firm does as mutual fund distribution and service — never present it as a SEBI-registered RIA.",
        "Get Compliance approval in the CRM before use; WhatsApp templates also need Meta approval.",
        "Send only through the CRM, so consent and opt-outs are respected and every send is recorded.",
      ],
      done: ["The template is approved and every send goes through the CRM with consent checked."],
      mistakes: [
        "Forwarding an AMC's poster with a performance table cut out of context.",
        "Sending marketing to a client who has opted out.",
      ],
    }),
  },

  // ───────────────────────────────────── Operations ─────────────────────────────────────
  {
    key: "mfd_weekly_rta_reconciliation",
    title: "Weekly RTA import and reconciliation",
    category: "Operations",
    appliesTo: [P("rta_reconciliation"), POS("operations_executive")],
    markdown: sopMd({
      purpose: "The CRM's holdings and transactions match the RTAs', so every figure, review and dashboard is true.",
      when: "Every Monday (and the day after any large transaction day); month-end without fail.",
      who: "Operations Executive.",
      steps: [
        "Download the week's transaction feeds from CAMS (mailback / MFDEx) and KFintech for the firm's ARN.",
        "Import them in the CRM (Import RTA files) and read the import summary for errors.",
        "Check Business Entries: every booked line should be Confirmed. Work through Mismatch, Rejected and Not found lines — find the reason and correct the entry or chase the order.",
        "Review new SIP rejections and redemptions in the feed; they start the SIP rejection and redemption SOPs.",
        "Map any new folios or unmapped clients to the right client and family.",
        "Spot-check five clients' holdings against their CAS.",
        "Note the import date — dashboards say \"no data\" when the ledger is stale.",
      ],
      done: ["This week's feeds from both RTAs are imported, and no Business Entry line older than the firm's wait sits in Pending without a reason."],
      mistakes: [
        "Importing only one RTA.",
        "Ignoring Not found lines — they are often orders that never reached the AMC.",
      ],
    }),
  },
  {
    key: "mfd_monthly_brokerage_reconciliation",
    title: "Monthly brokerage reconciliation",
    category: "Operations",
    appliesTo: [P("rta_reconciliation"), POS("operations_executive"), POS("owner_director")],
    markdown: sopMd({
      purpose: "Make sure the firm is paid every rupee of commission it has earned, and nothing it has not.",
      when: "Each month, once the AMCs' brokerage statements for the previous month are available.",
      who: "Operations Executive; the Owner reviews the summary.",
      steps: [
        "Download the brokerage statements from CAMS and KFintech (and AMCs that report separately) for the ARN.",
        "Import them into the CRM's brokerage view.",
        "Compare with the AUM per AMC: a large AMC with little or no trail points to folios missing the firm's ARN (or moved to direct), or a lapsed ARN / EUIN.",
        "List folios where the ARN has changed and follow up with the client where appropriate.",
        "Raise GST invoices to AMCs where the firm is GST-registered, and record TDS deducted.",
        "Record the month's brokerage and any shortfall to chase; follow up with the AMC for differences.",
      ],
      done: ["The month's brokerage is reconciled per AMC, invoices raised, and differences are open tasks with owners."],
      mistakes: [
        "Only checking the total — the leak is usually one AMC or a group of folios.",
        "Missing GST invoices, which delays payment.",
      ],
    }),
  },

  // ───────────────────────────────────── Insurance ─────────────────────────────────────
  {
    key: "mfd_insurance_renewal",
    title: "Insurance premium renewal",
    category: "Insurance",
    appliesTo: [P("insurance_renewal"), POS("relationship_manager")],
    extraRoles: ["insurance_team"],
    markdown: sopMd({
      purpose: "No client's cover lapses for want of a reminder.",
      when: "From 30 days before every premium due date until it is paid or the client has decided not to renew.",
      who: "Relationship Manager; the insurance team where the firm has one.",
      steps: [
        "Each week, review renewals due in the next 30 days in the CRM.",
        "30 days before: send the approved renewal reminder with the amount and due date.",
        "15 days before: call the client; confirm the cover still fits (sum insured, members, vehicle IDV) and any change they want.",
        "Help them pay the insurer directly (the insurer's link or portal) — the firm never collects premium in its own account.",
        "7 days before / on the due date: a final call if unpaid. Explain the grace period of their policy type and what is not covered during it (health cover gaps, motor has none).",
        "When paid, record the payment and Mark renewed in the CRM; file the renewal receipt.",
        "If the client decides not to renew, record the reason.",
      ],
      done: ["The policy is renewed and marked renewed in the CRM, or the client's decision not to renew is recorded."],
      mistakes: [
        "Relying on the insurer's reminder alone.",
        "Renewing a health policy without checking the members and sum insured still fit.",
      ],
    }),
  },

  // ───────────────────────────────────── Team ─────────────────────────────────────
  {
    key: "mfd_team_induction",
    title: "New team member induction",
    category: "Team",
    appliesTo: [POS("owner_director"), POS("branch_head")],
    markdown: sopMd({
      purpose: "A new person can do their position's work the firm's way within 30 days, without the owner standing over them.",
      when: "From the day before a new joiner starts until the end of their first month.",
      who: "Owner / Director or the Branch Head the person reports to.",
      steps: [
        "Before day 1: create their CRM login with the right role, branch and reporting manager; add them as the holder of their position.",
        "Day 1: the firm's primary aim, the service promise and their position contract — the results they answer for.",
        "Week 1: read and sign the SOPs of their position in the Operations Manual (each SOP's \"Acknowledge\"); shadow a colleague on each core process.",
        "Check their NISM V-A and EUIN: no client-facing work or IPV until both are valid.",
        "Week 2–3: do the work with a reviewer checking each item (calls, orders, service requests).",
        "Week 4: review against the position's results; agree what they own from now on.",
        "Note anything the SOPs did not cover and update the SOP — the manual improves with every hire.",
      ],
      done: ["The person holds their position, has acknowledged its SOPs, and handles its work unsupervised."],
      mistakes: [
        "Teaching by \"sit with me\" only — the knowledge leaves when the trainer does.",
        "Giving a new joiner owner-level access \"for now\".",
      ],
    }),
  },
];

// ───────────────────────────────────────────────── lead stage scripts ──

export const STARTER_SCRIPTS: StarterSop[] = [
  {
    key: "mfd_script_lead_new",
    title: "Call script — new enquiry",
    category: "Scripts",
    appliesTo: [STAGE("new"), POS("relationship_manager")],
    markdown: scriptMd({
      goal: "Goal: a short, warm first conversation that ends with a meeting booked or a call-back date the client chose.",
      opener:
        "\"Hello, am I speaking with {name}? This is {your name} from {firm}, a mutual fund distributor registered with AMFI. You enquired about investing through {source} — is this a good time for five minutes?\"",
      questions: [
        "What made you look into investing right now?",
        "What are you saving towards, and roughly when will you need the money?",
        "Do you already invest in mutual funds or anything else? Directly or through someone?",
        "How do you prefer to meet — at our office, at your place or on a video call?",
      ],
      objections: [
        ["Just send me the best fund.", "There isn't one best fund for everyone — what suits you depends on your goals and comfort with risk. A 30-minute conversation lets us recommend something that actually fits you."],
        ["I already have an agent / I invest directly.", "That's fine. Many clients ask us for a second look at their portfolio with no obligation. Would a review of what you hold be useful?"],
        ["What returns will I get?", "Nobody can promise a return in mutual funds; they are subject to market risk. What we can do is match schemes to your goal and time frame and review them with you regularly."],
      ],
      next: "Book the discovery meeting (date, time, place) and ask them to bring or email their CAS, PAN and Aadhaar. If they are busy, agree a specific call-back time.",
      log: [
        "Call outcome (\"How did it go?\") and the journey stage: Call Done, Call Back Later, Call Not Connected or Contact in Future.",
        "Goal and horizon in a line in the lead notes.",
        "The follow-up task with its date.",
      ],
    }),
  },
  {
    key: "mfd_script_lead_call_done",
    title: "Call script — after the first call",
    category: "Scripts",
    appliesTo: [STAGE("call_done"), POS("relationship_manager")],
    markdown: scriptMd({
      goal: "Goal: turn a good first call into a confirmed discovery meeting.",
      opener: "\"Hi {name}, {your name} from {firm} again — thank you for your time on {day}. I'm calling to fix the meeting we spoke about.\"",
      questions: [
        "Which day and time this week or next suits you?",
        "Should anyone else join — your spouse, a parent — since the plan affects them too?",
        "Could you bring or email your Consolidated Account Statement? I'll send you how to get it from CAMS / KFintech.",
        "Is there anything specific you'd like us to look at?",
      ],
      objections: [
        ["Can't we do this on the phone?", "We can start on the phone, but a proper look at your goals and current holdings takes about 45 minutes; a video call works if travel is hard."],
        ["I'm not ready to invest yet.", "That's fine — the meeting is to understand your situation; there's no decision to make in it."],
      ],
      next: "Meeting booked with a calendar invite and the approved confirmation message; or a call-back date if they need to check with family.",
      log: ["Meeting scheduled in the CRM (moves the journey to Meeting Scheduled).", "Who will attend and documents promised."],
    }),
  },
  {
    key: "mfd_script_lead_call_back_later",
    title: "Call script — call back later",
    category: "Scripts",
    appliesTo: [STAGE("call_back_later"), POS("relationship_manager")],
    markdown: scriptMd({
      goal: "Goal: honour the time the client asked for and move to a meeting without pressure.",
      opener: "\"Hi {name}, {your name} from {firm}. You asked me to call you back today about your investments — is now still a good time?\"",
      questions: [
        "Last time you mentioned {goal}. Is that still the priority?",
        "Have you had a chance to think about meeting to go through it properly?",
        "What would make the meeting most useful for you?",
      ],
      objections: [
        ["Call me next month.", "Of course. Which date works? I'll put it in and call you then, not before."],
        ["I'm comparing a few options.", "Sensible. We can show you how we work and what we would recommend for your goal — then you decide."],
        ["Markets are high, I'll wait.", "Nobody can time the market reliably. For a long-term goal, many investors start with a SIP to spread purchases over time. We can discuss what suits your horizon."],
      ],
      next: "A meeting date, or ONE agreed call-back date. After two postponements without a reason, offer to keep in touch through updates and move the lead to Contact in Future.",
      log: ["Call outcome and the new date.", "Any new information (goal, amount, decision-maker)."],
    }),
  },
  {
    key: "mfd_script_lead_call_not_connected",
    title: "Call script — call not connected",
    category: "Scripts",
    appliesTo: [STAGE("call_not_connected"), POS("relationship_manager")],
    markdown: scriptMd({
      goal: "Goal: reach the person within three attempts without becoming a nuisance.",
      opener:
        "Voicemail / WhatsApp after a missed call: \"Hello {name}, this is {your name} from {firm}, a mutual fund distributor. You enquired about investing — I tried calling you. Please tell me a convenient time and I'll call then.\"",
      questions: [
        "When you do connect: is this a good time, or when should I call?",
        "Is this the best number, or would WhatsApp suit you better?",
        "Are you still looking at investing for {goal}?",
      ],
      objections: [
        ["Who gave you my number?", "Name the source exactly (the form they filled on {date}, or the referral by {name}). If they did not enquire, apologise and mark them not to be contacted."],
        ["Stop calling me.", "Apologise, confirm you will not call again, and record the opt-out in the CRM the same minute."],
      ],
      next: "Three attempts on different days and times (morning, evening, weekend), with one approved WhatsApp message. Still nothing: move to Contact in Future with a date 60–90 days out.",
      log: ["Each attempt (\"No answer\" / \"Busy\" do not count as contact).", "Any opt-out — the consent record must show it."],
    }),
  },
  {
    key: "mfd_script_lead_meeting_scheduled",
    title: "Call script — before the meeting",
    category: "Scripts",
    appliesTo: [STAGE("meeting_scheduled"), POS("relationship_manager")],
    markdown: scriptMd({
      goal: "Goal: the client turns up, prepared, and the meeting can do its job.",
      opener: "\"Hi {name}, {your name} from {firm}. Just confirming we're meeting {tomorrow at time / place / video link}.\"",
      questions: [
        "Does the time still work for you?",
        "Were you able to download your CAS? Shall I send the steps again?",
        "Will {spouse / family member} join us?",
        "Anything you'd like me to prepare in advance?",
      ],
      objections: [
        ["Something came up.", "No problem — let's fix a new time now rather than lose the thread. Which day works?"],
        ["I don't have my statement.", "Bring what you can; we can request the CAS from the RTA together in the meeting."],
      ],
      next: "Meeting confirmed (or rescheduled on the same call) and the client knows what to bring. Send the risk profile link in advance if they prefer to fill it at home.",
      log: ["Confirmation or the new date (Meeting Pending if awaiting their confirmation).", "Documents expected."],
    }),
  },
  {
    key: "mfd_script_lead_meeting_done",
    title: "Call script — after the meeting",
    category: "Scripts",
    appliesTo: [STAGE("meeting_done"), POS("relationship_manager")],
    markdown: scriptMd({
      goal: "Goal: close the loop on the meeting and agree when the proposal will be discussed.",
      opener: "\"Hi {name}, thank you for meeting us yesterday. I'm calling to recap what we agreed and the next step.\"",
      questions: [
        "Did I capture your goals right: {goal, amount, year}?",
        "Have you completed the risk profile questionnaire? Any question you weren't sure how to answer?",
        "When can we go through the recommendation together — this week?",
        "Any documents still to send for your KYC?",
      ],
      objections: [
        ["Just WhatsApp me the funds.", "I'll share a written proposal so you have the reasons, the risks and the costs in one place — and I'd like to walk you through it so you can ask questions."],
        ["Why regular plan and not direct?", "A direct plan has a lower expense ratio; a regular plan includes our commission, which pays for our service — the reviews, the paperwork and being there when markets fall. We disclose it in the proposal; the choice is yours."],
      ],
      next: "A date to present the proposal, after the client has confirmed their risk profile. A lead that is not a fit moves to Not Qualified with the reason.",
      log: ["Meeting notes and goals on the lead.", "Risk profile status.", "The proposal-discussion task with its date."],
    }),
  },
  {
    key: "mfd_script_lead_proposal_sent",
    title: "Call script — proposal shared",
    category: "Scripts",
    appliesTo: [STAGE("proposal_sent"), POS("relationship_manager")],
    markdown: scriptMd({
      goal: "Goal: the client understands the proposal and makes an informed decision — yes, no or a change.",
      opener: "\"Hi {name}, {your name} from {firm}. I shared your proposal on {date} — have you had a chance to go through it? I'd like to answer any questions.\"",
      questions: [
        "Does the plan match what you told us about your goals and time frame?",
        "Is the risk level of the schemes comfortable for you, given your risk profile?",
        "Is the amount and SIP date workable with your monthly cash flow?",
        "Would you like to go ahead, change something, or think about it further?",
      ],
      objections: [
        ["Another distributor showed higher returns.", "Past returns don't predict future ones, and a scheme with higher past returns may carry more risk than suits you. Let's compare on risk, cost and fit to your goal."],
        ["Can you guarantee I won't lose money?", "No one can — mutual fund investments are subject to market risks. What we can do is match the risk to your time frame and review it with you regularly."],
        ["I'll think about it.", "Of course. What would help you decide? Let's agree a day for me to check back."],
      ],
      next: "Acceptance recorded in the CRM (Proposals → Accepted), then documents / KYC start; or the requested change; or a dated follow-up.",
      log: ["Proposal outcome: accepted, declined (with reason) or revised.", "The next task: documents, KYC or a follow-up date."],
    }),
  },
  {
    key: "mfd_script_lead_documents_pending",
    title: "Call script — documents pending",
    category: "Scripts",
    appliesTo: [STAGE("documents_pending"), STAGE("request_documents"), POS("relationship_manager"), POS("operations_executive")],
    markdown: scriptMd({
      goal: "Goal: collect the remaining onboarding documents in one go so KYC and the client code can start.",
      opener: "\"Hi {name}, {your name} from {firm}. To set up your account we still need {exact list}. I'm calling to make that easy for you.\"",
      questions: [
        "Would the upload link or a visit from us be easier?",
        "Is your PAN linked to your Aadhaar? (If not, that has to be done first.)",
        "Which bank account will you invest from — do you have a cancelled cheque or statement for it?",
        "Whom would you like as your nominee(s)?",
      ],
      objections: [
        ["Why do you need my Aadhaar?", "KYC is required by SEBI for every investor. We store only what's needed, mask the Aadhaar number, and keep it in our secure system — never on chat."],
        ["I'll send it later.", "Sure — when is a good day? I'll call you then; the account takes a few working days after we receive them."],
      ],
      next: "Documents received (journey moves to Documents Received) and handed to Operations for KYC, UCC and mandate; or a fixed date to collect them.",
      log: ["Which documents are in and which are missing.", "The collection date or the handover to Operations."],
    }),
  },
];

/** The whole starter manual: the SOPs, then the lead stage scripts. */
export const STARTER_MANUAL: StarterSop[] = [...STARTER_SOPS, ...STARTER_SCRIPTS];

export const STARTER_MANUAL_KEYS: string[] = STARTER_MANUAL.map((s) => s.key);
