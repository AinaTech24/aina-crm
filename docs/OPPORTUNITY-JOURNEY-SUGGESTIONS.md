# Opportunity journey: suggested improvements

Review of 17 Oct 2026. Nothing here is built. Pick the ones you want.

The journey today: Need identified → Discussion → Suitability → Proposal → Client accepted → the product steps (MF: KYC → UCC → Mandate → Transaction. Insurance: Proposal form → Underwriting → Issued. Other: Executed) → Won. Lost and "Later" can happen from any open step.

Each item says what goes wrong today and what to change. **Bold** items can count the wrong business or leave work with nobody, so they come first.

---

## A. Wrong outcomes (fix first)

**A1. An existing SIP instalment can mark a new MF opportunity Won.**
The Transaction step passes on *any* purchase or SIP inflow for the client after the opportunity opened. The amount and scheme are not checked. Next month's debit on an old SIP, or an unrelated top-up, closes "New SIP ₹10,000" as Won and marks Cross-sell "Held with us".
*Change:* only count a transaction when it is a new registration (or a first instalment), or when its amount is close to the expected amount. Better still, link it to the Business Entry (A3).

**A2. Any policy recorded for the client moves an insurance opportunity forward, whatever the policy is.**
The insurance steps look at the client's latest policy since the opportunity opened, with no check on its type. A motor policy recorded for the client skips "Health / Mediclaim" through to Issued and Won.
*Change:* match the policy's `policy_type` to the opportunity's product (health → health, life → term/endowment/ULIP …), the same way proposals match by type.

**A3. Won does not follow booked business.**
The firm counts business when it is *booked* (Business Entries) and confirms it when the registrar reports it. The opportunity ignores both. It waits for the RTA feed, which comes 3–4 days late, or for someone to press the button. The amount it shows as "won" is the expected amount, not the amount actually invested.
*Change:* a confirmed Business Entry for the client and product moves the opportunity to Won and records the actual amount. If the registrar later rejects that line, reopen the opportunity, or flag it.

**A4. A proposal from before the opportunity can be counted as its proposal.**
A proposal of a matching type, made up to 7 days *before* the opportunity was opened and not linked to any opportunity, counts as "Proposal shared". With "mixed" or "comprehensive" proposals this can skip the Proposal step for the wrong product.
*Change:* count only proposals linked to this opportunity (`opportunity_id`). When an unlinked one matches, ask the RM to confirm the link.

**A5. When someone leaves the firm, they stay the owner.**
Offboarding moves the leaver's open tasks to their manager, but leaves `client_opportunities.owner_id` alone. The board, list and owner filter keep showing the leaver, and later follow-ups are created for them.
*Change:* move open opportunities in the same offboarding step that moves tasks, and audit it.

**A6. When the client's RM changes, the opportunity stays behind.**
A client handed to a new RM (bulk Assign RM, a family head change) keeps opportunities owned by the old RM, who may no longer be able to see that client.
*Change:* when the old RM owns the opportunity, move it to the new RM. Leave it alone when it was deliberately given to someone else, such as the insurance team.

## B. Nobody is told to do the next step

**B1. Only the first step creates a task.**
Opening an opportunity creates "talk to the client". Moving it on creates nothing. Once that first task is ticked, the opportunity reads "No follow-up set" until someone remembers it.
*Change:* each step creates its own task as the journey enters it, the way client onboarding now does (`lib/blueprints/journey-task.ts`). For example: "Get the risk profile confirmed", "Share the proposal", "Collect the signed form", "Place the order". A step that is skipped creates nothing.

**B2. The back-office steps have no owner.**
KYC, UCC, Mandate, Transaction and Executed are marked as back-office steps (`ownerRole`), but nobody in operations is asked to do them. The RM still holds the opportunity and Ops cannot see it in their queue.
*Change:* when the journey reaches a back-office step, give the task to an operations person. Pick them the way the Operations Dashboard does: the branch's ops desk, or a round-robin. The opportunity's owner stays the RM. The task then appears in the Operations Dashboard queue automatically, because a request there is a task.

**B3. Completing a follow-up does not ask "what next?"**
*Change:* when someone completes the last open task on an open opportunity, ask for the next follow-up date (or Later / Lost) in the same pop-up. Then an open opportunity always has a next action.

**B4. When the system moves an opportunity, nobody hears.**
Automatic moves are silent: a proposal accepted, KYC verified, a policy issued. The owner learns about it only by opening the board.
*Change:* send one notification to the owner (and the co-owner) when an automatic move lands on a step that needs a person, or on Won.

## C. Time limits (SLAs)

**C1. A stage running late is flagged, but nobody is told.**
Each stage has a time limit (2 days for Need identified, 15 for Underwriting, and so on). The nightly job marks an opportunity as delayed and its card turns amber, but it sends no notification. For leads, the same job notifies the owner and escalates untouched ones.
*Change:* do the same for opportunities. Notify the owner when a stage runs late. When Need identified passes its 2 days untouched, also tell the branch head, as "Later" reminders already do.

**C2. The time limits are written into the code.**
*Change:* move them to Settings → Dashboard thresholds, next to the claims and operations limits, so the firm can tune them. Insurance underwriting time differs widely by insurer and product.

**C3. "Later" leaves the stage timer running.**
A parked opportunity keeps counting time in its stage, so when it comes back it shows as delayed at once.
*Change:* pause the stage timer while the opportunity is parked, or restart it on Resume.

## D. Gates and skips

**D1. The risk profile is checked once, at the proposal.**
If the profile lapses (passes 12 months) between the proposal and the order, the order still goes through.
*Change:* check the profile again before the Transaction step.

**D2. The proposal is not checked against the risk profile.**
The gate asks only that a profile exists. A proposal outside the client's risk band goes through the journey quietly. The proposal email already warns the client when it is beyond their risk appetite.
*Change:* hold "Client accepted" until the RM records that the client acknowledged the mismatch, using the same rule the proposal email uses.

**D3. The mandate check ignores the client's other SIPs.**
A mandate counts as covering a new SIP when its limit is at least the new SIP's amount. If the client already has SIPs on that mandate, the real headroom is smaller. When no amount was entered, any active mandate passes.
*Change:* compare the mandate limit with existing SIPs plus the new one. With no amount entered, ask for one before the Mandate step.

**D4. Insurance asks for a needs analysis but not for KYC.**
Insurers now require CKYC before a policy is issued.
*Change:* add "KYC verified" (or a CKYC number) as a gate before "Proposal form submitted".

**D5. Skips are announced in history only.**
A skip that jumps several steps, such as a proposal accepted on the first day, is easy to miss.
*Change:* one line on the card: "Moved past 3 steps — already on file".

## E. Product coverage

**E1. Only FDs have evidence for "Executed".**
NPS, PMS, demat, loans and the rest all close by hand, with no record of what was done.
*Change:* for these, ask for the account or reference number and a date when marking Executed (one field, not a form). For PMS and AIF, this can come from the Business Entry instead (A3).

**E2. One open MF opportunity per client.**
A client who wants a new SIP *and* a lumpsum, or two SIPs for two goals, can have only one open "Mutual Funds" opportunity.
*Change:* allow one open opportunity per (client, product, SIP or lumpsum). Alternatively, allow several lines on one opportunity.

## F. Reporting

**F1. No report on how opportunities move through the journey.** Suggest one module report (no new dashboard card):
- conversion from each step to the next, and overall, by product and by owner
- median days in each step against its time limit
- lost reasons by product, and how many "Later" items come back
- value: expected against actually invested for Won (needs A3)

**F2. The Owner Dashboard's Cross-sell card counts what clients hold, not what was won.**
A won opportunity and a product held anyway look the same on that card.
*Change:* add one figure to the card: won from opportunities this period (count and amount).

---

### Suggested order

1. A1, A2, A5: small changes, each one stops wrong counting or orphaned work.
2. B1 + B2 together: per-step tasks, back-office steps given to Ops.
3. C1 and B3: nothing open is left without a next action.
4. A3: Won follows booked business. This is the largest change, and it also enables F1's value figures.
