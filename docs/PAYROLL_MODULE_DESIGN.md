# Employee Payroll — module design

Status: **phase 1 built** (2026-11-16, migration 0261, `src/lib/payroll/`).
Built with these defaults for the open questions (all firm settings):
calendar-day months, PF on Basic capped at ₹15,000, Basic 50% of gross, HRA
40% of Basic, new tax regime only, Gujarat as the default state, a generic
bank CSV. Phase 1 as built differs from §3 in three ways: a salary is a
monthly gross split by the firm's percentages (structure templates come in
phase 2); statutory rates live in `lib/payroll/statutory.ts` as dated tables
in code, not a database table; mid-year starters get an opening balance
(salary and TDS already paid this financial year) on their payroll details.

The CRM already knows who works for the firm, when they came in, what leave
they took and what business they brought. Payroll turns that into a monthly
pay run: gross to net, statutory deductions, payslips, the bank transfer file
and the returns the firm has to file. Ideas are taken from Zoho Payroll,
greytHR, Keka and RazorpayX Payroll; the rules are Indian (Code on Wages,
Social Security Code, Income-tax Act 2025).

---

## 1. Who uses it

| Person | Does | Capability (new) |
|---|---|---|
| Owner | Approves the pay run, sees every salary, sets policy | implicit |
| Payroll / HR admin (often the owner or an ops person) | Sets up structures, runs payroll, handles exits | `payroll.manage` |
| Accountant / CA (optional login) | Reads the registers and statutory files | `payroll.view` |
| Reporting manager | Approves reimbursements and incentive inputs for their team; **never** sees salaries | — |
| Every employee | My Pay: payslips, tax declaration, proofs, loans, claims, Form 16 | self |

Salaries are the most sensitive data in the CRM. Nobody else sees an amount —
not the branch head, not the employee list, not the assistant (the AI switch
and pseudonymiser from DPDP step 4 apply, and payroll tables are never sent to
the AI at all).

---

## 2. What it builds on (no duplicates)

| Already in the CRM | Payroll uses it for |
|---|---|
| `users` — name, employee code, department, joining date, reporting manager, branch | The employee master. Payroll adds a **payroll profile** beside it, not a second employee table. |
| `attendance`, `attendance_regularizations`, `attendance_settings`, `holidays` | Payable days. A day absent and not regularised, and not covered by approved leave, is loss of pay (LOP). |
| `leave_applications` + `leave_settings` | `unpaid` leave → LOP; earned-leave balance → encashment at exit. |
| Business entries / RTA-confirmed business (`lib/metrics/business.ts`), `kra_targets`, insurance commission | Sales incentives — the firm's rule: **incentives count what the RTA processed**. |
| `business_expenses` | The month's salary cost is posted there automatically (salary, employer PF/ESI, gratuity accrual). |
| Tasks + escalation ladder | Pay-run steps, statutory due dates, declaration and proof deadlines. |
| Audit log, DPDP retention, 2FA | Every payroll change audited; payroll admins must use 2FA. |

---

## 3. Concepts

### 3.1 Payroll profile (per employee)

PAN, UAN, PF number, ESI IP number, bank account (encrypted; shown masked),
IFSC, payment mode (bank / cheque / cash), **work state** (decides PT and LWF),
tax regime (new by default), employment type (permanent · probation · fixed
term · intern), PF option (capped at the wage ceiling or on full wages), ESI
applicable (auto from gross), date of exit.

Consultants and sub-brokers are **not** employees — they are paid as vendors
with TDS on fees/commission. Payroll refuses them.

### 3.2 Salary components (firm library)

| Field | Meaning |
|---|---|
| Type | Earning · Deduction · Reimbursement · Variable · Employer contribution |
| Calculation | Fixed · % of Basic · % of CTC · Balancing (Special Allowance absorbs the rest of CTC) · Formula |
| Taxable | Yes / No / Partly (e.g. exempt reimbursement under the old regime) |
| Pro-rata | Reduced for LOP days or not |
| In "wages" (Code on Wages) | Basic, DA and retaining allowance are wages; HRA, conveyance, overtime, bonus are exclusions — and exclusions above **50% of total remuneration** are counted back into wages |
| In PF wages / ESI wages | Which components PF and ESI are worked on |
| Payslip order and label | |

Starter library: Basic, HRA, Special Allowance, Conveyance, LTA, Medical,
Statutory Bonus, Incentive, Arrears, Leave Encashment, Overtime; deductions PF,
ESI, PT, LWF, TDS, Loan EMI, Advance Recovery, Notice-period Recovery.

### 3.3 Salary structures and revisions

A **structure template** (e.g. "RM — Ahmedabad") gives the components and
their rules; an **employee salary** is a template applied to an annual CTC,
with an effective date. Revisions are new versions, never edits; a revision
dated in the past creates **arrears** in the next pay run, shown as their own
line.

The structure builder warns, live, when:
- wages fall below 50% of total remuneration (Code on Wages);
- Basic falls below the state's minimum wage for the role;
- the employee crosses the ESI ceiling (₹21,000 gross a month) and PF/ESI change.

### 3.4 Statutory settings — dated, never hard-coded

Every rate lives in a table with an **effective-from date**, so a change in the
law is a new row, a past month recalculates on the old rate, and the firm can
see what applied when. Defaults to load (verify with the firm's CA at go-live):

| Item | Default |
|---|---|
| EPF | Employee 12% of PF wages; employer 12% (8.33% to EPS on wages up to ₹15,000, rest to EPF); EDLI 0.5%; admin 0.5%. Ceiling ₹15,000, or full wages if the firm/employee opts. |
| ESI | Employee 0.75%, employer 3.25% while gross ≤ ₹21,000; once in, stays in for the contribution period (Apr–Sep, Oct–Mar). |
| Professional Tax | State slab table (Gujarat, Maharashtra, Karnataka, West Bengal, Telangana… as firms need); some states deduct in specific months. |
| LWF | Per state, with its months (half-yearly / yearly). |
| TDS on salary | New regime by default: slabs nil to ₹4 L, then 5% steps to 30% above ₹24 L; standard deduction ₹75,000; rebate up to ₹12 L income; 4% cess; surcharge bands. Old regime if the employee chooses it. |
| Gratuity | 15 days' wages per year of service (wages ÷ 26 × 15); eligible after 5 years, or 1 year for fixed-term staff under the Social Security Code. Accrued monthly as a cost. |
| Statutory bonus | 8.33%–20% for employees with wages up to ₹21,000 (calculation ceiling ₹7,000 or the minimum wage, whichever is higher). |

### 3.5 Pay run (one per month per pay group)

States: **Draft → Inputs → Calculated → Reviewed → Approved → Paid → Locked.**

1. **Cut-off** (firm setting, e.g. the 25th): attendance and leave up to the
   cut-off are taken; the days after it are adjusted next month.
2. **Inputs**, each with who supplied it:
   - LOP days (from attendance + leave, editable with a reason);
   - one-time earnings and deductions (bonus, referral bonus, recovery);
   - approved incentives (section 5); approved reimbursement claims;
   - loan EMIs due; salary on hold; new joiners and exits.
3. **Calculate** for every employee, in this order, each step writing a
   one-line "why" kept on the payslip's working (no silent numbers):
   payable days (calendar days, or fixed 30 / 26 — firm setting) → pro-rated
   components → variable pay and arrears → wages test (50%) → PF → ESI → PT →
   LWF → TDS (annual projection ÷ months left, adjusted for what was already
   deducted) → loans and advances → net pay → rounding.
4. **Review**: a variance sheet against last month (who changed by more than
   10%, who is new, who left, who has zero pay), totals by branch and
   department, and the employer cost.
5. **Approve** (maker-checker: whoever prepared it cannot approve it).
6. **Pay**: the bank transfer file (bulk NEFT/RTGS in the firm's bank format,
   or a generic CSV), payslips released to My Pay and emailed (password
   protected with PAN + date of birth), journal posted to business expenses.
7. **Lock**: no edits; a mistake is fixed by an adjustment next month or an
   off-cycle run (bonus, F&F, correction).

### 3.6 Tax declarations and proofs

Window opens in April (declare) and January (prove). Old regime: HRA (rent and
landlord PAN above ₹1 L a year), 80C, 80D, home-loan interest, LTA; new regime:
employer NPS (80CCD(2)) and little else. Previous-employer income for joiners.
TDS projection shown to the employee: "Your tax this year: ₹X; next month ₹Y."
Proofs not submitted by the deadline → TDS recalculated on declared-minus-unproved.

### 3.7 Loans and advances

Amount, EMI, start month, interest (perquisite value above ₹20,000 if
interest-free), recovery schedule; outstanding balance recovered at exit.

### 3.8 Reimbursements

Claim with bill (fuel, phone, client meeting, travel) → reporting manager
approves → payroll admin includes in the pay run. Same claim can never be paid
twice (bill hash + amount + date).

### 3.9 Exit and full & final settlement

Last working day → notice-period shortfall recovery or pay → leave encashment
from the earned-leave balance → gratuity if eligible → pending reimbursements,
incentives earned up to exit → loan balance recovered → F&F statement with
every line explained, paid in an off-cycle run within the Code's time limit
(two working days of exit for wages). The employee's CRM login, clients and
open tasks are handed over by the existing offboarding flow.

---

## 4. Statutory outputs

| Output | Format | When |
|---|---|---|
| PF ECR | EPFO text file (UAN, wages, contributions) | by the 15th |
| ESI contribution | ESIC upload file | by the 15th |
| Professional Tax | State-wise summary for the challan | per state |
| LWF | Summary | per state's months |
| TDS | Monthly challan amount; quarterly 24Q data (deductee details) | 7th; quarterly |
| Form 16 Part B + 12BA | PDF per employee | by 15 June |
| Salary register, CTC report, payslips | PDF / Excel | every run |

The CRM prepares files; the firm uploads them on the government portals (no
e-filing integration — Form 16 Part A comes from TRACES). Each due date is a
task for the payroll admin, escalated if missed.

---

## 5. Sales incentives — the MFD part

An **incentive plan** per role or person, per quarter or month:

- **Measure** (from the CRM, never typed): RTA-confirmed net business, net SIP
  added, new clients, insurance premium, AUM growth — the same definitions as
  the dashboards (`lib/metrics`).
- **Shape**: slabs on achievement of target (e.g. below 80% nil, 80–100% 1%,
  above 100% 1.5% of net sales), a cap, a gate (e.g. no incentive if
  compliance gaps are open), clawback if a SIP is cancelled within 90 days.
- **Flow**: calculated at period end → statement to the employee ("why this
  amount", client by client) → manager confirms → owner approves → lands in
  the next pay run as a taxable variable earning.

Incentives use RTA-processed business (the firm's decision of 2026-10-02);
booked-but-not-processed business shows as "pending RTA" and pays once it
arrives.

---

## 6. Screens

- **Payroll** (sidebar, Team group; owner + payroll admin):
  - Overview — this month's run, cost trend, upcoming statutory dates.
  - Pay runs — list, and the run itself (inputs · calculate · review · approve · pay).
  - Employees — payroll profile and salary history per person.
  - Salary structures, Components.
  - Incentive plans.
  - Loans & advances, Reimbursements.
  - Exits (F&F).
  - Reports — salary register, variance, CTC, statutory files.
  - Settings — pay cycle, cut-off, payable-days method, states, statutory rates, approvers, payslip design.
- **My Pay** (every employee, also in the mobile app): payslips, CTC breakdown,
  tax declaration and proofs, Form 16, loans, claims.

---

## 7. Data model (new tables, all with `tenant_id` + RLS)

`payroll_settings` · `payroll_profiles` · `salary_components` ·
`salary_structures` · `employee_salaries` (versioned) · `statutory_rates`
(dated) · `pay_runs` · `pay_run_items` (per employee; earnings, deductions and
the "why" lines frozen as JSON at calculation) · `pay_run_adjustments` ·
`payslips` · `tax_declarations` · `tax_proofs` · `employee_loans` ·
`reimbursement_claims` · `incentive_plans` · `incentive_statements` ·
`exit_settlements` · `statutory_filings`.

A locked pay run's items are never recalculated — the frozen JSON is the
record (as `workflow_versions` are for workflows).

---

## 8. Privacy and controls

- Bank account, PAN, UAN encrypted at rest; masked everywhere but the bank
  file and the employee's own view.
- Only `payroll.manage` / `payroll.view` and the employee themself see amounts;
  every view of another person's salary is audited.
- Payroll admins must have 2FA on (enforced even if the firm has not required
  it for everyone).
- Maker-checker on approval; a locked run cannot be edited.
- Retention: payroll records kept 8 years (Income-tax and labour-code
  registers), then the DPDP retention job erases them.

---

## 9. Phases

| Phase | Scope | Size |
|---|---|---|
| **1 — Pay the team correctly** | Payroll profiles; components and structures; monthly pay run with attendance/LOP; PF, ESI, PT (firm's states), TDS new regime; payslips (PDF + email + My Pay); bank file; salary register; maker-checker; journal to business expenses | ~2–3 weeks |
| **2 — Everything around it** | Tax declarations and proofs (old regime); reimbursements; loans and advances; revisions with arrears; **incentive plans**; PF ECR and ESIC files; variance report | ~2 weeks |
| **3 — Exits and year-end** | F&F settlement; gratuity and bonus; LWF; Form 16 Part B / 12BA; 24Q data; payroll analytics on the Owner Dashboard; My Pay in the mobile app | ~2 weeks |

---

## 10. Open questions (needed before phase 1)

1. Which **states** do the firms' staff work in? (PT and LWF are per state.)
2. **Pay date** and attendance **cut-off** (e.g. paid on the 1st, cut-off the 25th)?
3. **Payable days**: calendar days, fixed 30, or 26?
4. **PF**: capped at ₹15,000 wages, or on full Basic?
5. Do any firms still need the **old tax regime**?
6. Which **bank** do firms pay salaries from (for the transfer-file format)?
7. **Incentives**: is there a policy today (slabs, period, who approves)?
8. Should payroll be a **paid add-on module** (Module Controls / package) or included?

---

Sources consulted: [Zoho Payroll — statutory components](https://www.zoho.com/in/payroll/help/set-statutory-components.html),
[Zoho Payroll — salary structure guide](https://www.zoho.com/in/payroll/academy/payroll-administration/salary-structure.html),
[ClearTax — new labour codes](https://cleartax.in/s/new-labour-codes),
[HSF Kramer — labour codes implemented](https://www.hsfkramer.com/it/notes/employment/2025-posts/india-labour-codes-implemented-a-landmark-reform),
[Moneylife — Income Tax Act 2025](https://www.moneylife.in/article/indias-new-income-tax-act-2025-simpler-law-same-choices/80115.html),
[ClearTax — tax slabs FY 2026-27](https://cleartax.in/guide/taxes/).
All rates above must be confirmed with the firm's CA before go-live; they are
stored as dated settings precisely so they can be corrected without code.
