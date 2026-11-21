/**
 * The calculator catalog, in the web's order: the same groups, keys, names and
 * one-line descriptions as CATALOG in src/components/calculators/CalculatorsApp.tsx
 * (only the icons differ — Feather here, Lucide there). The registry pairs each
 * entry with its def (./defs/*); an entry with no def is simply not listed.
 */

import type { FeatherName } from "./types";

export type CatalogItem = { key: string; name: string; icon: FeatherName; desc: string };
export type CatalogGroup = { title: string; items: CatalogItem[] };

export const CATALOG: CatalogGroup[] = [
  {
    title: "SIP & Wealth Building", items: [
      { key: "sip360", name: "SIP 360° Planner", icon: "trending-up", desc: "Deep SIP analysis — future value, step-up, delay & maturity" },
      { key: "reckoner", name: "Step-Up SIP Reckoner", icon: "bar-chart", desc: "Compare regular vs %/₹ step-up across timeframes" },
      { key: "growing", name: "Step-up SIP vs Regular SIP", icon: "chevrons-up", desc: "Year-by-year corpus, profit % and a growth chart — step-up vs flat SIP" },
      { key: "salary", name: "Salary → Wealth", icon: "briefcase", desc: "Invest a % of salary that rises with increments" },
      { key: "fvannual", name: "FV of Annual Lumpsum", icon: "calendar", desc: "Future value of a yearly lumpsum investment" },
      { key: "annualreq", name: "Annual Lumpsum for Target", icon: "crosshair", desc: "Yearly lumpsum needed to reach a goal" },
      { key: "sip", name: "Lumpsum + SIP Future Value", icon: "droplet", desc: "A lumpsum plus a monthly SIP, each at its own return, year by year" },
      { key: "cagr", name: "CAGR", icon: "percent", desc: "Annualised growth rate between two values" },
      { key: "lumpsumfv", name: "Lumpsum Future Value", icon: "dollar-sign", desc: "What a one-time investment grows to, two scenarios, year by year" },
      { key: "sipfv", name: "SIP Future Value", icon: "repeat", desc: "Monthly SIP value in two scenarios, against a % or ₹ step-up" },
      { key: "stepupfv", name: "Step-Up SIP Future Value", icon: "bar-chart-2", desc: "A SIP raised by a % every year: yearly instalments and value" },
      { key: "limitedfv", name: "Limited-Period SIP Value", icon: "pause", desc: "SIP for a few years, then stay invested: the value it reaches" },
      { key: "sipstp", name: "SIP + STP Future Value", icon: "git-merge", desc: "A monthly SIP plus a lumpsum whose debt-fund gain is moved to equity" },
      { key: "compounding", name: "Compound Interest", icon: "plus-circle", desc: "Growth at any compounding frequency, regular additions and the effective annual rate" },
    ],
  },
  {
    title: "Goals & Planning", items: [
      { key: "goalplan", name: "Goal Planner", icon: "target", desc: "Lumpsum/SIP needed for one or many goals" },
      { key: "multipurpose", name: "Cashflow & Corpus", icon: "shuffle", desc: "Build a corpus and draw income from it" },
      { key: "vacation", name: "Vacation Planner", icon: "sun", desc: "Save up for a dream trip" },
      { key: "childedu", name: "Child Education", icon: "book-open", desc: "Fund education at ~10% education inflation" },
      { key: "childsip", name: "Early-Start Child SIP", icon: "smile", desc: "Invest in the early years, then let it compound for life" },
      { key: "collision", name: "Goal-Collision Timeline", icon: "calendar", desc: "Spot the years your goals overlap & peak" },
      { key: "feasibility", name: "Goal-Feasibility Score", icon: "check-circle", desc: "0–100 score — are the goals on track?" },
      { key: "inflation", name: "Inflation", icon: "thermometer", desc: "What today's cost becomes in the future" },
      { key: "delay", name: "SIP for a Target & Cost of Delay", icon: "clock", desc: "Monthly SIP for a target, step-up option and what each year's delay costs" },
      { key: "retirement", name: "Retirement Need Based", icon: "sunset", desc: "Corpus for today's lifestyle, the gap, and SIP / lumpsum ways to fill it" },
      { key: "limitedneed", name: "Limited-Period SIP for a Target", icon: "check-square", desc: "Monthly SIP needed when it runs a few years and then stays invested" },
      { key: "stepuptarget", name: "Step-Up SIP for a Target", icon: "triangle", desc: "Starting SIP that, raised every year, reaches the target" },
      { key: "siplstarget", name: "SIP or Lumpsum for a Target", icon: "sliders", desc: "SIP needed beside a lumpsum, or lumpsum needed beside a SIP" },
      { key: "lstarget", name: "Lumpsum for a Target", icon: "map-pin", desc: "One-time amount today that grows to the target, two scenarios" },
      { key: "sipstpgoal", name: "SIP / STP for Target", icon: "git-pull-request", desc: "Monthly SIP (or STP lumpsum) needed alongside an STP to reach a goal" },
      { key: "stpgoal", name: "STP for Target", icon: "navigation", desc: "Lumpsum to park in debt and move to equity by STP to reach a goal" },
      { key: "ppf", name: "PPF Maturity", icon: "feather", desc: "Fixed or year-by-year PPF deposits over 15 years, with 5-year extensions" },
      { key: "epf", name: "EPF Corpus", icon: "briefcase", desc: "Provident Fund at retirement from rising salary, employee and employer shares" },
    ],
  },
  {
    title: "Income & Withdrawal (SWP/STP)", items: [
      { key: "bridge", name: "Income Bridge (SIP→SWP)", icon: "git-commit", desc: "Build with SIP, then draw a monthly income" },
      { key: "swpperiodic", name: "SWP Periodic", icon: "repeat", desc: "Periodic withdrawals from a corpus" },
      { key: "swpend", name: "SWP End Period", icon: "clock", desc: "How long your money lasts under SWP" },
      { key: "swpcomp", name: "SWP Comprehensive", icon: "file-text", desc: "Full SWP — any mode, frequency & increment" },
      { key: "stpcomp", name: "STP Comprehensive", icon: "refresh-cw", desc: "Move debt → equity systematically" },
      { key: "opm", name: "OPM House (SWP)", icon: "home", desc: "Fund a home using an SWP income stream" },
      { key: "swp", name: "Monthly SWP from Lumpsum", icon: "download", desc: "Monthly income a lumpsum supports, with tax projection" },
      { key: "stp", name: "Future Value of STP", icon: "shuffle", desc: "Debt → equity each month: capital appreciation, fixed ₹ or fixed % of initial" },
      { key: "prosperity", name: "Prosperity Multiplier", icon: "trending-up", desc: "SIP → growing income for life, corpus keeps compounding" },
      { key: "swpneed", name: "Lumpsum for Monthly SWP", icon: "archive", desc: "One-time investment that funds a target monthly SWP" },
      { key: "sipforswp", name: "SIP for Monthly SWP", icon: "heart", desc: "Corpus and monthly SIP needed for a target SWP" },
      { key: "swprebal", name: "SWP Rebalance", icon: "sliders", desc: "Withdraw from debt, refill it from a balanced fund's gains" },
    ],
  },
  {
    title: "Ready Reckoners", items: [
      { key: "lsreckoner", name: "Lumpsum Growth Reckoner", icon: "grid", desc: "Grid of what one lumpsum grows to — up to 3 returns × 5 periods" },
      { key: "lsneedreckoner", name: "Lumpsum Needed Reckoner", icon: "grid", desc: "Grid of the lumpsum needed today for a target — returns × periods" },
      { key: "sipreckoner", name: "SIP Growth Reckoner", icon: "layout", desc: "Grid of SIP future values — up to 3 returns × 5 periods" },
      { key: "sipneedreckoner", name: "SIP Needed Reckoner", icon: "layout", desc: "Grid of the monthly SIP needed for a target — returns × periods" },
      { key: "stpreckoner", name: "STP Growth Reckoner", icon: "columns", desc: "Grid of STP future values — 3 debt | equity scenarios × 5 periods" },
      { key: "stpneedreckoner", name: "STP Needed Reckoner", icon: "columns", desc: "Grid of the lumpsum an STP needs for a target — scenarios × periods" },
      { key: "sipswp", name: "SIP–SWP Ready Reckoner", icon: "repeat", desc: "Top-up or salary-linked SIP, then an inflation-rising SWP" },
    ],
  },
  {
    title: "Fund Research", items: [
      { key: "frsip", name: "SIP Return of a Scheme", icon: "repeat", desc: "A SIP in a real scheme: invested, value, XIRR and every instalment's NAV and units" },
      { key: "frlumpsum", name: "Lumpsum Return of Schemes", icon: "bar-chart-2", desc: "One amount in up to 5 real schemes: value, profit, CAGR and absolute return" },
      { key: "frstp", name: "STP Return of Two Schemes", icon: "shuffle", desc: "A fixed STP between two real schemes: both legs' units, values, profit and XIRR" },
      { key: "frstpprofit", name: "STP Return — Profit Transfer", icon: "fast-forward", desc: "Move only the gain above the initial investment each period, on real NAVs" },
      { key: "frswp", name: "SWP Return of a Scheme", icon: "download", desc: "Withdrawals from a real scheme: value left, XIRR and FIFO gain on each withdrawal" },
      { key: "frrolling", name: "Rolling Returns", icon: "activity", desc: "Daily 1–10 year rolling returns of up to 5 schemes: average, range and bands" },
      { key: "frp2p", name: "Point-to-Point Comparison", icon: "maximize-2", desc: "Up to 5 schemes over one period: growth, CAGR, volatility and Sharpe ratio" },
      { key: "frcalendar", name: "Calendar-Year Returns", icon: "calendar", desc: "Each calendar year's return for up to 5 schemes, side by side" },
      { key: "frmonthly", name: "Monthly & Quarterly Returns", icon: "bar-chart", desc: "A scheme's return in every month or quarter, year by year" },
    ],
  },
  {
    title: "Insurance & Protection", items: [
      { key: "insurance", name: "Insurance IRR", icon: "shield", desc: "A policy's real return vs mutual funds" },
      { key: "surrender", name: "Surrender vs Invest", icon: "scissors", desc: "Keep a policy, or surrender and invest?" },
      { key: "hlv", name: "Human Life Value", icon: "users", desc: "Term cover your family actually needs" },
      { key: "termsip", name: "Term Insurance + SIP", icon: "shield", desc: "Term cover plus a monthly SIP: from a budget, for a goal, or against a traditional policy" },
    ],
  },
  {
    title: "Tax", items: [
      { key: "taxregime", name: "Old vs New Tax Regime", icon: "git-branch", desc: "Which regime saves more (FY 2025-26)" },
      { key: "realreturn", name: "Real Return", icon: "trending-down", desc: "Your return after tax and inflation" },
      { key: "nps", name: "NPS Retirement & Tax", icon: "award", desc: "Corpus, pension and the 80CCD(1B) benefit" },
      { key: "harvest", name: "LTCG Tax-Harvesting", icon: "scissors", desc: "Bank the ₹1.25L tax-free gain every year" },
      { key: "captax", name: "Capital Gains Tax", icon: "file-text", desc: "LTCG/STCG with CII indexation" },
      { key: "cgbond", name: "54EC Bond vs Other Investment", icon: "percent", desc: "Park a capital gain in a 54EC bond or pay the tax and invest: post-tax value and IRR" },
      { key: "cii", name: "Cost Inflation Index", icon: "list", desc: "The CII table from FY 2001-02 and a cost indexed from one year to another" },
    ],
  },
  {
    title: "Property & Assets", items: [
      { key: "property", name: "Property Yield", icon: "home", desc: "The real return on a property investment" },
      { key: "debtfund", name: "Debt Fund Hold/Sell", icon: "bar-chart-2", desc: "Hold or sell a debt fund, post-tax" },
      { key: "emisip", name: "EMI → SIP", icon: "refresh-ccw", desc: "Turn an EMI into wealth instead" },
      { key: "assetalloc", name: "Asset Allocation FV", icon: "pie-chart", desc: "Future value of a Debt/Equity mix" },
      { key: "loanemi", name: "Loan EMI", icon: "credit-card", desc: "Home, personal, car or education loan: EMI, interest split, amortisation and part-prepayment" },
    ],
  },
  {
    title: "Investor Conversion", items: [
      { key: "crorepati", name: "Crorepati Countdown", icon: "award", desc: "The month a SIP crosses 1/2/5 crore" },
      { key: "habit", name: "Small Habit, Big Corpus", icon: "coffee", desc: "Turn daily spending into a long-term corpus" },
      { key: "fdgap", name: "FD vs Equity Gap", icon: "git-branch", desc: "Compare FD comfort with equity wealth creation" },
      { key: "rentbuy", name: "Rent vs Buy", icon: "home", desc: "Buy a home or rent and invest the difference" },
      { key: "lifestyle", name: "Inflation Lifestyle Shock", icon: "alert-triangle", desc: "What today's lifestyle costs at retirement" },
      { key: "moneylast", name: "Will My Money Last?", icon: "watch", desc: "Does the retirement corpus outlive the client?" },
      { key: "crorerace", name: "₹1 Crore Race", icon: "flag", desc: "Years to the goal across different SIPs" },
    ],
  },
  {
    title: "Advisor Tools", items: [
      { key: "portfoliohealth", name: "Portfolio Health Score", icon: "activity", desc: "100-point portfolio diagnostic for reviews" },
      { key: "fundoverlap", name: "Fund Overlap", icon: "layers", desc: "Show when many funds behave like fewer funds" },
      { key: "aumopportunity", name: "AUM Opportunity", icon: "dollar-sign", desc: "Estimate extra AUM and SIP business potential" },
      { key: "xirr", name: "XIRR", icon: "calendar", desc: "True return on irregular, dated cashflows" },
      { key: "rebalance", name: "Portfolio Rebalancing", icon: "sliders", desc: "Exact buy/sell to hit your target mix" },
      { key: "expensedrag", name: "Expense-Ratio Drag", icon: "anchor", desc: "What a costlier fund quietly costs you" },
      { key: "review", name: "Review of Investments", icon: "clipboard", desc: "Compare your funds' performance side by side" },
      { key: "allocreview", name: "Asset Allocation Review", icon: "check-square", desc: "Existing vs suggested portfolio — 5y & 10y projection + asset mix" },
      { key: "realstatement", name: "REAL Statement (Net Worth & Cashflow)", icon: "file-text", desc: "Full discovery snapshot — income, expenses, surplus, assets, liabilities & net worth" },
      { key: "portproj", name: "Portfolio Projection", icon: "trending-up", desc: "Portfolio + yearly lumpsum + SIP projected, current vs increased investing" },
    ],
  },
  {
    title: "Markets & Mindset", items: [
      { key: "crash", name: "Market-Crash Stress Test", icon: "trending-down", desc: "The cost of panic-selling vs staying invested" },
      { key: "fire", name: "FIRE Number", icon: "zap", desc: "When can you achieve financial independence?" },
    ],
  },
  {
    title: "Smart Decisions", items: [
      { key: "prepayinvest", name: "Prepay vs Invest", icon: "git-branch", desc: "Prepay the loan or invest the surplus?" },
      { key: "btid", name: "Term + MF vs ULIP", icon: "umbrella", desc: "Buy term & invest vs a bundled policy" },
      { key: "npsvsmf", name: "NPS vs Mutual Fund", icon: "columns", desc: "Retirement: tax break vs flexibility" },
      { key: "housingstrategy", name: "Home-Buying Strategy", icon: "key", desc: "Pay off / keep loan / rent — which builds more wealth" },
    ],
  },
  {
    title: "Dreams & Milestones", items: [
      { key: "passiveincome", name: "Financial-Freedom Builder", icon: "anchor", desc: "The SIP for a target passive income" },
      { key: "wedding", name: "Dream Wedding Planner", icon: "gift", desc: "Fund the big day, stress-free" },
      { key: "dreamcar", name: "Dream Car — Invest First", icon: "truck", desc: "Invest & buy cash vs an auto-loan" },
      { key: "youthbucket", name: "4-Bucket Freedom", icon: "package", desc: "Fund freedom across 4 buckets — far lower SIP" },
      { key: "journey", name: "Journey to Freedom", icon: "compass", desc: "The year your corpus funds life forever" },
      { key: "familywealth", name: "Family Wealth Plan", icon: "heart", desc: "Lumpsum + SIP across a 4-class portfolio" },
    ],
  },
  {
    title: "Essentials & Behaviour", items: [
      { key: "emergency", name: "Emergency Fund Planner", icon: "umbrella", desc: "Build the financial seatbelt first" },
      { key: "buckets", name: "Retirement Bucket Strategy", icon: "box", desc: "Draw income for life across 3 buckets" },
      { key: "sippause", name: "Cost of Pausing a SIP", icon: "pause-circle", desc: "What skipping SIPs costs at the goal" },
      { key: "budget", name: "Monthly Budget Planner", icon: "credit-card", desc: "Budget health check + grow the surplus" },
    ],
  },
  {
    title: "Engagement & Fun", items: [
      { key: "quiz", name: "Money Personality Quiz", icon: "cpu", desc: "Reveal an investor archetype + asset mix" },
      { key: "timemachine", name: "Inflation Time Machine", icon: "rotate-ccw", desc: "What money is worth across the years" },
      { key: "doubling", name: "Wealth Doubling (Rule of 72)", icon: "copy", desc: "How fast money doubles + milestones" },
    ],
  },
];
