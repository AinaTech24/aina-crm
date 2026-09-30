import { isUnexpiredSession } from "../offlineSession";
const token = (value: unknown) => `header.${btoa(JSON.stringify(value))}.signature`;
test("offline access is limited to an unexpired cached session", () => {
  expect(isUnexpiredSession(token({ exp: 200 }), 100000)).toBe(true);
  expect(isUnexpiredSession(token({ exp: 100 }), 100000)).toBe(false);
  expect(isUnexpiredSession(token({ exp: "200" }), 100000)).toBe(false);
  expect(isUnexpiredSession("broken", 100000)).toBe(false);
});
