jest.mock("../../../lib/offlineQueue", () => ({ queuedPost: jest.fn(async () => null) }));
import { waNumber } from "../whatsapp";

describe("waNumber", () => {
  it.each([
    ["9876543210", "919876543210"],
    ["+91 98765 43210", "919876543210"],
    ["09876543210", "919876543210"],
    ["0091 98765 43210", "919876543210"],
    ["+44 7700 900123", "447700900123"],
    ["", ""],
  ])("%s → %s", (raw, want) => {
    expect(waNumber(raw)).toBe(want);
  });
});
