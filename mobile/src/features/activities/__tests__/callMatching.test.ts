import { callBody, indexContacts, matchCall, matchIndexed, phoneKey } from "../callMatching";
const contact = { id: "client-a", name: "Client", phone: "+91 98765 43210", subjectType: "investor" as const };
const call = { id: "1", number: "09876543210", date: 1700000000000, duration: 0, type: 3 };
test("matches Indian prefixes without matching a foreign country code", () => {
  expect(phoneKey("0091 98765 43210")).toBe(phoneKey("9876543210"));
  expect(matchCall(call, [contact])).toEqual(contact);
  expect(matchCall({ ...call, number: "+44 9876543210" }, [contact])).toBeNull();
});
test("unknown and ambiguous phone numbers never upload automatically", () => {
  expect(matchCall({ ...call, number: "private" }, [contact])).toBeNull();
  expect(matchCall(call, [contact, { ...contact, id: "client-b" }])).toBeNull();
});
test("missed calls are inbound with zero duration; no invented conversation", () => {
  expect(callBody(call, contact)).toMatchObject({ direction: "inbound", status: "no_answer", durationSec: 0, subjectId: "client-a" });
  expect(callBody(call, contact)).not.toHaveProperty("notes");
  expect(callBody({ ...call, type: 2, duration: 72 }, contact)).toMatchObject({ direction: "outbound", status: "answered", durationSec: 72 });
});
test("the indexed matcher agrees with matchCall, including ambiguity", () => {
  const book = [contact, { ...contact, id: "lead-x", phone: "98111 22233", subjectType: "lead" as const }];
  const index = indexContacts(book);
  for (const number of ["09876543210", "+91 98765 43210", "0091 98765 43210", "+44 9876543210", "private", "9811122233"]) {
    expect(matchIndexed({ ...call, number }, index)).toEqual(matchCall({ ...call, number }, book));
  }
  const twice = indexContacts([contact, { ...contact, id: "client-b" }]);
  expect(matchIndexed(call, twice)).toBeNull();
});
test("contacts without a usable number are left out of the index", () => {
  expect(indexContacts([{ ...contact, phone: "n/a" }]).size).toBe(0);
});
