/**
 * The public complaint form's input rules (lib/complaints/submission.ts):
 * what a person must give, what is cleaned up, and the bot trap.
 */

import { describe, expect, it } from "vitest";
import { parseComplaintSubmission } from "@/lib/complaints/submission";

const good = {
  name: "  Ravi   Kumar ",
  phone: "+91 98765 43210",
  email: "Ravi@Example.com",
  pan: "abcde1234f",
  folio: "1234567/89",
  category: "mis_selling",
  details: "I was sold a scheme that did not match my risk profile.",
};

describe("parseComplaintSubmission", () => {
  it("accepts a complete complaint and cleans it up", () => {
    const r = parseComplaintSubmission(good);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value.name).toBe("Ravi Kumar");
    expect(r.value.email).toBe("ravi@example.com");
    expect(r.value.phone).toBe("+91 98765 43210");
    expect(r.value.phoneLast10).toBe("9876543210");
    expect(r.value.pan).toBe("ABCDE1234F");
    expect(r.value.category).toBe("mis_selling");
  });

  it("needs a name, a way to reply and a real description", () => {
    expect(parseComplaintSubmission({ ...good, name: "R" })).toMatchObject({ kind: "invalid" });
    expect(parseComplaintSubmission({ ...good, phone: "", email: "" })).toMatchObject({
      kind: "invalid",
      error: expect.stringContaining("mobile number or an email"),
    });
    expect(parseComplaintSubmission({ ...good, details: "bad" })).toMatchObject({ kind: "invalid" });
    expect(parseComplaintSubmission({ ...good, details: "x".repeat(4001) })).toMatchObject({ kind: "invalid" });
  });

  it("accepts either contact on its own", () => {
    expect(parseComplaintSubmission({ ...good, email: "" }).kind).toBe("ok");
    expect(parseComplaintSubmission({ ...good, phone: "" }).kind).toBe("ok");
  });

  it("rejects a malformed email, mobile or PAN", () => {
    expect(parseComplaintSubmission({ ...good, email: "ravi@" })).toMatchObject({ kind: "invalid" });
    expect(parseComplaintSubmission({ ...good, phone: "12345" })).toMatchObject({ kind: "invalid" });
    expect(parseComplaintSubmission({ ...good, pan: "1234" })).toMatchObject({ kind: "invalid" });
  });

  it("treats an unknown category as Other, and PAN and folio as optional", () => {
    const r = parseComplaintSubmission({ ...good, category: "<script>", pan: "", folio: "" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value.category).toBe("other");
    expect(r.value.pan).toBeNull();
    expect(r.value.folio).toBeNull();
  });

  it("springs the bot trap when the hidden field is filled", () => {
    expect(parseComplaintSubmission({ ...good, website: "http://spam.example" }).kind).toBe("trap");
    expect(parseComplaintSubmission({ ...good, _gotcha: "x" }).kind).toBe("trap");
  });

  it("survives a body that is not an object", () => {
    expect(parseComplaintSubmission(null).kind).toBe("invalid");
    expect(parseComplaintSubmission("name=x").kind).toBe("invalid");
  });
});
