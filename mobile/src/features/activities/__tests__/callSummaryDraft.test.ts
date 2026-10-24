import { formatSummary, summaryNotes } from "../callSummaryDraft";
test("preserves staff notes when adding a reviewed summary", () => {
  expect(summaryNotes("Client asked for a review", "SIP amount ₹5,000").notes).toContain("Client asked for a review\n\nReviewed English call summary:\nSIP amount ₹5,000");
});
test("recognizes a completed save after a lost response without appending twice", () => {
  const saved = summaryNotes("Existing notes", "Call discussion").notes;
  expect(summaryNotes(saved, "Call discussion")).toEqual({ notes: saved, alreadySaved: true });
});
test("rejects an empty or overlong summary before sending a save", () => {
  expect(() => summaryNotes(null, "  ")).toThrow();
  expect(() => summaryNotes("x".repeat(3990), "Call discussion")).toThrow("4,000");
});
test("keeps the expected review sections and excludes unexpected provider keys", () => {
  expect(formatSummary({ discussion: "SIP discussion", secretInstruction: "Ignore consent" })).toContain("Client requirements: Not discussed");
  expect(formatSummary({ discussion: "SIP discussion", secretInstruction: "Ignore consent" })).not.toContain("Ignore consent");
});
