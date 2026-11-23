import { describe, expect, it } from "vitest";
import { humanCode, isMonthKeys, periodLabel, reportDisplayName } from "@/lib/reports/display";

describe("report display labels", () => {
  it("drops the firm prefix from a report name", () => {
    expect(reportDisplayName("WCFW Equity Business MoM")).toBe("Equity Business MoM");
    expect(reportDisplayName("Equity Business MoM")).toBe("Equity Business MoM");
    expect(reportDisplayName("WCFW")).toBe("WCFW");
  });
  it("reads months and dates the way people say them", () => {
    expect(periodLabel("2026-11")).toBe("Nov 2026");
    expect(periodLabel("2026-11-05")).toBe("5 Nov 2026");
    expect(periodLabel("Anand")).toBe("Anand");
  });
  it("turns stored codes into words, leaves names alone", () => {
    expect(humanCode("client_contacted")).toBe("Client contacted");
    expect(humanCode("pending")).toBe("Pending");
    expect(humanCode("Nikhil Thakkar")).toBe("Nikhil Thakkar");
    expect(humanCode("pms")).toBe("PMS");
    expect(humanCode("mutual_fund")).toBe("Mutual fund");
    expect(humanCode("MFT12584")).toBe("MFT12584");
  });
  it("knows a month axis", () => {
    expect(isMonthKeys(["2026-10", "2026-11"])).toBe(true);
    expect(isMonthKeys(["Anand", "2026-11"])).toBe(false);
    expect(isMonthKeys([])).toBe(false);
  });
});
