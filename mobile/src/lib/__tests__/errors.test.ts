import { errorMessage } from "../errors";

test("uses an Error's message", () => {
  expect(errorMessage(new Error("No access"))).toBe("No access");
});
test("never returns blank for odd throwables", () => {
  expect(errorMessage("Offline")).toBe("Offline");
  expect(errorMessage({ message: "From body" })).toBe("From body");
  for (const odd of [undefined, null, 42, "", "   ", new Error(""), {}]) {
    expect(errorMessage(odd, "Could not save.")).toBe("Could not save.");
  }
});
