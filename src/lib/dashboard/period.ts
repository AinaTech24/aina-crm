/**
 * Dashboard period helpers — server-safe (NO "use client").
 *
 * Lives in lib (not in the PeriodSelector client component) so the server
 * OwnerCockpit can call resolvePeriodDates() directly. A client component
 * can't export functions the server invokes, so the type + the pure
 * resolver belong here; the PeriodSelector component imports the type from
 * this module.
 *
 * India FY = April–March. QTD quarters:
 *   Q1: Apr–Jun · Q2: Jul–Sep · Q3: Oct–Dec · Q4: Jan–Mar
 */

/**
 * `tw`/`lw`/`lq`/`ly` were added so the dashboard can offer the same one-click
 * ranges a firm expects (this week … last year) instead of a dropdown. They are
 * all CLOSED ranges — a fixed start and end — unlike mtd/qtd/fytd which run to
 * now. Week starts Monday, which is the working week in an Indian MFD office;
 * "last year" is the previous FINANCIAL year (Apr–Mar), not the calendar year,
 * because every other year figure in this product is FY.
 */
export type Period =
  | "today"
  | "yd"
  | "tw"
  | "lw"
  | "mtd"
  | "lm"
  | "qtd"
  | "lq"
  | "fytd"
  | "ly"
  | "custom";

/**
 * Unified period RANGE resolver — returns both a start AND an end so every
 * dashboard (cockpits, charts, board widgets) can share one time window.
 *
 * - mtd/qtd/fytd: start-of-period → now ("to date")
 * - lm: full last calendar month
 * - custom: explicit `from`/`to` when given, else `customStart` → now
 *
 * `fromISO`/`toISO` are for SQL `BETWEEN`/`>=`/`<` clauses; `fromDate`/`toDate`
 * are the same as Date objects; `days` is the inclusive span (handy for charts).
 */
export function resolvePeriodRange(
  period: Period,
  now = new Date(),
  opts?: { customStart?: string; from?: string; to?: string }
): { fromISO: string; toISO: string; fromDate: Date; toDate: Date; label: string; period: Period; days: number } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  // Explicit custom range wins (used by RmDashboard / Team / Command Center).
  if (period === "custom" && opts?.from && iso.test(opts.from)) {
    const fromDate = new Date(opts.from + "T00:00:00");
    const toDate = opts.to && iso.test(opts.to) ? new Date(opts.to + "T23:59:59") : now;
    return pack(fromDate, toDate, rangeLabel(fromDate, toDate), "custom");
  }
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

  if (period === "today") {
    return pack(dayStart(now), now, "Today", "today");
  }
  if (period === "yd") {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return pack(dayStart(y), dayEnd(y), "Yesterday", "yd");
  }
  // Monday-start week.
  const startOfWeek = (d: Date) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7; // Mon = 0
    x.setDate(x.getDate() - dow);
    return x;
  };
  if (period === "tw") {
    const fromDate = startOfWeek(now);
    return pack(fromDate, now, "This week", "tw");
  }
  if (period === "lw") {
    const thisMon = startOfWeek(now);
    const fromDate = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7);
    const toDate = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 1, 23, 59, 59);
    return pack(fromDate, toDate, rangeLabel(fromDate, toDate), "lw");
  }
  if (period === "lq") {
    // Indian FY quarters: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar.
    const m = now.getMonth();
    const qStartMonth = Math.floor(((m - 3 + 12) % 12) / 3) * 3 + 3; // 3,6,9,12(->0)
    const thisQStart = new Date(now.getFullYear(), qStartMonth % 12, 1);
    if (qStartMonth >= 12) thisQStart.setFullYear(now.getFullYear());
    const fromDate = new Date(thisQStart.getFullYear(), thisQStart.getMonth() - 3, 1);
    const toDate = new Date(thisQStart.getFullYear(), thisQStart.getMonth(), 0, 23, 59, 59);
    return pack(fromDate, toDate, rangeLabel(fromDate, toDate), "lq");
  }
  if (period === "ly") {
    // Previous FINANCIAL year (1 Apr - 31 Mar), matching every other FY figure.
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fromDate = new Date(fyStartYear - 1, 3, 1);
    const toDate = new Date(fyStartYear, 2, 31, 23, 59, 59);
    return pack(fromDate, toDate, `FY ${fyStartYear - 1}-${String(fyStartYear).slice(2)}`, "ly");
  }
  if (period === "lm") {
    const y = now.getFullYear();
    const m = now.getMonth();
    const fromDate = new Date(y, m - 1, 1);
    const toDate = new Date(y, m, 0, 23, 59, 59); // last day of previous month
    return pack(fromDate, toDate, fromDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" }), "lm");
  }
  // mtd / qtd / fytd / custom-since → start..now via the existing resolver.
  const { startISO, label } = resolvePeriodDates(period, now, opts?.customStart);
  return pack(new Date(startISO), now, label, period);
}

function pack(fromDate: Date, toDate: Date, label: string, period: Period) {
  const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000));
  return { fromISO: fromDate.toISOString(), toISO: toDate.toISOString(), fromDate, toDate, label, period, days };
}

function rangeLabel(from: Date, to: Date): string {
  const f = from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const t = to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  return `${f} – ${t}`;
}

export const PERIOD_LABELS: Record<"mtd" | "qtd" | "fytd" | "lm", string> = {
  mtd: "Month to date",
  qtd: "Quarter to date",
  fytd: "FY to date",
  lm: "Last month",
};

/**
 * Given a period key and the current date, return the period start (ISO)
 * for SQL WHERE clauses plus a human label.
 */
export function resolvePeriodDates(
  period: Period,
  now = new Date(),
  customStart?: string
): { startISO: string; label: string } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  if (period === "custom" && customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart)) {
    const d = new Date(customStart);
    if (!isNaN(d.getTime())) {
      return { startISO: d.toISOString(), label: `Since ${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}` };
    }
  }

  // India FY: April (month=3) is Q1 start
  const fyStart = m >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);

  // QTD quarters (India FY-aligned)
  let qtdStart: Date;
  if (m >= 3 && m <= 5) {
    qtdStart = new Date(y, 3, 1); // Q1 Apr–Jun
  } else if (m >= 6 && m <= 8) {
    qtdStart = new Date(y, 6, 1); // Q2 Jul–Sep
  } else if (m >= 9 && m <= 11) {
    qtdStart = new Date(y, 9, 1); // Q3 Oct–Dec
  } else {
    qtdStart = new Date(y, 0, 1); // Q4 Jan–Mar
  }

  switch (period) {
    case "lm": {
      const lmStart = new Date(y, m - 1, 1);
      return {
        startISO: lmStart.toISOString(),
        label: lmStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      };
    }
    case "qtd":
      return {
        startISO: qtdStart.toISOString(),
        label: `Q${Math.floor(((m - 3 + 12) % 12) / 3) + 1} FY${String(fyStart.getFullYear()).slice(-2)}-${String(fyStart.getFullYear() + 1).slice(-2)}`,
      };
    case "fytd":
      return {
        startISO: fyStart.toISOString(),
        label: `FY${String(fyStart.getFullYear()).slice(-2)}-${String(fyStart.getFullYear() + 1).slice(-2)}`,
      };
    case "mtd":
    default:
      return {
        startISO: new Date(y, m, 1).toISOString(),
        label: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      };
  }
}


/**
 * The previous corresponding period — what the Director compares against.
 *
 * "Corresponding" is not "the previous N days": for a to-date period it is the
 * SAME SLICE of the previous period, so 1–22 Sep compares against 1–22 Aug, not
 * against the whole of August. Comparing a part-month against a full one is the
 * single easiest way to make a healthy month look like a collapse.
 *
 *   today  → yesterday            mtd   → 1st–same day of last month
 *   yd     → the day before       lm    → the month before that
 *   tw     → same weekdays, last week   qtd → same slice of the previous quarter
 *   lw     → the week before      fytd  → same slice of the previous FY
 *   ly     → the FY before that   custom → the equally long window ending the
 *                                          day before `from`
 */
export function resolvePreviousRange(
  period: Period,
  now = new Date(),
  opts?: { customStart?: string; from?: string; to?: string }
): { fromISO: string; toISO: string; fromDate: Date; toDate: Date; label: string; days: number } {
  const cur = resolvePeriodRange(period, now, opts);
  const from = cur.fromDate;
  const to = cur.toDate;

  const isMonthEnd = (d: Date) =>
    d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

  // Shift a date back by whole months. Two corrections matter:
  //   · clamp the day, so 31 Mar → 28/29 Feb instead of rolling into March;
  //   · if the source date is its own month's LAST day, land on the target
  //     month's last day — otherwise a quarter ending 30 Jun shifts to 30 Mar
  //     and silently drops 31 March out of the comparison.
  const shiftMonths = (d: Date, months: number, snapMonthEnd = false) => {
    const target = new Date(d.getFullYear(), d.getMonth() - months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const day = snapMonthEnd && isMonthEnd(d) ? lastDay : Math.min(d.getDate(), lastDay);
    return new Date(target.getFullYear(), target.getMonth(), day, d.getHours(), d.getMinutes(), d.getSeconds());
  };

  const shiftDays = (d: Date, days: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() - days, d.getHours(), d.getMinutes(), d.getSeconds());

  let pFrom: Date;
  let pTo: Date;

  if (period === "mtd" || period === "lm") {
    pFrom = shiftMonths(from, 1);
    pTo = shiftMonths(to, 1, true);
  } else if (period === "qtd" || period === "lq") {
    pFrom = shiftMonths(from, 3);
    pTo = shiftMonths(to, 3, true);
  } else if (period === "fytd" || period === "ly") {
    pFrom = shiftMonths(from, 12);
    pTo = shiftMonths(to, 12, true);
  } else if (period === "today" || period === "yd") {
    pFrom = shiftDays(from, 1);
    pTo = shiftDays(to, 1);
  } else if (period === "tw" || period === "lw") {
    // A whole week back, so the comparison covers the SAME WEEKDAYS. Shifting
    // by the window's own length instead would compare Mon–Tue against Sat–Sun.
    pFrom = shiftDays(from, 7);
    pTo = shiftDays(to, 7);
  } else {
    // An arbitrary custom range: the equally long window ending the day before.
    const span = to.getTime() - from.getTime();
    pTo = new Date(from.getTime() - 1);
    pFrom = new Date(pTo.getTime() - span);
  }

  const days = Math.max(1, Math.round((pTo.getTime() - pFrom.getTime()) / 86_400_000));
  return {
    fromISO: pFrom.toISOString(),
    toISO: pTo.toISOString(),
    fromDate: pFrom,
    toDate: pTo,
    label: rangeLabel(pFrom, pTo),
    days,
  };
}


/**
 * A Date → `yyyy-mm-dd` in LOCAL time.
 *
 * `toISOString().slice(0, 10)` is the obvious way to do this and is wrong east
 * of Greenwich: local midnight on 1 Apr in IST is 2026-03-31T18:30:00Z, so the
 * string comes back as the PREVIOUS day. Every financial-year boundary on this
 * dashboard is 1 April, which made the FY window reach a day backwards and
 * count 31-March registrations as this year's — ₹35 lakh of SIP that had not
 * happened yet, against a target it was not part of.
 */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
