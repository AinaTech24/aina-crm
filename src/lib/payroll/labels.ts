/** Pay run status labels — a plain module so server and client pages share it. */
export const RUN_STATUS: Record<string, { label: string; tone: "neutral" | "warning" | "success" | "info" }> = {
  draft: { label: "Draft", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  paid: { label: "Paid", tone: "success" },
};
